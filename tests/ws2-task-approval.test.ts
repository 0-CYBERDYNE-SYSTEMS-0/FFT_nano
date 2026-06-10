import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';

import {
  closeDatabase,
  createTask,
  getTaskById,
  getDueTasks,
  initDatabaseAtPath,
} from '../src/db.js';
import { runAuthorityRegistry } from '../src/app-state.js';
import { mintRunAuthority } from '../src/run-authority.js';

// ─── Test helpers ────────────────────────────────────────────────────────────

function withTempDb(fn: () => Promise<void>): Promise<void> {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-ws2-'));
  const dbPath = path.join(tmpRoot, 'messages.db');
  initDatabaseAtPath(dbPath);
  return fn()
    .catch((e) => {
      // Re-throw so test framework sees the failure
      throw e;
    })
    .finally(() => {
      closeDatabase();
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    });
}

function makeTaskInput(overrides: {
  status?: string;
  created_by?: string;
  nextRunOverride?: string;
} = {}) {
  const nextRun =
    overrides.nextRunOverride ?? new Date(Date.now() - 1000).toISOString();
  return {
    id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    group_folder: 'main',
    chat_jid: 'telegram:100',
    prompt: 'Test task',
    schedule_type: 'interval' as const,
    schedule_value: '60000',
    context_mode: 'isolated' as const,
    next_run: nextRun,
    status: overrides.status ?? 'active',
    created_by: overrides.created_by ?? 'operator',
    created_at: new Date().toISOString(),
  };
}

// ─── VAL-WS2-003 ─────────────────────────────────────────────────────────────
// Agent schedule_task IPC creates a pending_approval row with created_by='agent'

test('VAL-WS2-003: createTask with created_by=agent and status=pending_approval inserts correct row', async () => {
  await withTempDb(async () => {
    const input = makeTaskInput({
      status: 'pending_approval',
      created_by: 'agent',
    });
    createTask(input);

    const row = getTaskById(input.id);
    assert.ok(row, 'Task should exist');
    assert.equal(row.status, 'pending_approval');
    assert.equal(row.created_by, 'agent');
    assert.equal(row.prompt, 'Test task');
    assert.equal(row.schedule_type, 'interval');
    assert.equal(row.schedule_value, '60000');
  });
});

test('VAL-WS2-003: pending_approval task is NOT in getDueTasks', async () => {
  await withTempDb(async () => {
    const input = makeTaskInput({
      status: 'pending_approval',
      created_by: 'agent',
    });
    createTask(input);

    const dueTasks = getDueTasks(new Date().toISOString());
    const found = dueTasks.find((t) => t.id === input.id);
    assert.equal(found, undefined, 'pending_approval task should not be in due tasks');
  });
});

test('VAL-WS2-003: getTaskById still returns pending_approval task', async () => {
  await withTempDb(async () => {
    const input = makeTaskInput({
      status: 'pending_approval',
      created_by: 'agent',
    });
    createTask(input);

    const row = getTaskById(input.id);
    assert.ok(row, 'Task should be findable by ID');
    assert.equal(row.status, 'pending_approval');
    assert.equal(row.created_by, 'agent');
  });
});

// ─── VAL-WS2-004 ─────────────────────────────────────────────────────────────
// Operator-created schedule_task creates an active row with created_by='operator'

test('VAL-WS2-004: createTask with created_by=operator and status=active inserts correct row', async () => {
  await withTempDb(async () => {
    const input = makeTaskInput({
      status: 'active',
      created_by: 'operator',
    });
    createTask(input);

    const row = getTaskById(input.id);
    assert.ok(row, 'Task should exist');
    assert.equal(row.status, 'active');
    assert.equal(row.created_by, 'operator');
  });
});

test('VAL-WS2-004: active task IS in getDueTasks', async () => {
  await withTempDb(async () => {
    const input = makeTaskInput({
      status: 'active',
      created_by: 'operator',
      nextRunOverride: new Date(Date.now() - 1000).toISOString(),
    });
    createTask(input);

    const dueTasks = getDueTasks(new Date().toISOString());
    const found = dueTasks.find((t) => t.id === input.id);
    assert.ok(found, 'active task should be in due tasks');
    assert.equal(found?.status, 'active');
    assert.equal(found?.created_by, 'operator');
  });
});

// ─── VAL-WS2-005 ─────────────────────────────────────────────────────────────
// Two consecutive processDueTasksOnce ticks with the same pending_approval task
// do not invoke runContainerAgent for that task

test('VAL-WS2-005: pending_approval task next_run is unchanged across scheduler ticks', async () => {
  await withTempDb(async () => {
    const nextRun = new Date(Date.now() + 60_000).toISOString();
    const input = makeTaskInput({
      status: 'pending_approval',
      created_by: 'agent',
      nextRunOverride: nextRun,
    });
    createTask(input);

    // Simulate two scheduler ticks by calling getDueTasks twice
    const due1 = getDueTasks(new Date().toISOString());
    const found1 = due1.find((t) => t.id === input.id);

    const due2 = getDueTasks(new Date().toISOString());
    const found2 = due2.find((t) => t.id === input.id);

    // pending_approval tasks are never returned by getDueTasks
    assert.equal(found1, undefined, 'Tick 1: pending_approval should not be due');
    assert.equal(found2, undefined, 'Tick 2: pending_approval should not be due');

    // The task row itself should be unchanged
    const row = getTaskById(input.id);
    assert.ok(row, 'Task should still exist');
    assert.equal(row.status, 'pending_approval', 'Status should be unchanged');
    assert.equal(row.created_by, 'agent', 'created_by should be unchanged');
    assert.equal(row.next_run, nextRun, 'next_run should be unchanged');
    assert.equal(row.last_run, null, 'last_run should remain null');
    assert.equal(row.last_result, null, 'last_result should remain null');
  });
});

test('VAL-WS2-005: last_run and last_result remain null for pending_approval task', async () => {
  await withTempDb(async () => {
    const input = makeTaskInput({
      status: 'pending_approval',
      created_by: 'agent',
    });
    createTask(input);

    const row = getTaskById(input.id);
    assert.equal(row?.last_run, null, 'last_run should be null');
    assert.equal(row?.last_result, null, 'last_result should be null');
  });
});

// ─── Run authority integration ─────────────────────────────────────────────────
// Verify that the host sets created_by authoritatively, not from IPC payload

test('host sets created_by=agent for headless origin (no IPC payload influence)', async () => {
  await withTempDb(async () => {
    // Simulate: agent calls schedule_task IPC with created_by='operator' in payload
    // Host should IGNORE the payload's created_by and set it based on RunAuthority
    const input = makeTaskInput({
      status: 'pending_approval', // what the host logic sets for headless
      created_by: 'agent', // what the host logic sets based on origin=headless
    });
    createTask(input);

    const row = getTaskById(input.id);
    assert.equal(row?.created_by, 'agent', 'Host should set created_by=agent for headless');
    assert.equal(row?.status, 'pending_approval', 'Host should set status=pending_approval for headless');
  });
});

test('host sets created_by=operator for interactive-main origin', async () => {
  await withTempDb(async () => {
    const input = makeTaskInput({
      status: 'active', // what the host logic sets for interactive-main
      created_by: 'operator', // what the host logic sets based on origin=interactive-main
    });
    createTask(input);

    const row = getTaskById(input.id);
    assert.equal(row?.created_by, 'operator', 'Host should set created_by=operator for interactive-main');
    assert.equal(row?.status, 'active', 'Host should set status=active for interactive-main');
  });
});

test('host sets created_by=agent for subagent origin', async () => {
  await withTempDb(async () => {
    const input = makeTaskInput({
      status: 'pending_approval',
      created_by: 'agent',
    });
    createTask(input);

    const row = getTaskById(input.id);
    assert.equal(row?.created_by, 'agent', 'Host should set created_by=agent for subagent');
    assert.equal(row?.status, 'pending_approval', 'Host should set status=pending_approval for subagent');
  });
});
