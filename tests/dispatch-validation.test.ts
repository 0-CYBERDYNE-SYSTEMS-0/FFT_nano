import assert from 'node:assert/strict';
import test from 'node:test';

import { validateDispatchRequest } from '../src/pipeline/pipeline-dispatcher.js';
import type { PipelineDispatchRequest } from '../src/pipeline/run-pipeline.js';

function base(
  overrides: Partial<PipelineDispatchRequest>,
): PipelineDispatchRequest {
  return {
    requestId: 'r1',
    chatJid: 'telegram:1',
    sessionKey: 's1',
    groupFolder: 'main',
    runType: 'chat',
    ...overrides,
  };
}

test('coding runType with isSubagent=true is rerouted to subagent', () => {
  const { request, warnings } = validateDispatchRequest(
    base({
      runType: 'coding',
      taskText: 'do work',
      config: {
        toolMode: 'full',
        isSubagent: true,
        workspaceMode: 'ephemeral_worktree',
      },
    }),
  );
  assert.equal(request.runType, 'subagent');
  assert.ok(warnings.some((w) => w.includes('subagent')));
});

test('subagent runType with isSubagent=false is rerouted to coding', () => {
  const { request } = validateDispatchRequest(
    base({
      runType: 'subagent',
      taskText: 'do work',
      config: {
        toolMode: 'full',
        isSubagent: false,
        workspaceMode: 'ephemeral_worktree',
      },
    }),
  );
  assert.equal(request.runType, 'coding');
});

test('coding run with no task content falls back to chat', () => {
  const { request, warnings } = validateDispatchRequest(
    base({ runType: 'coding' }),
  );
  assert.equal(request.runType, 'chat');
  assert.ok(warnings.length > 0);
});

test('chat run carrying a stray taskId has it cleared', () => {
  const { request, warnings } = validateDispatchRequest(
    base({ runType: 'chat', prompt: 'hi', taskId: 'task-9' }),
  );
  assert.equal(request.runType, 'chat');
  assert.equal(request.taskId, undefined);
  assert.ok(warnings.some((w) => w.includes('taskId')));
});

test('scheduled run missing taskId is warned but left as scheduled', () => {
  const { request, warnings } = validateDispatchRequest(
    base({ runType: 'scheduled' }),
  );
  assert.equal(request.runType, 'scheduled');
  assert.ok(warnings.some((w) => w.includes('taskId')));
});

test('a clean chat request passes through unchanged with no warnings', () => {
  const { request, warnings } = validateDispatchRequest(
    base({ runType: 'chat', prompt: 'hello', latestUserText: 'hello' }),
  );
  assert.equal(request.runType, 'chat');
  assert.deepEqual(warnings, []);
});
