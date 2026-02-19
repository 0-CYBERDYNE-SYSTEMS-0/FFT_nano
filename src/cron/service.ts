import { CronExpressionParser } from 'cron-parser';
import fs from 'fs';
import path from 'path';

import { DATA_DIR, GROUPS_DIR, MAIN_GROUP_FOLDER, TIMEZONE } from '../config.js';
import { runContainerAgent, writeTasksSnapshot } from '../container-runner.js';
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
import { RegisteredGroup, ScheduledTask } from '../types.js';
import { resolveNoContinueForTask } from './adapters.js';

export interface CronServiceDependencies {
  sendMessage: (jid: string, text: string) => Promise<void>;
  registeredGroups: () => Record<string, RegisteredGroup>;
  requestHeartbeatNow?: (reason?: string) => void;
  runContainerTask?: typeof runContainerAgent;
}

const ERROR_BACKOFF_MS = [30_000, 60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];
const IDLE_POLL_MS = 60_000;
const MAX_TIMER_DELAY_MS = 60_000;
let schedulerRunning = false;
let schedulerTimer: NodeJS.Timeout | null = null;
let schedulerTickActive = false;

export function computeErrorBackoffMs(consecutiveErrors: number): number {
  const idx = Math.min(Math.max(consecutiveErrors, 1) - 1, ERROR_BACKOFF_MS.length - 1);
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
    const intervalMs = schedule.kind === 'every' && schedule.everyMs
      ? schedule.everyMs
      : Number.parseInt(task.schedule_value, 10);
    if (Number.isFinite(intervalMs) && intervalMs > 0) {
      nextRun = new Date(nowMs + intervalMs).toISOString();
    }
  } else if (task.schedule_type === 'cron') {
    try {
      const expr = schedule.kind === 'cron' && schedule.expr ? schedule.expr : task.schedule_value;
      const interval = CronExpressionParser.parse(expr, {
        tz: schedule.tz || TIMEZONE,
        currentDate: new Date(nowMs),
      });
      nextRun = interval.next().toISOString();
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

export function getTaskDeliveryMode(task: ScheduledTask): 'none' | 'announce' | 'webhook' {
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
): Promise<void> {
  const mode = getTaskDeliveryMode(task);
  if (mode === 'none') return;

  const text = hadError
    ? `[scheduled:${task.id}] error: ${result || 'unknown error'}`
    : `[scheduled:${task.id}] ${result?.trim() || 'completed'}`;

  if (mode === 'announce') {
    await deps.sendMessage(task.chat_jid, text.slice(0, 4000));
    return;
  }

  if (mode === 'webhook' && task.delivery_webhook_url) {
    try {
      await fetch(task.delivery_webhook_url, {
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
    ? Math.max(0, Math.min(new Date(nextDue).getTime() - nowMs, MAX_TIMER_DELAY_MS))
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
  const group = Object.values(groups).find((entry) => entry.folder === task.group_folder);
  if (!group) {
    const consecutiveErrors = (task.consecutive_errors || 0) + 1;
    const nextRun = resolveTaskNextRun(task, Date.now(), true, consecutiveErrors);
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

  const staggerMs = task.stagger_ms && task.stagger_ms > 0 ? task.stagger_ms : 0;
  if (staggerMs > 0) {
    const waitMs = Math.floor(Math.random() * staggerMs);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  const abortController = new AbortController();
  const timeoutSeconds =
    task.timeout_seconds && task.timeout_seconds > 0 ? task.timeout_seconds : null;
  let timeoutHandle: NodeJS.Timeout | null = null;
  if (timeoutSeconds) {
    timeoutHandle = setTimeout(() => {
      abortController.abort();
    }, timeoutSeconds * 1000);
  }

  let outputError: string | null = null;
  let outputResult: string | null = null;
  try {
    const runTask = deps.runContainerTask ?? runContainerAgent;
    const output = await runTask(
      group,
      {
        prompt: task.prompt,
        groupFolder: task.group_folder,
        chatJid: task.chat_jid,
        isMain,
        isScheduledTask: true,
        noContinue: resolveNoContinueForTask(task),
      },
      abortController.signal,
    );
    if (output.status === 'error') {
      outputError = output.error || 'Unknown scheduled task error';
    } else {
      outputResult = output.result;
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
  const nextRun = resolveTaskNextRun(task, Date.now(), hadError, consecutiveErrors);
  const status = nextRun ? 'active' : 'completed';

  logTaskRun({
    task_id: task.id,
    run_at: new Date().toISOString(),
    duration_ms: durationMs,
    status: hadError ? 'error' : 'success',
    result: hadError ? null : outputResult,
    error: outputError,
  });

  if (
    task.schedule_type === 'once' &&
    task.delete_after_run &&
    !hadError
  ) {
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

  await deliverTaskOutcome(task, hadError, hadError ? outputError : outputResult, deps);

  if (shouldTriggerWakeNow(task)) {
    deps.requestHeartbeatNow?.(`cron:${task.id}`);
  }
}

export async function runCronSchedulerTick(deps: CronServiceDependencies): Promise<void> {
  if (schedulerTickActive) {
    armSchedulerTimer(deps);
    return;
  }
  schedulerTickActive = true;
  try {
    const dueTasks = getDueTasks();
    if (dueTasks.length > 0) {
      logger.info({ count: dueTasks.length }, 'Found due tasks');
    }
    for (const dueTask of dueTasks) {
      const latest = getTaskById(dueTask.id);
      if (!latest || latest.status !== 'active') continue;
      await runScheduledTaskV2(latest, deps);
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
