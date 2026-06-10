import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'fs';
import os from 'os';
import path from 'path';

import Database from 'better-sqlite3';

import {
  closeDatabase,
  createTask,
  getAllTasks,
  getDueTasks,
  initDatabaseAtPath,
  updateTask,
} from '../src/db.js';
import { ScheduledTask } from '../src/types.js';

test('VAL-WS2-001: scheduled_tasks.created_by column exists post-migration on fresh DB', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-migrations-'));
  const dbPath = path.join(tmpRoot, 'messages.db');
  try {
    initDatabaseAtPath(dbPath);

    // Verify column exists via PRAGMA table_info
    const db2 = new Database(dbPath);
    const info = db2.prepare(`PRAGMA table_info('scheduled_tasks')`).all() as Array<{
      name: string;
      dflt_value: string | null;
    }>;
    db2.close();

    const createdByCol = info.find((col) => col.name === 'created_by');
    assert.ok(createdByCol, 'created_by column must exist');
    assert.equal(createdByCol.dflt_value, "'operator'", 'default value must be operator');
  } finally {
    closeDatabase();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('VAL-WS2-001: migration is idempotent - running twice does not throw', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-migrations-'));
  const dbPath = path.join(tmpRoot, 'messages.db');
  try {
    // First init
    initDatabaseAtPath(dbPath);
    closeDatabase();

    // Second init (re-run migrations) - should not throw
    initDatabaseAtPath(dbPath);
    closeDatabase();

    // Third init - still should not throw
    initDatabaseAtPath(dbPath);
  } finally {
    closeDatabase();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('VAL-WS2-002: status=pending_approval is accepted without CHECK constraint violation', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-migrations-'));
  const dbPath = path.join(tmpRoot, 'messages.db');
  try {
    initDatabaseAtPath(dbPath);

    // Create a task with pending_approval status via updateTask
    const taskId = 'test-pending-approval-task';
    createTask({
      id: taskId,
      group_folder: 'test-group',
      chat_jid: 'telegram:123',
      prompt: 'test prompt',
      schedule_type: 'once',
      schedule_value: new Date(Date.now() + 60000).toISOString(),
      context_mode: 'isolated',
      next_run: new Date(Date.now() + 60000).toISOString(),
      status: 'active',
      created_at: new Date().toISOString(),
    });

    // Update to pending_approval
    updateTask(taskId, { status: 'pending_approval' });

    // Verify the task is still in getAllTasks
    const allTasks = getAllTasks();
    const task = allTasks.find((t) => t.id === taskId);
    assert.ok(task, 'task should exist in getAllTasks');
    assert.equal(task.status, 'pending_approval', 'status should be pending_approval');

    // Verify getDueTasks does NOT return pending_approval tasks
    const dueTasks = getDueTasks();
    const dueTask = dueTasks.find((t) => t.id === taskId);
    assert.ok(!dueTask, 'pending_approval task should NOT appear in getDueTasks');
  } finally {
    closeDatabase();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('createTask writes created_by field with default operator', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-migrations-'));
  const dbPath = path.join(tmpRoot, 'messages.db');
  try {
    initDatabaseAtPath(dbPath);

    createTask({
      id: 'test-created-by-task',
      group_folder: 'test-group',
      chat_jid: 'telegram:123',
      prompt: 'test prompt',
      schedule_type: 'cron',
      schedule_value: '*/5 * * * *',
      context_mode: 'isolated',
      next_run: new Date(Date.now() + 300000).toISOString(),
      status: 'active',
      created_at: new Date().toISOString(),
    });

    const task = getAllTasks().find((t) => t.id === 'test-created-by-task');
    assert.ok(task, 'task should be created');
    assert.equal(task.created_by, 'operator', 'created_by should default to operator');
  } finally {
    closeDatabase();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('updateTask accepts status: pending_approval without runtime error', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-migrations-'));
  const dbPath = path.join(tmpRoot, 'messages.db');
  try {
    initDatabaseAtPath(dbPath);

    createTask({
      id: 'test-update-status',
      group_folder: 'test-group',
      chat_jid: 'telegram:123',
      prompt: 'test prompt',
      schedule_type: 'once',
      schedule_value: new Date(Date.now() + 60000).toISOString(),
      context_mode: 'isolated',
      next_run: new Date(Date.now() + 60000).toISOString(),
      status: 'active',
      created_at: new Date().toISOString(),
    });

    // This should not throw
    updateTask('test-update-status', { status: 'pending_approval' });

    const task = getAllTasks().find((t) => t.id === 'test-update-status');
    assert.equal(task.status, 'pending_approval', 'status should be updated to pending_approval');
  } finally {
    closeDatabase();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
