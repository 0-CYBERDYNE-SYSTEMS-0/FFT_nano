import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  closeDatabase,
  createTask,
  getAllTasks,
  getDb,
  getDeliveryByDedupeKey,
  getTaskById,
  initDatabaseAtPath,
  listPendingDeliveries,
} from '../src/db.js';
import { createOutboxDeliverer } from '../src/outbox.js';
import { formatLearningDigest } from '../src/telegram-delivery.js';
import {
  DEFAULT_MAINTENANCE_TASK_DEFINITIONS,
  ensureDefaultMaintenanceTasks,
  maybeFireErrorStreakAlert,
  resolveErrorStreakAlertTrigger,
} from '../src/scheduled-maintenance.js';
import type { ScheduledTask } from '../src/types.js';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fft-spec06-'));
}

function makeTempDbPath(): string {
  const dir = makeTmpDir();
  return path.join(dir, 'messages.db');
}

function makeTaskFixture(overrides: Partial<ScheduledTask> = {}): Omit<
  ScheduledTask,
  'last_run' | 'last_result'
> {
  const now = new Date().toISOString();
  return {
    id: overrides.id || 'task-fixture',
    group_folder: overrides.group_folder || 'main',
    chat_jid: overrides.chat_jid || 'telegram:main',
    prompt: overrides.prompt || 'fixture prompt',
    schedule_type: overrides.schedule_type || 'cron',
    schedule_value: overrides.schedule_value || '0 3 * * 0',
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
    delete_after_run: overrides.delete_after_run ?? 0,
    consecutive_errors: overrides.consecutive_errors ?? 0,
    subagent_type: overrides.subagent_type || null,
    next_run: overrides.next_run || now,
    status: overrides.status || 'active',
    created_at: overrides.created_at || now,
  };
}

// ---------------------------------------------------------------------------
// Test 1: ensureDefaultMaintenanceTasks() seeds three default tasks
//   - exactly three rows on empty scheduled_tasks (expected ids + cron
//     schedule_values), idempotent across calls, and does not mutate
//     consecutive_errors / status on existing rows.
// ---------------------------------------------------------------------------

test.describe('SPEC-06: ensureDefaultMaintenanceTasks seeds default cron tasks', () => {
  test('seeds exactly three default tasks on an empty scheduled_tasks table', () => {
    const dbPath = makeTempDbPath();
    initDatabaseAtPath(dbPath);
    try {
      const before = getAllTasks();
      assert.equal(before.length, 0, 'precondition: scheduled_tasks empty');

      const result = ensureDefaultMaintenanceTasks({
        mainChatJid: 'telegram:main',
      });

      assert.equal(result.created, 3);
      assert.equal(result.existing, 0);
      assert.equal(result.taskIds.length, 3);

      const tasks = getAllTasks();
      assert.equal(tasks.length, 3);

      const byId = new Map(tasks.map((t) => [t.id, t]));
      assert.ok(
        byId.has('task-main-knowledge-nightly-lint'),
        'must seed knowledge nightly lint',
      );
      assert.ok(
        byId.has('task-main-weekly-librarian'),
        'must seed weekly librarian',
      );
      assert.ok(
        byId.has('task-main-weekly-reflect'),
        'must seed weekly reflect',
      );

      for (const task of tasks) {
        assert.equal(task.schedule_type, 'cron');
        assert.equal(task.group_folder, 'main');
        assert.equal(task.delivery_mode, 'none');
        assert.equal(task.status, 'active');
      }

      assert.equal(
        byId.get('task-main-knowledge-nightly-lint')?.schedule_value,
        '17 2 * * *',
      );
      assert.equal(
        byId.get('task-main-weekly-librarian')?.schedule_value,
        '0 3 * * 0',
      );
      assert.equal(
        byId.get('task-main-weekly-reflect')?.schedule_value,
        '30 3 * * 0',
      );

      const defined = DEFAULT_MAINTENANCE_TASK_DEFINITIONS;
      assert.equal(defined.length, 3);
      const definedIds = defined.map((d) => d.id).sort();
      assert.deepEqual(
        definedIds,
        [
          'task-main-knowledge-nightly-lint',
          'task-main-weekly-librarian',
          'task-main-weekly-reflect',
        ].sort(),
      );
    } finally {
      closeDatabase();
    }
  });

  test('idempotent: a second call creates zero new rows and does not mutate existing state', () => {
    const dbPath = makeTempDbPath();
    initDatabaseAtPath(dbPath);
    try {
      const first = ensureDefaultMaintenanceTasks({
        mainChatJid: 'telegram:main',
      });
      assert.equal(first.created, 3);

      // Mutate one row in-place to verify the second call does not clobber
      // it. Use the raw handle because the public updateTask helper does not
      // expose consecutive_errors / status.
      const target = getTaskById('task-main-knowledge-nightly-lint');
      assert.ok(target);
      const handle = getDb();
      assert.ok(handle, 'db handle must be initialised');
      handle
        .prepare(
          'UPDATE scheduled_tasks SET consecutive_errors = ?, status = ? WHERE id = ?',
        )
        .run(7, 'paused', 'task-main-knowledge-nightly-lint');

      const second = ensureDefaultMaintenanceTasks({
        mainChatJid: 'telegram:main',
      });
      assert.equal(second.created, 0);
      assert.equal(second.existing, 3);
      assert.equal(getAllTasks().length, 3);

      const preserved = getTaskById('task-main-knowledge-nightly-lint');
      assert.ok(preserved);
      assert.equal(
        preserved.consecutive_errors,
        7,
        'must not reset consecutive_errors on existing row',
      );
      assert.equal(preserved.status, 'paused', 'must not reset status');
    } finally {
      closeDatabase();
    }
  });
});

// ---------------------------------------------------------------------------
// Test 2: Error-streak witness
//   - feeding consecutive_errors stepping 1→2→3 → exactly one outbox row
//     with dedupe key task-error-streak:<id>:3; re-simulating the same
//     count → still one row; 4 → still one; 6 → a second row.
// ---------------------------------------------------------------------------

test.describe('SPEC-06: error-streak witness escalates per N', () => {
  test('fires exactly once at threshold, then again at every Nth multiple', async () => {
    const dbPath = makeTempDbPath();
    initDatabaseAtPath(dbPath);
    try {
      const sends: Array<{ jid: string; text: string }> = [];
      // sendMessage returns false so rows stay pending — listPendingDeliveries
      // is then a reliable witness of "rows created", not "rows delivered".
      const outbox = createOutboxDeliverer({
        sendMessage: async (jid, text) => {
          sends.push({ jid, text });
          return false;
        },
      });

      const taskId = 'task-main-knowledge-nightly-lint';
      const dedupeKeyFor = (count: number) =>
        `task-error-streak:${taskId}:${count}`;

      // Trigger uses the recomputed post-run value. For streak counts below
      // the threshold the helper returns null (no alert). At/above the
      // threshold every multiple of N returns true.
      assert.equal(
        resolveErrorStreakAlertTrigger(1, 3),
        null,
        'below threshold: no alert',
      );
      assert.equal(
        resolveErrorStreakAlertTrigger(2, 3),
        null,
        'one below threshold: no alert',
      );
      assert.equal(
        resolveErrorStreakAlertTrigger(3, 3),
        true,
        'at threshold: alert',
      );
      assert.equal(
        resolveErrorStreakAlertTrigger(4, 3),
        null,
        'one above but not a multiple: no alert',
      );
      assert.equal(
        resolveErrorStreakAlertTrigger(6, 3),
        true,
        'second multiple: alert',
      );
      assert.equal(
        resolveErrorStreakAlertTrigger(9, 3),
        true,
        'third multiple: alert',
      );

      const destination = 'telegram:main';

      // Simulate runs 1 → 2 → 3.
      for (const count of [1, 2, 3]) {
        const ok = await maybeFireErrorStreakAlert({
          task: makeTaskFixture({
            id: taskId,
            consecutive_errors: count,
          }) as ScheduledTask,
          consecutiveErrors: count,
          threshold: 3,
          destination,
          outbox,
          now: new Date('2026-07-07T12:00:00Z'),
        });
        assert.equal(ok, count === 3);
      }

      const pendingAfter3 = listPendingDeliveries();
      assert.equal(
        pendingAfter3.length,
        1,
        'exactly one outbox row at threshold=3',
      );
      assert.equal(pendingAfter3[0].dedupe_key, dedupeKeyFor(3));
      assert.equal(pendingAfter3[0].destination, destination);

      // Re-simulate the same count → still one row (dedupe).
      const re3 = await maybeFireErrorStreakAlert({
        task: makeTaskFixture({
          id: taskId,
          consecutive_errors: 3,
        }) as ScheduledTask,
        consecutiveErrors: 3,
        threshold: 3,
        destination,
        outbox,
        now: new Date('2026-07-07T12:01:00Z'),
      });
      assert.equal(re3, false, 'dedupe: second sim at count=3 returns false');
      assert.equal(listPendingDeliveries().length, 1);

      // 4 → still one row (not a multiple of 3).
      await maybeFireErrorStreakAlert({
        task: makeTaskFixture({
          id: taskId,
          consecutive_errors: 4,
        }) as ScheduledTask,
        consecutiveErrors: 4,
        threshold: 3,
        destination,
        outbox,
        now: new Date('2026-07-07T12:02:00Z'),
      });
      assert.equal(listPendingDeliveries().length, 1);

      // 6 → a second row.
      await maybeFireErrorStreakAlert({
        task: makeTaskFixture({
          id: taskId,
          consecutive_errors: 6,
        }) as ScheduledTask,
        consecutiveErrors: 6,
        threshold: 3,
        destination,
        outbox,
        now: new Date('2026-07-07T12:03:00Z'),
      });
      const pendingAfter6 = listPendingDeliveries();
      assert.equal(
        pendingAfter6.length,
        2,
        'second multiple (6) creates a new row',
      );
      const dedupeKeys = pendingAfter6.map((row) => row.dedupe_key).sort();
      assert.deepEqual(dedupeKeys, [
        dedupeKeyFor(3),
        dedupeKeyFor(6),
      ]);

      // Verify the outbox message includes task id and error count.
      const row6 = getDeliveryByDedupeKey(dedupeKeyFor(6));
      assert.ok(row6);
      assert.match(row6.body, new RegExp(taskId));
      assert.match(row6.body, /6\b/);
    } finally {
      closeDatabase();
    }
  });

  test('threshold=0 disables the witness; rows stay empty', async () => {
    const dbPath = makeTempDbPath();
    initDatabaseAtPath(dbPath);
    try {
      const outbox = createOutboxDeliverer({
        sendMessage: async () => true,
      });
      for (const count of [1, 3, 6, 9]) {
        const fired = await maybeFireErrorStreakAlert({
          task: makeTaskFixture({
            id: 'task-disabled',
            consecutive_errors: count,
          }) as ScheduledTask,
          consecutiveErrors: count,
          threshold: 0,
          destination: 'telegram:main',
          outbox,
          now: new Date(),
        });
        assert.equal(fired, false, `count=${count} should not fire`);
      }
      assert.equal(listPendingDeliveries().length, 0);
    } finally {
      closeDatabase();
    }
  });
});

// ---------------------------------------------------------------------------
// Test 3: Curator-tick reconciliation
//   - delete one of the three seeded tasks from a fixture DB, invoke the
//     reconciliation call → the deleted task reappears with original id
//     and schedule; the two untouched tasks are unchanged (no duplicate rows).
// ---------------------------------------------------------------------------

test.describe('SPEC-06: curator-tick reconciliation recreates missing tasks', () => {
  test('deleted default task is recreated with same id and schedule', async () => {
    const dbPath = makeTempDbPath();
    initDatabaseAtPath(dbPath);
    try {
      ensureDefaultMaintenanceTasks({ mainChatJid: 'telegram:main' });
      assert.equal(getAllTasks().length, 3);

      // Operator cancels the weekly-librarian task.
      const cancelled = getTaskById('task-main-weekly-librarian');
      assert.ok(cancelled);
      // Mirror what `/tasks cancel` does.
      const dbModule = await import('../src/db.js');
      const db = dbModule.getDb();
      assert.ok(db, 'db must be initialised');
      db.prepare('DELETE FROM task_run_logs WHERE task_id = ?').run(
        cancelled.id,
      );
      db.prepare('DELETE FROM scheduled_tasks WHERE id = ?').run(cancelled.id);
      assert.equal(getAllTasks().length, 2);

      // Next curator tick runs the reconciliation again.
      const result = ensureDefaultMaintenanceTasks({
        mainChatJid: 'telegram:main',
      });
      assert.equal(result.created, 1);
      assert.equal(result.existing, 2);
      assert.equal(getAllTasks().length, 3);

      const restored = getTaskById('task-main-weekly-librarian');
      assert.ok(restored, 'cancelled task must be restored');
      assert.equal(restored.schedule_value, '0 3 * * 0');
      assert.equal(restored.schedule_type, 'cron');
      assert.equal(restored.group_folder, 'main');
      assert.equal(restored.delivery_mode, 'none');
      assert.equal(restored.status, 'active');

      const otherIds = getAllTasks()
        .map((t) => t.id)
        .filter((id) => id !== 'task-main-weekly-librarian')
        .sort();
      assert.deepEqual(otherIds, [
        'task-main-knowledge-nightly-lint',
        'task-main-weekly-reflect',
      ]);
    } finally {
      closeDatabase();
    }
  });
});

// ---------------------------------------------------------------------------
// Test 4: formatLearningDigest maintenance section
//   - feed a fixture task at consecutive_errors=5 (above default threshold 3)
//     → digest text contains the task id and error count; feed zero
//     scheduled tasks → digest text flags the empty-schedule case explicitly
//     (distinct string).
// ---------------------------------------------------------------------------

test.describe('SPEC-06: formatLearningDigest surfaces maintenance health', () => {
  test('lists tasks above the alert threshold with id and error count', async () => {
    const dbPath = makeTempDbPath();
    initDatabaseAtPath(dbPath);
    try {
      // Seed a single unhealthy default task.
      ensureDefaultMaintenanceTasks({ mainChatJid: 'telegram:main' });
      const dbModule = await import('../src/db.js');
      const db = dbModule.getDb();
      assert.ok(db, 'db must be initialised');
      db.prepare(
        'UPDATE scheduled_tasks SET consecutive_errors = ? WHERE id = ?',
      ).run(5, 'task-main-knowledge-nightly-lint');

      const digest = formatLearningDigest();
      assert.match(
        digest,
        /Scheduled maintenance/,
        `digest must include "Scheduled maintenance" header`,
      );
      assert.match(
        digest,
        /task-main-knowledge-nightly-lint/,
        `digest must include the unhealthy task id`,
      );
      assert.match(
        digest,
        /errors[=: ]?5/i,
        `digest must surface the consecutive_errors count`,
      );
    } finally {
      closeDatabase();
    }
  });

  test('flags empty scheduled_tasks table explicitly', () => {
    const dbPath = makeTempDbPath();
    initDatabaseAtPath(dbPath);
    try {
      // No seed: scheduled_tasks is empty.
      const digest = formatLearningDigest();
      assert.match(
        digest,
        /Scheduled maintenance/,
        'digest still includes the maintenance section header',
      );
      assert.match(
        digest,
        /no scheduled tasks|empty schedule|0 active/i,
        `digest must flag the empty-schedule case; got:\n${digest}`,
      );
      assert.ok(
        !/0 skill mutations/i.test(digest),
        'empty-schedule line must be distinct from "0 skill mutations"',
      );
    } finally {
      closeDatabase();
    }
  });
});
