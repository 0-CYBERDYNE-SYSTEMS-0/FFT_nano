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
  listActiveAgentRuns,
  listAgentRunsForChat,
  updateAgentRun,
} from '../src/db.js';

test('agent run records can be created, updated, listed, and recovered after restart', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-agent-runs-'));
  const dbPath = path.join(tmpRoot, 'messages.db');
  try {
    initDatabaseAtPath(dbPath);
    const run = createAgentRun({
      id: 'run-test-1',
      chatJid: 'telegram:1',
      groupFolder: 'main',
      kind: 'agent_long',
      prompt: 'do a long task',
    });
    assert.equal(run.status, 'queued');

    updateAgentRun(run.id, {
      status: 'running',
      started_at: '2026-05-24T00:00:00.000Z',
      last_progress_at: '2026-05-24T00:01:00.000Z',
      current_phase: 'tool_running',
      current_detail: 'bash',
      provider: 'zai',
      model: 'glm-4.7',
    });

    const listed = listAgentRunsForChat('telegram:1');
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.current_phase, 'tool_running');
    assert.equal(listed[0]?.provider, 'zai');
    assert.equal(listed[0]?.model, 'glm-4.7');

    closeDatabase();
    initDatabaseAtPath(dbPath);
    const recovered = getAgentRunById(run.id);
    assert.equal(recovered?.status, 'failed');
    assert.equal(recovered?.error, 'host_restarted_before_completion');
    assert.ok(recovered?.finished_at);
  } finally {
    closeDatabase();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('active agent run listing returns queued and running durable long runs', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-agent-runs-'));
  const dbPath = path.join(tmpRoot, 'messages.db');
  try {
    initDatabaseAtPath(dbPath);
    createAgentRun({
      id: 'run-queued',
      chatJid: 'telegram:1',
      groupFolder: 'main',
      kind: 'agent_long',
      prompt: 'queued task',
      createdAt: '2026-05-24T00:00:00.000Z',
    });
    createAgentRun({
      id: 'run-running',
      chatJid: 'telegram:1',
      groupFolder: 'main',
      kind: 'agent_long',
      prompt: 'running task',
      createdAt: '2026-05-24T00:01:00.000Z',
    });
    createAgentRun({
      id: 'run-other-chat',
      chatJid: 'telegram:2',
      groupFolder: 'main',
      kind: 'agent_long',
      prompt: 'other chat task',
      createdAt: '2026-05-24T00:02:00.000Z',
    });
    updateAgentRun('run-running', { status: 'running' });
    updateAgentRun('run-other-chat', { status: 'completed' });

    assert.deepEqual(
      listActiveAgentRuns('telegram:1').map((run) => run.id),
      ['run-queued', 'run-running'],
    );
    assert.deepEqual(
      listActiveAgentRuns().map((run) => run.id),
      ['run-queued', 'run-running'],
    );
  } finally {
    closeDatabase();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
