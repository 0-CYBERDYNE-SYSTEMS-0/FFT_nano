import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createCodingOrchestrator,
  type CodingWorkerRequest,
} from '../src/coding-orchestrator.js';

function makeRequest(overrides: Partial<CodingWorkerRequest> = {}): CodingWorkerRequest {
  return {
    requestId: 'coder-1',
    mode: 'execute',
    route: 'coder_execute',
    originChatJid: 'telegram:main',
    originGroupFolder: 'main',
    taskText: 'Build the feature',
    workspaceMode: 'ephemeral_worktree',
    timeoutSeconds: 300,
    allowFanout: false,
    sessionContext: '[2026-03-22T00:00:00.000Z] User: Build the feature',
    assistantName: 'FarmFriend',
    sessionKey: 'main',
    group: {
      jid: 'telegram:main',
      name: 'Main',
      folder: 'main',
      trigger: '@FarmFriend',
    },
    ...overrides,
  };
}

test('execute mode fails closed when ephemeral worktree creation fails', async () => {
  const orchestrator = createCodingOrchestrator({
    activeRuns: new Map(),
    createEphemeralWorktree: async () => {
      throw new Error('not a git repo');
    },
    runContainerAgent: async () => {
      throw new Error('should not run worker');
    },
    publishEvent: () => {},
  });

  const result = await orchestrator.runTask(makeRequest());

  assert.equal(result.ok, false);
  assert.match(result.workerResult?.error || '', /not a git repo/);
});

test('plan mode uses read-only worker execution without a worktree', async () => {
  let toolMode: string | undefined;
  const orchestrator = createCodingOrchestrator({
    activeRuns: new Map(),
    createEphemeralWorktree: async () => {
      throw new Error('should not create worktree');
    },
    runContainerAgent: async (_group, input) => {
      toolMode = input.toolMode;
      return {
        status: 'success',
        result: 'Plan ready',
        usage: { totalTokens: 5 },
        toolExecutions: [],
      };
    },
    publishEvent: () => {},
  });

  const result = await orchestrator.runTask(
    makeRequest({ mode: 'plan', route: 'coder_plan' }),
  );

  assert.equal(result.ok, true);
  assert.equal(toolMode, 'read_only');
  assert.equal(result.workerResult?.status, 'success');
});

test('execute mode returns structured worker result with changed files', async () => {
  const orchestrator = createCodingOrchestrator({
    activeRuns: new Map(),
    createEphemeralWorktree: async () => ({
      worktreePath: '/tmp/coder-1',
      cleanup: async () => {},
      listChangedFiles: () => ['src/app.ts', 'tests/app.test.ts'],
      getDiffSummary: () => '2 files changed',
    }),
    runContainerAgent: async () => ({
      status: 'success',
      result: 'Implemented feature and ran npm test.',
      usage: { totalTokens: 12 },
      toolExecutions: [
        { index: 1, toolName: 'bash', status: 'ok', args: '{"command":"npm test"}' },
      ],
    }),
    publishEvent: () => {},
  });

  const result = await orchestrator.runTask(makeRequest());

  assert.equal(result.ok, true);
  assert.deepEqual(result.workerResult?.changedFiles, ['src/app.ts', 'tests/app.test.ts']);
  assert.deepEqual(result.workerResult?.testsRun, ['npm test']);
  assert.equal(result.workerResult?.diffSummary, '2 files changed');
});
