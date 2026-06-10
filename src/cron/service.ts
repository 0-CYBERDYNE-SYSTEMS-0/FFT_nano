import { CronExpressionParser } from 'cron-parser';
import fs from 'fs';
import path from 'path';

import {
  DATA_DIR,
  GROUPS_DIR,
  MAIN_GROUP_FOLDER,
  MAIN_WORKSPACE_DIR,
  PARITY_CONFIG,
  TIMEZONE,
} from '../config.js';
import { runContainerAgent, writeTasksSnapshot } from '../pi-runner.js';
import {
  runEvaluatorPass,
  recordVerdictOutcome,
  verdictToOutcome,
} from '../evaluator.js';
import {
  deleteTask,
  getAllTasks,
  getDueTasks,
  getNextDueTaskTime,
  getTaskById,
  logTaskRun,
  updateTaskAfterRunV2,
} from '../db.js';
import { logger } from '../logger.js';
import { RegisteredGroup, ScheduledTask, RunAuthority } from '../types.js';
import { mintRunAuthority, deriveEffectiveToolSet } from '../run-authority.js';
import { recordTaskAuditEvent } from '../task-audit.js';
import { resolveNoContinueForTask } from './adapters.js';
import { getEffectiveTimezone } from '../time-context.js';
import type { OutboxDeliverer } from '../outbox.js';

export interface CronServiceDependencies {
  sendMessage: (jid: string, text: string) => Promise<boolean>;
  registeredGroups: () => Record<string, RegisteredGroup>;
  requestHeartbeatNow?: (reason?: string) => void;
  runContainerTask?: typeof runContainerAgent;
  runEvaluatorPass?: typeof runEvaluatorPass;
  runSubagentTask?: (
    type: string,
    groupFolder: string,
    prompt: string,
    options?: { fireAndForget?: boolean; chatJid?: string },
  ) => Promise<string | null>;
  // When provided, announce deliveries go through the durable outbox
  // (at-least-once + dedupe) instead of a fire-and-forget sendMessage.
  outbox?: OutboxDeliverer;
}

const ERROR_BACKOFF_MS = [30_000, 60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];
const IDLE_POLL_MS = 60_000;
const MAX_TIMER_DELAY_MS = 60_000;
let schedulerRunning = false;
let schedulerTimer: NodeJS.Timeout | null = null;
let schedulerTickActive = false;

export function computeErrorBackoffMs(consecutiveErrors: number): number {
  const idx = Math.min(
    Math.max(consecutiveErrors, 1) - 1,
    ERROR_BACKOFF_MS.length - 1,
  );
  return ERROR_BACKOFF_MS[idx];
}

function parseTaskScheduleJson(task: ScheduledTask): {
  kind?: 'at' | 'every' | 'cron';
  everyMs?: number;
  expr?: string;
  tz?: string;
} {
  if (!task.schedule_json) return {};
  try {
    const parsed = JSON.parse(task.schedule_json) as Record<string, unknown>;
    const kind =
      parsed.kind === 'at' || parsed.kind === 'every' || parsed.kind === 'cron'
        ? parsed.kind
        : undefined;
    const everyMs =
      typeof parsed.everyMs === 'number' && Number.isFinite(parsed.everyMs)
        ? Math.floor(parsed.everyMs)
        : undefined;
    const expr = typeof parsed.expr === 'string' ? parsed.expr : undefined;
    const tz = typeof parsed.tz === 'string' ? parsed.tz : undefined;
    return { kind, everyMs, expr, tz };
  } catch {
    return {};
  }
}

function fnv1a32(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function normalizeCronExpressionParts(expr: string): string[] | null {
  const raw = expr.trim().split(/\s+/).filter(Boolean);
  if (raw.length === 6) return raw.slice(1);
  if (raw.length === 5) return raw;
  return null;
}

function isRecurringTopOfHourExpression(expr: string): boolean {
  const parts = normalizeCronExpressionParts(expr);
  if (!parts) return false;
  const minute = parts[0];
  const hour = parts[1];
  if (minute !== '0') return false;
  if (/^\d+$/.test(hour)) return false;
  if (hour.includes('*')) return true;
  if (/^\d+-\d+(\/\d+)?$/.test(hour)) return true;
  return false;
}

function computeDeterministicCronOffsetMs(
  task: ScheduledTask,
  expr: string,
): number {
  if (!PARITY_CONFIG.cron.deterministicTopOfHourStagger.enabled) return 0;
  if (!isRecurringTopOfHourExpression(expr)) return 0;
  const maxMs = PARITY_CONFIG.cron.deterministicTopOfHourStagger.maxMs;
  if (!Number.isFinite(maxMs) || maxMs <= 0) return 0;
  const seed = `${task.id}|${expr}|${task.group_folder}`;
  return fnv1a32(seed) % (maxMs + 1);
}

export function resolveTaskNextRun(
  task: ScheduledTask,
  nowMs: number,
  hadError: boolean,
  consecutiveErrors: number,
): string | null {
  let nextRun: string | null = null;
  const schedule = parseTaskScheduleJson(task);

  if (task.schedule_type === 'once') {
    nextRun = null;
  } else if (task.schedule_type === 'interval') {
    const intervalMs =
      schedule.kind === 'every' && schedule.everyMs
        ? schedule.everyMs
        : Number.parseInt(task.schedule_value, 10);
    if (Number.isFinite(intervalMs) && intervalMs > 0) {
      nextRun = new Date(nowMs + intervalMs).toISOString();
    }
  } else if (task.schedule_type === 'cron') {
    try {
      const expr =
        schedule.kind === 'cron' && schedule.expr
          ? schedule.expr
          : task.schedule_value;
      const interval = CronExpressionParser.parse(expr, {
        tz: schedule.tz || TIMEZONE,
        currentDate: new Date(nowMs),
      });
      const naturalNext = interval.next().toISOString();
      if (!naturalNext) {
        throw new Error('Cron parser did not return a next run timestamp');
      }
      const offsetMs = computeDeterministicCronOffsetMs(task, expr);
      if (offsetMs > 0) {
        nextRun = new Date(
          new Date(naturalNext).getTime() + offsetMs,
        ).toISOString();
      } else {
        nextRun = naturalNext;
      }
    } catch (err) {
      logger.warn(
        { taskId: task.id, scheduleValue: task.schedule_value, err },
        'Failed to compute next cron run',
      );
      nextRun = null;
    }
  }

  if (hadError && nextRun) {
    const backoffNext = nowMs + computeErrorBackoffMs(consecutiveErrors);
    const naturalNext = new Date(nextRun).getTime();
    nextRun = new Date(Math.max(naturalNext, backoffNext)).toISOString();
  }
  return nextRun;
}

export function getTaskDeliveryMode(
  task: ScheduledTask,
): 'none' | 'announce' | 'webhook' {
  return task.delivery_mode === 'announce' || task.delivery_mode === 'webhook'
    ? task.delivery_mode
    : 'none';
}

export function shouldTriggerWakeNow(task: ScheduledTask): boolean {
  return task.wake_mode === 'now';
}

async function deliverTaskOutcome(
  task: ScheduledTask,
  hadError: boolean,
  result: string | null,
  deps: CronServiceDependencies,
  startedAtMs: number,
): Promise<void> {
  const mode = getTaskDeliveryMode(task);
  if (mode === 'none') return;

  const text = hadError
    ? `[scheduled:${task.id}] error: ${result || 'unknown error'}`
    : `[scheduled:${task.id}] ${result?.trim() || 'completed'}`;

  if (mode === 'announce') {
    const destination = task.delivery_to?.trim() || task.chat_jid;
    // Stable per-execution dedupe key: a single task run delivers exactly one
    // announce, and a retry/flush of that same run never double-posts.
    const dedupeKey = `cron:${task.id}:${startedAtMs}`;
    if (deps.outbox) {
      try {
        const delivered = await deps.outbox.deliver({
          dedupeKey,
          destination,
          body: text,
        });
        if (!delivered) {
          logger.warn(
            { taskId: task.id, destination, dedupeKey },
            'Scheduled task announce queued but not yet delivered; will retry via outbox',
          );
        }
      } catch (err) {
        logger.error(
          { taskId: task.id, destination, err },
          'Scheduled task announce enqueue threw an exception',
        );
      }
      return;
    }
    try {
      const sent = await deps.sendMessage(destination, text.slice(0, 4000));
      if (!sent) {
        logger.error(
          { taskId: task.id, destination },
          'Scheduled task announce delivery failed; user did not receive the result',
        );
      }
    } catch (err) {
      logger.error(
        { taskId: task.id, destination, err },
        'Scheduled task announce delivery threw an exception',
      );
    }
    return;
  }

  if (mode === 'webhook' && task.delivery_webhook_url) {
    try {
      const response = await fetch(task.delivery_webhook_url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          taskId: task.id,
          groupFolder: task.group_folder,
          chatJid: task.chat_jid,
          status: hadError ? 'error' : 'success',
          message: text,
          at: new Date().toISOString(),
        }),
      });
      if (!response.ok) {
        const bodyText = (await response.text().catch(() => ''))
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 200);
        throw new Error(
          `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}${
            bodyText ? ` - ${bodyText}` : ''
          }`,
        );
      }
    } catch (err) {
      logger.warn({ taskId: task.id, err }, 'Task webhook delivery failed');
    }
  }
}

function armSchedulerTimer(deps: CronServiceDependencies): void {
  if (!schedulerRunning) return;
  if (schedulerTimer) {
    clearTimeout(schedulerTimer);
    schedulerTimer = null;
  }

  const nextDue = getNextDueTaskTime();
  const nowMs = Date.now();
  const delayMs = nextDue
    ? Math.max(
        0,
        Math.min(new Date(nextDue).getTime() - nowMs, MAX_TIMER_DELAY_MS),
      )
    : IDLE_POLL_MS;

  schedulerTimer = setTimeout(() => {
    schedulerTimer = null;
    void runCronSchedulerTick(deps);
  }, delayMs);
}

export async function runScheduledTaskV2(
  task: ScheduledTask,
  deps: CronServiceDependencies,
): Promise<void> {
  const startedAt = Date.now();
  const groups = deps.registeredGroups();
  const group = Object.values(groups).find(
    (entry) => entry.folder === task.group_folder,
  );
  if (!group) {
    const consecutiveErrors = (task.consecutive_errors || 0) + 1;
    const nextRun = resolveTaskNextRun(
      task,
      Date.now(),
      true,
      consecutiveErrors,
    );
    const status = nextRun ? 'active' : 'completed';

    logTaskRun({
      task_id: task.id,
      run_at: new Date().toISOString(),
      duration_ms: Date.now() - startedAt,
      status: 'error',
      result: null,
      error: `Group not found: ${task.group_folder}`,
    });
    updateTaskAfterRunV2({
      id: task.id,
      nextRun,
      lastResult: `Error: Group not found: ${task.group_folder}`,
      status,
      consecutiveErrors,
    });
    return;
  }

  const isMain = task.group_folder === MAIN_GROUP_FOLDER;
  const allTasks = getAllTasks();
  writeTasksSnapshot(
    task.group_folder,
    isMain,
    allTasks.map((row) => ({
      id: row.id,
      groupFolder: row.group_folder,
      prompt: row.prompt,
      schedule_type: row.schedule_type,
      schedule_value: row.schedule_value,
      status: row.status,
      next_run: row.next_run,
      context_mode: row.context_mode,
      session_target: row.session_target,
      wake_mode: row.wake_mode,
      delivery_mode: row.delivery_mode,
      timeout_seconds: row.timeout_seconds,
    })),
  );

  const staggerMs =
    task.stagger_ms && task.stagger_ms > 0 ? task.stagger_ms : 0;
  if (staggerMs > 0) {
    const waitMs = Math.floor(Math.random() * staggerMs);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  const abortController = new AbortController();
  const timeoutSeconds =
    task.timeout_seconds && task.timeout_seconds > 0
      ? task.timeout_seconds
      : null;
  let timeoutHandle: NodeJS.Timeout | null = null;
  if (timeoutSeconds) {
    timeoutHandle = setTimeout(() => {
      abortController.abort();
    }, timeoutSeconds * 1000);
  }

  let outputError: string | null = null;
  let outputResult: string | null = null;
  try {
    if (task.subagent_type && deps.runSubagentTask) {
      const result = await deps.runSubagentTask(
        task.subagent_type,
        task.group_folder,
        task.prompt,
        { fireAndForget: false, chatJid: task.chat_jid },
      );
      outputResult = result ?? 'Subagent completed';
    } else {
      const runTask = deps.runContainerTask ?? runContainerAgent;
      const schedule = parseTaskScheduleJson(task);
      const effectiveTimezone = getEffectiveTimezone(schedule.tz);
      const output = await runTask(
        group,
        {
          prompt: task.prompt,
          groupFolder: task.group_folder,
          chatJid: task.chat_jid,
          isMain,
          isScheduledTask: true,
          noContinue: resolveNoContinueForTask(task),
          effectiveTimezone,
        },
        abortController.signal,
      );
      if (output.status === 'error') {
        outputError = output.error || 'Unknown scheduled task error';
      } else {
        outputResult = output.result;

        // Evaluator pass for cron tasks — always runs
        // WS2.5: agent-created tasks use forceEvaluate to force a real evaluation
        if (outputResult) {
          const evaluateRun = deps.runEvaluatorPass || runEvaluatorPass;
          const verdict = await evaluateRun({
            runType: 'cron',
            originalTask: task.prompt,
            agentOutput: outputResult,
            durationMs: Date.now() - startedAt,
            toolsInvoked: output.toolExecutions?.length ?? 0,
            group,
            chatJid: task.chat_jid,
            isMain,
            workspaceDir: isMain
              ? MAIN_WORKSPACE_DIR
              : path.join(GROUPS_DIR, task.group_folder),
            startedAtMs: startedAt,
            abortSignal: abortController.signal,
            forceEvaluate: task.created_by === 'agent',
          }).catch((err) => {
            logger.warn(
              { err, taskId: task.id },
              'Evaluator pass failed for cron task',
            );
            return null;
          });

          // Record verdict to evaluator_verdicts (WS2.5 / WS4.5 chokepoint)
          // Best-effort: recording failure does not break the run
          if (verdict) {
            try {
              // Construct RunAuthority for the chokepoint (WS4.5)
              const runAuthority: RunAuthority = mintRunAuthority({
                requestId: `cron-${task.id}-${startedAt}`,
                groupFolder: task.group_folder,
                isMain,
                isScheduledTask: true,
                effectiveToolSet: deriveEffectiveToolSet({}),
                senderRole: 'operator',
              });
              const outcome = verdictToOutcome('cron', verdict, 0);
              recordVerdictOutcome({
                authority: runAuthority,
                outcome,
              });
            } catch (err) {
              logger.warn(
                { err, taskId: task.id },
                'Failed to record evaluator verdict',
              );
            }
          }

          if (verdict && !verdict.skipped && !verdict.pass) {
            logger.warn(
              {
                taskId: task.id,
                score: verdict.score,
                issues: verdict.issues,
                feedback: verdict.feedback,
              },
              'Cron task evaluator flagged issues; suppressing user-visible evaluator details',
            );
          }
        }
      }
    }
  } catch (err) {
    outputError = err instanceof Error ? err.message : String(err);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }

  const durationMs = Date.now() - startedAt;
  const hadError = !!outputError;
  const finalSummary = hadError
    ? `Error: ${outputError}`
    : outputResult?.trim()
      ? outputResult.slice(0, 400)
      : 'Completed';
  const consecutiveErrors = hadError ? (task.consecutive_errors || 0) + 1 : 0;
  const nextRun = resolveTaskNextRun(
    task,
    Date.now(),
    hadError,
    consecutiveErrors,
  );
  const status = nextRun ? 'active' : 'completed';

  logTaskRun({
    task_id: task.id,
    run_at: new Date().toISOString(),
    duration_ms: durationMs,
    status: hadError ? 'error' : 'success',
    result: hadError ? null : outputResult,
    error: outputError,
  });

  if (task.schedule_type === 'once' && task.delete_after_run && !hadError) {
    // WS2.4: Write audit line for delete_after_run before deleting the row
    recordTaskAuditEvent(task.group_folder, {
      taskId: task.id,
      kind: 'delete_after_run',
      priorStatus: task.status || null,
      newStatus: null,
    });
    deleteTask(task.id);
  } else {
    updateTaskAfterRunV2({
      id: task.id,
      nextRun,
      lastResult: finalSummary,
      status,
      consecutiveErrors,
    });
  }

  await deliverTaskOutcome(
    task,
    hadError,
    hadError ? outputError : outputResult,
    deps,
    startedAt,
  );

  if (shouldTriggerWakeNow(task)) {
    deps.requestHeartbeatNow?.(`cron:${task.id}`);
  }
}

export async function runCronSchedulerTick(
  deps: CronServiceDependencies,
): Promise<void> {
  if (schedulerTickActive) {
    armSchedulerTimer(deps);
    return;
  }
  schedulerTickActive = true;
  try {
    const dueTasks = getDueTasks();
    const touchedGroups = new Set<string>();
    if (dueTasks.length > 0) {
      logger.info({ count: dueTasks.length }, 'Found due tasks');
    }
    for (const dueTask of dueTasks) {
      const latest = getTaskById(dueTask.id);
      if (!latest || latest.status !== 'active') continue;
      touchedGroups.add(latest.group_folder);
      await runScheduledTaskV2(latest, deps);
    }
    if (touchedGroups.size === 0) {
      writeCronStoreSnapshot(MAIN_GROUP_FOLDER);
    } else {
      for (const folder of touchedGroups) {
        writeCronStoreSnapshot(folder);
      }
    }
    // Re-attempt any deliveries left pending by a transient channel outage so
    // the outbox self-heals within a running session, not only at restart.
    if (deps.outbox) {
      try {
        await deps.outbox.flushPending();
      } catch (err) {
        logger.warn({ err }, 'Outbox flush on cron tick failed');
      }
    }
  } catch (err) {
    logger.error({ err }, 'Error in cron v2 scheduler tick');
  } finally {
    schedulerTickActive = false;
    armSchedulerTimer(deps);
  }
}

export function startCronV2Service(deps: CronServiceDependencies): void {
  if (schedulerRunning) {
    logger.debug('Cron v2 scheduler already running, skipping duplicate start');
    return;
  }
  schedulerRunning = true;
  logger.info('Cron v2 scheduler started');
  armSchedulerTimer(deps);
}

export function writeCronStoreSnapshot(groupFolder: string): void {
  const storeDir = path.join(DATA_DIR, 'cron');
  fs.mkdirSync(storeDir, { recursive: true });
  const snapshot = {
    version: 1,
    generatedAt: new Date().toISOString(),
    groupFolder,
    jobs: getAllTasks().map((task) => ({
      id: task.id,
      group_folder: task.group_folder,
      schedule_type: task.schedule_type,
      schedule_value: task.schedule_value,
      status: task.status,
      next_run: task.next_run,
      session_target: task.session_target,
      wake_mode: task.wake_mode,
      delivery_mode: task.delivery_mode,
    })),
  };
  fs.writeFileSync(
    path.join(storeDir, `${groupFolder}-jobs.json`),
    `${JSON.stringify(snapshot, null, 2)}\n`,
    'utf-8',
  );
}
