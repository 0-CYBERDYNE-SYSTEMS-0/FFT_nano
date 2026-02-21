import fs from 'fs';
import path from 'path';

import {
  GROUPS_DIR,
  MAIN_GROUP_FOLDER,
  SCHEDULER_MODE,
  SCHEDULER_POLL_INTERVAL,
} from './config.js';
import { runContainerAgent, writeTasksSnapshot } from './container-runner.js';
import {
  getAllTasks,
  getDueTasks,
  getTaskById,
  logTaskRun,
  updateTask,
  updateTaskAfterRun,
} from './db.js';
import { logger } from './logger.js';
import { RegisteredGroup, ScheduledTask } from './types.js';
import { startCronV2Service } from './cron/service.js';
import { resolveNoContinueForTask } from './cron/adapters.js';
import { computeRecurringTaskNextRun } from './task-schedule.js';

export interface SchedulerDependencies {
  sendMessage: (jid: string, text: string) => Promise<void>;
  registeredGroups: () => Record<string, RegisteredGroup>;
  requestHeartbeatNow?: (reason?: string) => void;
  isChatRunActive?: (jid: string) => boolean;
  runTaskAgent?: typeof runContainerAgent;
  scheduleNextTick?: (fn: () => void, delayMs: number) => unknown;
}

async function runLegacyTask(
  task: ScheduledTask,
  deps: SchedulerDependencies,
): Promise<void> {
  const startTime = Date.now();
  const groupDir = path.join(GROUPS_DIR, task.group_folder);
  fs.mkdirSync(groupDir, { recursive: true });

  logger.info(
    { taskId: task.id, group: task.group_folder },
    'Running scheduled task',
  );

  const groups = deps.registeredGroups();
  const group = Object.values(groups).find(
    (g) => g.folder === task.group_folder,
  );

  if (!group) {
    const nextRun = computeRecurringTaskNextRun(task);
    const missingGroupError = `Group not found: ${task.group_folder}`;
    logger.error(
      { taskId: task.id, groupFolder: task.group_folder },
      'Group not found for task',
    );
    logTaskRun({
      task_id: task.id,
      run_at: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
      status: 'error',
      result: null,
      error: missingGroupError,
    });
    updateTaskAfterRun(task.id, nextRun, `Error: ${missingGroupError}`);
    return;
  }

  const isMain = task.group_folder === MAIN_GROUP_FOLDER;
  const tasks = getAllTasks();
  writeTasksSnapshot(
    task.group_folder,
    isMain,
    tasks.map((t) => ({
      id: t.id,
      groupFolder: t.group_folder,
      prompt: t.prompt,
      schedule_type: t.schedule_type,
      schedule_value: t.schedule_value,
      status: t.status,
      next_run: t.next_run,
      context_mode: t.context_mode,
      session_target: t.session_target,
      wake_mode: t.wake_mode,
      delivery_mode: t.delivery_mode,
      timeout_seconds: t.timeout_seconds,
    })),
  );

  let result: string | null = null;
  let error: string | null = null;

  if (deps.isChatRunActive?.(task.chat_jid)) {
    const deferUntil = new Date(Date.now() + SCHEDULER_POLL_INTERVAL).toISOString();
    updateTask(task.id, { next_run: deferUntil });
    logger.info(
      { taskId: task.id, chatJid: task.chat_jid, deferUntil },
      'Skipping scheduled task: active chat run',
    );
    return;
  }

  try {
    const taskRunner = deps.runTaskAgent || runContainerAgent;
    const output = await taskRunner(group, {
      prompt: task.prompt,
      groupFolder: task.group_folder,
      chatJid: task.chat_jid,
      isMain,
      isScheduledTask: true,
      noContinue: resolveNoContinueForTask(task),
    });

    if (output.status === 'error') {
      error = output.error || 'Unknown error';
    } else {
      result = output.result;
    }

    logger.info(
      { taskId: task.id, durationMs: Date.now() - startTime },
      'Task completed',
    );
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    logger.error({ taskId: task.id, error }, 'Task failed');
  }

  const durationMs = Date.now() - startTime;

  logTaskRun({
    task_id: task.id,
    run_at: new Date().toISOString(),
    duration_ms: durationMs,
    status: error ? 'error' : 'success',
    result,
    error,
  });

  const nextRun = computeRecurringTaskNextRun(task);
  const resultSummary = error
    ? `Error: ${error}`
    : result
      ? result.slice(0, 200)
      : 'Completed';
  updateTaskAfterRun(task.id, nextRun, resultSummary);
}

let schedulerRunning = false;

export async function processDueTasksOnce(
  deps: SchedulerDependencies,
): Promise<void> {
  try {
    const dueTasks = getDueTasks();
    if (dueTasks.length > 0) {
      logger.info({ count: dueTasks.length }, 'Found due tasks');
    }

    for (const task of dueTasks) {
      const currentTask = getTaskById(task.id);
      if (!currentTask || currentTask.status !== 'active') {
        continue;
      }

      await runLegacyTask(currentTask, deps);
    }
  } catch (err) {
    logger.error({ err }, 'Error in scheduler loop');
  }
}

export function resetSchedulerLoopForTest(): void {
  schedulerRunning = false;
}

function startLegacySchedulerLoop(deps: SchedulerDependencies): void {
  if (schedulerRunning) {
    logger.debug('Scheduler loop already running, skipping duplicate start');
    return;
  }
  schedulerRunning = true;
  logger.info('Scheduler loop started (legacy)');

  const loop = async () => {
    await processDueTasksOnce(deps);
    const scheduleNextTick = deps.scheduleNextTick || setTimeout;
    scheduleNextTick(loop, SCHEDULER_POLL_INTERVAL);
  };

  void loop();
}

export function startSchedulerLoop(deps: SchedulerDependencies): void {
  const forceLegacyForInjectedDeps =
    Boolean(deps.scheduleNextTick) ||
    Boolean(deps.runTaskAgent) ||
    Boolean(deps.isChatRunActive);

  if (SCHEDULER_MODE === 'legacy' || forceLegacyForInjectedDeps) {
    startLegacySchedulerLoop(deps);
    return;
  }
  startCronV2Service({
    sendMessage: deps.sendMessage,
    registeredGroups: deps.registeredGroups,
    requestHeartbeatNow: deps.requestHeartbeatNow,
  });
}
