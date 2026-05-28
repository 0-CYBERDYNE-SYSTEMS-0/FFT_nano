import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  closeDatabase,
  createAgentRun,
  getAgentRunById,
  initDatabaseAtPath,
  listRecoverableAgentRuns,
  updateAgentRun,
} from '../src/db.js';

test('in-flight run with surviving worktree is triaged as recoverable on restart', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-recovery-'));
  const dbPath = path.join(tmpRoot, 'messages.db');
  const worktree = path.join(tmpRoot, 'worktree');
  fs.mkdirSync(worktree, { recursive: true });
  try {
    initDatabaseAtPath(dbPath);
    const run = createAgentRun({
      id: 'run-recoverable',
      chatJid: 'telegram:1',
      groupFolder: 'main',
      kind: 'agent_long',
      prompt: 'long coding task',
    });
    updateAgentRun(run.id, {
      status: 'running',
      worktree_path: worktree,
    });

    // Simulate restart.
    closeDatabase();
    initDatabaseAtPath(dbPath);

    const recovered = getAgentRunById(run.id);
    assert.equal(recovered?.status, 'interrupted');
    assert.equal(recovered?.recovery_state, 'recoverable');
    assert.equal(recovered?.error, 'host_restarted_mid_run');
    assert.equal(recovered?.worktree_path, worktree);

    const recoverable = listRecoverableAgentRuns('telegram:1');
    assert.deepEqual(
      recoverable.map((r) => r.id),
      ['run-recoverable'],
    );
  } finally {
    closeDatabase();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('in-flight run without a surviving worktree is triaged as dead on restart', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-recovery-'));
  const dbPath = path.join(tmpRoot, 'messages.db');
  try {
    initDatabaseAtPath(dbPath);
    const run = createAgentRun({
      id: 'run-dead',
      chatJid: 'telegram:1',
      groupFolder: 'main',
      kind: 'agent_long',
      prompt: 'long task with no worktree',
    });
    updateAgentRun(run.id, {
      status: 'running',
      worktree_path: path.join(tmpRoot, 'gone'),
    });

    closeDatabase();
    initDatabaseAtPath(dbPath);

    const recovered = getAgentRunById(run.id);
    assert.equal(recovered?.status, 'failed');
    assert.equal(recovered?.recovery_state, 'dead');
    assert.equal(recovered?.error, 'host_restarted_before_completion');
    assert.equal(listRecoverableAgentRuns().length, 0);
  } finally {
    closeDatabase();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
