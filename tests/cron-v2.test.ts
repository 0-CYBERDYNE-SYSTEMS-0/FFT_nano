import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import test from 'node:test';

import {
  resolveCronExecutionPlan,
  resolveCronPolicy,
  resolveNoContinueForTask,
} from '../src/cron/adapters.ts';
import {
  computeErrorBackoffMs,
  getTaskDeliveryMode,
  resolveTaskNextRun,
  runScheduledTaskV2,
  shouldTriggerWakeNow,
} from '../src/cron/service.ts';
import { PARITY_CONFIG } from '../src/config.ts';
import { closeDatabase, createTask, getTaskById, initDatabaseAtPath } from '../src/db.ts';
import type { RegisteredGroup, ScheduledTask } from '../src/types.ts';

function makeTempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-cron-v2-'));
  return path.join(dir, 'messages.db');
}

function makeTask(
  overrides: Partial<ScheduledTask>,
): Omit<ScheduledTask, 'last_run' | 'last_result'> {
  const now = new Date().toISOString();
  return {
    id: overrides.id || `task-${Date.now()}`,
    group_folder: overrides.group_folder || 'main',
    chat_jid: overrides.chat_jid || 'telegram:1',
    prompt: overrides.prompt || 'ping',
    schedule_type: overrides.schedule_type || 'once',
    schedule_value: overrides.schedule_value || now,
    context_mode: overrides.context_mode || 'isolated',
    schedule_json: overrides.schedule_json || null,
    session_target: overrides.session_target || 'isolated',
    wake_mode: overrides.wake_mode || 'next-heartbeat',
    delivery_mode: overrides.delivery_mode || 'none',
    delivery_channel: overrides.delivery_channel || null,
    delivery_to: overrides.delivery_to || null,
    delivery_webhook_url: overrides.delivery_webhook_url || null,
    timeout_seconds: overrides.timeout_seconds || null,
    stagger_ms: overrides.stagger_ms || null,
    delete_after_run: overrides.delete_after_run || 0,
    consecutive_errors: overrides.consecutive_errors || 0,
    next_run: overrides.next_run || now,
    status: overrides.status || 'active',
    created_at: overrides.created_at || now,
  };
}

test('cron adapter accepts v2 schedule payload and computes next run', () => {
  const plan = resolveCronExecutionPlan({
    schedule: { kind: 'every', everyMs: 120000 },
  });
  assert.equal(plan.scheduleType, 'interval');
  assert.equal(plan.scheduleValue, '120000');
  assert.ok(plan.nextRun);
});

test('cron adapter rejects non-positive everyMs (0)', () => {
  assert.throws(
    () =>
      resolveCronExecutionPlan({
        schedule: { kind: 'every', everyMs: 0 },
      }),
    /Invalid schedule payload/,
  );
});

test('cron adapter rejects non-positive everyMs (-1)', () => {
  assert.throws(
    () =>
      resolveCronExecutionPlan({
        schedule: { kind: 'every', everyMs: -1 },
      }),
    /Invalid schedule payload/,
  );
});

test('cron adapter rejects malformed schedule payload when schedule is present', () => {
  assert.throws(
    () =>
      resolveCronExecutionPlan({
        schedule: { kind: 'every' } as unknown as { kind: 'every'; everyMs: number },
      }),
    /Invalid schedule payload/,
  );
});

test('cron adapter rejects timezone-suffixed once/at timestamps', () => {
  assert.throws(
    () =>
      resolveCronExecutionPlan({
        schedule: { kind: 'at', at: '2026-02-01T15:30:00Z' },
      }),
    /local time without timezone suffix/,
  );

  assert.throws(
    () =>
      resolveCronExecutionPlan({
        schedule_type: 'once',
        schedule_value: '2026-02-01T15:30:00+02:00',
      }),
    /local time without timezone suffix/,
  );
});

test('cron policy defaults isolated runs to announce when delivery omitted', () => {
  const policy = resolveCronPolicy({
    session_target: 'isolated',
  });
  assert.equal(policy.delivery.mode, 'announce');
});

test('context_mode isolated forces noContinue while group mode reuses session', () => {
  assert.equal(
    resolveNoContinueForTask(makeTask({ context_mode: 'isolated' }) as ScheduledTask),
    true,
  );
  assert.equal(
    resolveNoContinueForTask(makeTask({ context_mode: 'group' }) as ScheduledTask),
    false,
  );
});

test('cron error backoff schedule grows with consecutive errors', () => {
  assert.equal(computeErrorBackoffMs(1), 30000);
  assert.equal(computeErrorBackoffMs(2), 60000);
  assert.equal(computeErrorBackoffMs(5), 3600000);
  assert.equal(computeErrorBackoffMs(8), 3600000);
});

test('resolveTaskNextRun applies backoff on errors for recurring tasks', () => {
  const now = Date.now();
  const task = makeTask({
    schedule_type: 'interval',
    schedule_value: '1000',
  }) as ScheduledTask;
  const nextNormal = resolveTaskNextRun(task, now, false, 0);
  const nextError = resolveTaskNextRun(task, now, true, 1);
  assert.ok(nextNormal);
  assert.ok(nextError);
  assert.ok(new Date(nextError!).getTime() - now >= 30000);
});

test('resolveTaskNextRun applies deterministic top-of-hour stagger when enabled', () => {
  const originalEnabled = PARITY_CONFIG.cron.deterministicTopOfHourStagger.enabled;
  const originalMax = PARITY_CONFIG.cron.deterministicTopOfHourStagger.maxMs;
  PARITY_CONFIG.cron.deterministicTopOfHourStagger.enabled = true;
  PARITY_CONFIG.cron.deterministicTopOfHourStagger.maxMs = 300000;
  try {
    const task = makeTask({
      id: 'stagger-task',
      schedule_type: 'cron',
      schedule_value: '0 * * * *',
      schedule_json: JSON.stringify({ kind: 'cron', expr: '0 * * * *' }),
    }) as ScheduledTask;
    const now = new Date('2026-02-23T10:05:00.000Z').getTime();
    const nextA = resolveTaskNextRun(task, now, false, 0);
    const nextB = resolveTaskNextRun(task, now, false, 0);
    assert.ok(nextA);
    assert.equal(nextA, nextB);

    const base = new Date('2026-02-23T11:00:00.000Z').getTime();
    const shifted = new Date(nextA!).getTime();
    assert.ok(shifted >= base);
    assert.ok(shifted <= base + 300000);
  } finally {
    PARITY_CONFIG.cron.deterministicTopOfHourStagger.enabled = originalEnabled;
    PARITY_CONFIG.cron.deterministicTopOfHourStagger.maxMs = originalMax;
  }
});

test('runScheduledTaskV2 triggers wake_mode=now and announce delivery', async () => {
  const dbPath = makeTempDbPath();
  initDatabaseAtPath(dbPath);

  const task = makeTask({
    id: 'wake-now-task',
    schedule_type: 'once',
    delivery_mode: 'announce',
    delivery_to: 'telegram:99',
    wake_mode: 'now',
  });
  createTask(task);

  const sentMessages: string[] = [];
  const sentJids: string[] = [];
  const wakeReasons: string[] = [];
  const group: RegisteredGroup = {
    name: 'main',
    folder: 'main',
    trigger: '@FarmFriend',
    added_at: new Date().toISOString(),
  };

  const latest = getTaskById(task.id);
  assert.ok(latest);
  await runScheduledTaskV2(latest!, {
    sendMessage: async (jid, text) => {
      sentJids.push(jid);
      sentMessages.push(text);
    },
    registeredGroups: () => ({ 'telegram:1': group }),
    requestHeartbeatNow: (reason) => {
      if (reason) wakeReasons.push(reason);
    },
    runContainerTask: async () => ({
      status: 'success',
      result: 'done',
    }),
  });

  const postRun = getTaskById(task.id);
  assert.equal(postRun?.status, 'completed');
  assert.equal(getTaskDeliveryMode(task as ScheduledTask), 'announce');
  assert.equal(shouldTriggerWakeNow(task as ScheduledTask), true);
  assert.equal(sentMessages.length, 1);
  assert.deepEqual(sentJids, ['telegram:99']);
  assert.match(sentMessages[0], /\[scheduled:wake-now-task\]/);
  assert.deepEqual(wakeReasons, ['cron:wake-now-task']);

  closeDatabase();
});

test('runScheduledTaskV2 keeps recurring tasks active when group is missing', async () => {
  const dbPath = makeTempDbPath();
  initDatabaseAtPath(dbPath);

  const task = makeTask({
    id: 'missing-group-recurring',
    group_folder: 'ghost-group',
    schedule_type: 'interval',
    schedule_value: '60000',
    next_run: new Date(Date.now() - 1000).toISOString(),
  });
  createTask(task);

  const latest = getTaskById(task.id);
  assert.ok(latest);
  await runScheduledTaskV2(latest!, {
    sendMessage: async () => {},
    registeredGroups: () => ({}),
  });

  const postRun = getTaskById(task.id);
  assert.equal(postRun?.status, 'active');
  assert.ok(postRun?.next_run);
  assert.ok(new Date(postRun!.next_run!).getTime() > Date.now());
  assert.equal(postRun?.consecutive_errors, 1);

  closeDatabase();
});

test('runScheduledTaskV2 preserves typed subagent jobs from older task rows', async () => {
  const dbPath = makeTempDbPath();
  initDatabaseAtPath(dbPath);

  const task = {
    ...makeTask({
      id: 'typed-subagent-task',
      schedule_type: 'once',
    }),
    subagent_type: 'nightly-analyst',
  } as Omit<ScheduledTask, 'last_run' | 'last_result'>;
  createTask(task);

  const group: RegisteredGroup = {
    name: 'main',
    folder: 'main',
    trigger: '@FarmFriend',
    added_at: new Date().toISOString(),
  };

  let subagentCalls = 0;
  let containerCalls = 0;

  const latest = getTaskById(task.id);
  assert.ok(latest);
  await runScheduledTaskV2(latest!, {
    sendMessage: async () => {},
    registeredGroups: () => ({ 'telegram:1': group }),
    runSubagentTask: async (type, groupFolder, prompt, options) => {
      subagentCalls += 1;
      assert.equal(type, 'nightly-analyst');
      assert.equal(groupFolder, 'main');
      assert.equal(prompt, task.prompt);
      assert.equal(options?.chatJid, task.chat_jid);
      return 'typed subagent done';
    },
    runContainerTask: async () => {
      containerCalls += 1;
      return {
        status: 'success',
        result: 'wrong path',
      };
    },
  });

  assert.equal(subagentCalls, 1);
  assert.equal(containerCalls, 0);
  assert.equal(getTaskById(task.id)?.status, 'completed');

  closeDatabase();
});
