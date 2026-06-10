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

test('VAL-WS4-001: evaluator_verdicts.skipped column exists post-migration on fresh DB', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-migrations-'));
  const dbPath = path.join(tmpRoot, 'messages.db');
  try {
    initDatabaseAtPath(dbPath);

    // Verify column exists via PRAGMA table_info
    const db2 = new Database(dbPath);
    const info = db2.prepare(`PRAGMA table_info('evaluator_verdicts')`).all() as Array<{
      name: string;
      dflt_value: string | null;
    }>;
    db2.close();

    const skippedCol = info.find((col) => col.name === 'skipped');
    assert.ok(skippedCol, 'skipped column must exist');
    assert.equal(skippedCol.dflt_value, '0', 'default value must be 0');
  } finally {
    closeDatabase();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('VAL-WS4-002: evaluator_verdicts.skip_reason column exists post-migration', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-migrations-'));
  const dbPath = path.join(tmpRoot, 'messages.db');
  try {
    initDatabaseAtPath(dbPath);

    // Verify column exists via PRAGMA table_info
    const db2 = new Database(dbPath);
    const info = db2.prepare(`PRAGMA table_info('evaluator_verdicts')`).all() as Array<{
      name: string;
      dflt_value: string | null;
    }>;
    db2.close();

    const skipReasonCol = info.find((col) => col.name === 'skip_reason');
    assert.ok(skipReasonCol, 'skip_reason column must exist');
    // skip_reason has null default (no dflt_value means NULL)
    assert.equal(skipReasonCol.dflt_value, null, 'skip_reason default should be null');
  } finally {
    closeDatabase();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('VAL-WS4-001/002: evaluator_verdicts migration is idempotent - running twice does not throw', () => {
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

test('VAL-WS5-001: learning_injections table exists post-migration with six columns', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-migrations-'));
  const dbPath = path.join(tmpRoot, 'messages.db');
  try {
    initDatabaseAtPath(dbPath);

    const db2 = new Database(dbPath);
    const info = db2.prepare(`PRAGMA table_info('learning_injections')`).all() as Array<{
      name: string;
      type: string;
      dflt_value: string | null;
      notnull: number;
    }>;
    db2.close();

    assert.equal(info.length, 6, 'learning_injections must have exactly 6 columns');

    const colNames = info.map((c) => c.name);
    assert.ok(colNames.includes('id'), 'id column must exist');
    assert.ok(colNames.includes('request_id'), 'request_id column must exist');
    assert.ok(colNames.includes('group_folder'), 'group_folder column must exist');
    assert.ok(colNames.includes('kind'), 'kind column must exist');
    assert.ok(colNames.includes('item'), 'item column must exist');
    assert.ok(colNames.includes('created_at'), 'created_at column must exist');

    // Verify column types
    const idCol = info.find((c) => c.name === 'id');
    assert.equal(idCol?.type, 'INTEGER', 'id must be INTEGER');

    const requestIdCol = info.find((c) => c.name === 'request_id');
    assert.equal(requestIdCol?.type, 'TEXT', 'request_id must be TEXT');

    const groupFolderCol = info.find((c) => c.name === 'group_folder');
    assert.equal(groupFolderCol?.type, 'TEXT', 'group_folder must be TEXT');

    const kindCol = info.find((c) => c.name === 'kind');
    assert.equal(kindCol?.type, 'TEXT', 'kind must be TEXT');

    const itemCol = info.find((c) => c.name === 'item');
    assert.equal(itemCol?.type, 'TEXT', 'item must be TEXT');

    const createdAtCol = info.find((c) => c.name === 'created_at');
    assert.equal(createdAtCol?.type, 'TEXT', 'created_at must be TEXT');
  } finally {
    closeDatabase();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('VAL-WS5-001: idx_learning_injections_request index exists on learning_injections(request_id)', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-migrations-'));
  const dbPath = path.join(tmpRoot, 'messages.db');
  try {
    initDatabaseAtPath(dbPath);

    const db2 = new Database(dbPath);
    const indexes = db2.prepare(`PRAGMA index_list('learning_injections')`).all() as Array<{
      name: string;
      unique: number;
      origin: string;
    }>;
    db2.close();

    const requestIndex = indexes.find((idx) => idx.name === 'idx_learning_injections_request');
    assert.ok(requestIndex, 'idx_learning_injections_request index must exist');
  } finally {
    closeDatabase();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('VAL-WS5-001: learning_injections migration is idempotent - running twice does not throw', () => {
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
