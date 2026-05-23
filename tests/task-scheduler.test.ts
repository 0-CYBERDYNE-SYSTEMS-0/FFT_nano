import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  closeDatabase,
  createTask,
  getTaskById,
  initDatabaseAtPath,
} from '../src/db.js';
import {
  processDueTasksOnce,
  resetSchedulerLoopForTest,
  startSchedulerLoop,
} from '../src/task-scheduler.js';
import { RegisteredGroup } from '../src/types.js';

function setupTempDb(): { dbPath: string; cleanup: () => void } {
  const projectTmp = path.join(process.cwd(), 'data', 'test-db-temp');
  fs.mkdirSync(projectTmp, { recursive: true });
  const dirName = `fft-test-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const dir = path.join(projectTmp, dirName);
  fs.mkdirSync(dir, { recursive: true });
  const dbPath = path.join(dir, 'messages.db');
  initDatabaseAtPath(dbPath);
  return {
    dbPath,
    cleanup: () => {
      closeDatabase();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

function makeGroup(folder: string): RegisteredGroup {
  return {
    name: `Group ${folder}`,
    folder,
    trigger: '@FarmFriend',
    added_at: new Date().toISOString(),
  };
}

function createDueTask(input: {
  id: string;
  groupFolder: string;
  chatJid: string;
  scheduleType: 'interval' | 'once';
  scheduleValue: string;
}): void {
  createTask({
    id: input.id,
    group_folder: input.groupFolder,
    chat_jid: input.chatJid,
    prompt: 'Do work',
    schedule_type: input.scheduleType,
    schedule_value: input.scheduleValue,
    context_mode: 'isolated',
    next_run: new Date(Date.now() - 1000).toISOString(),
    status: 'active',
    created_at: new Date().toISOString(),
  });
}

test('due task is deferred when chat run is active', async () => {
  const { cleanup } = setupTempDb();
  try {
    createDueTask({
      id: 'task-defer',
      groupFolder: 'main',
      chatJid: 'telegram:100',
      scheduleType: 'interval',
      scheduleValue: '60000',
    });

    let runnerCalls = 0;
    await processDueTasksOnce({
      sendMessage: async () => undefined,
      registeredGroups: () => ({ 'telegram:100': makeGroup('main') }),
      isChatRunActive: () => true,
      runTaskAgent: async () => {
        runnerCalls += 1;
        return { status: 'success', result: 'ok' };
      },
    });

    assert.equal(runnerCalls, 0);
    const task = getTaskById('task-defer');
    assert.ok(task?.next_run);
    assert.ok(Date.parse(task!.next_run!) > Date.now());
    assert.equal(task?.status, 'active');
  } finally {
    cleanup();
  }
});

test('missing group keeps recurring task active and records error result', async () => {
  const { cleanup } = setupTempDb();
  try {
    createDueTask({
      id: 'task-missing-recurring',
      groupFolder: 'missing-group',
      chatJid: 'telegram:200',
      scheduleType: 'interval',
      scheduleValue: '60000',
    });

    await processDueTasksOnce({
      sendMessage: async () => undefined,
      registeredGroups: () => ({ 'telegram:999': makeGroup('main') }),
    });

    const task = getTaskById('task-missing-recurring');
    assert.equal(task?.status, 'active');
    assert.ok(task?.next_run);
    assert.match(task?.last_result || '', /Group not found/);
  } finally {
    cleanup();
  }
});

test('missing group completes once task after failed execution', async () => {
  const { cleanup } = setupTempDb();
  try {
    createDueTask({
      id: 'task-missing-once',
      groupFolder: 'missing-group',
      chatJid: 'telegram:300',
      scheduleType: 'once',
      scheduleValue: new Date(Date.now() - 1000).toISOString(),
    });

    await processDueTasksOnce({
      sendMessage: async () => undefined,
      registeredGroups: () => ({}),
    });

    const task = getTaskById('task-missing-once');
    assert.equal(task?.status, 'completed');
    assert.equal(task?.next_run, null);
  } finally {
    cleanup();
  }
});

test('successful recurring task advances next_run', async () => {
  const { cleanup } = setupTempDb();
  try {
    createDueTask({
      id: 'task-success-recurring',
      groupFolder: 'main',
      chatJid: 'telegram:400',
      scheduleType: 'interval',
      scheduleValue: '45000',
    });
    const before = Date.now();

    await processDueTasksOnce({
      sendMessage: async () => undefined,
      registeredGroups: () => ({ 'telegram:400': makeGroup('main') }),
      runTaskAgent: async () => ({ status: 'success', result: 'completed' }),
    });

    const task = getTaskById('task-success-recurring');
    assert.equal(task?.status, 'active');
    assert.ok(task?.next_run);
    assert.ok(Date.parse(task!.next_run!) >= before + 45000);
    assert.match(task?.last_result || '', /completed|Completed/);
  } finally {
    cleanup();
  }
});

test('scheduled task evaluator failure is logged but not appended to task result', async () => {
  const { cleanup } = setupTempDb();
  try {
    createDueTask({
      id: 'task-evaluator-no-leak',
      groupFolder: 'main',
      chatJid: 'telegram:450',
      scheduleType: 'interval',
      scheduleValue: '45000',
    });

    await processDueTasksOnce({
      sendMessage: async () => undefined,
      registeredGroups: () => ({ 'telegram:450': makeGroup('main') }),
      runTaskAgent: async () => ({
        status: 'success',
        result: 'operator-safe result',
      }),
      runEvaluatorPass: async () => ({
        pass: false,
        score: 4,
        issues: ['internal issue'],
        feedback: 'internal feedback',
        skipped: false,
      }),
    });

    const task = getTaskById('task-evaluator-no-leak');
    assert.equal(task?.last_result, 'operator-safe result');
    assert.doesNotMatch(task?.last_result || '', /Evaluator|score 4\/10|internal issue/);
  } finally {
    cleanup();
  }
});

test('startSchedulerLoop is idempotent', async () => {
  const { cleanup } = setupTempDb();
  try {
    resetSchedulerLoopForTest();
    let scheduledCount = 0;

    const deps = {
      sendMessage: async () => undefined,
      registeredGroups: () => ({}),
      scheduleNextTick: () => {
        scheduledCount += 1;
        return 0;
      },
    };

    startSchedulerLoop(deps);
    startSchedulerLoop(deps);
    await new Promise((resolve) => setTimeout(resolve, 25));

    assert.equal(scheduledCount, 1);
    resetSchedulerLoopForTest();
  } finally {
    cleanup();
  }
});
