import assert from 'node:assert/strict';
import test from 'node:test';

import { CodingPipeline } from '../src/pipeline/coding-pipeline.js';
import type { CodingPipelineDeps } from '../src/pipeline/coding-pipeline.js';
import type { PipelineDispatchRequest } from '../src/pipeline/run-pipeline.js';

test('CodingPipeline.prepare registers active run and emits events', async () => {
  const deps = createMockCodingDeps();
  const pipeline = new CodingPipeline(deps);

  const request: PipelineDispatchRequest = {
    requestId: 'test-1',
    chatJid: 'test-chat',
    sessionKey: 'test-session',
    groupFolder: 'test-group',
    runType: 'coding',
    taskText: 'Implement feature X',
    config: {
      toolMode: 'full',
      isSubagent: false,
      workspaceMode: 'ephemeral_worktree',
    },
  };

  const prepared = await pipeline.prepare(request);

  // Verify active run is registered
  assert.ok(deps.activeChatRuns.has('test-chat'), 'Should register chatJid in activeChatRuns');
  assert.ok(deps.activeChatRunsById.has('test-1'), 'Should register requestId in activeChatRunsById');

  // Verify emitted events
  assert.equal(deps.emittedTuiChatEvents.length, 1, 'Should emit one TUI chat event');
  assert.equal(deps.emittedTuiChatEvents[0].state, 'message', 'Should emit message state');

  assert.equal(deps.emittedTuiAgentEvents.length, 1, 'Should emit one TUI agent event');
  assert.equal(deps.emittedTuiAgentEvents[0].phase, 'start', 'Should emit start phase');

  // Verify prepared run structure
  assert.equal(prepared.requestId, 'test-1', 'Should have correct requestId');
  assert.equal(prepared.chatJid, 'test-chat', 'Should have correct chatJid');
});

test('CodingPipeline.runCodingTask executes coding orchestrator and returns output', async () => {
  const deps = createMockCodingDeps();
  const pipeline = new CodingPipeline(deps);

  const mockOrchestrator = {
    runTask: async (request: any) => ({
      ok: true,
      result: 'Feature X implemented',
      streamed: false,
      workerResult: {
        status: 'success',
        summary: 'Done',
        finalMessage: 'Feature X implemented',
        changedFiles: ['file1.ts', 'file2.ts'],
        commandsRun: ['npm test'],
        testsRun: ['test1', 'test2'],
        artifacts: [],
        childRunIds: [],
        startedAt: '2026-01-01T00:00:00.000Z',
        finishedAt: '2026-01-01T00:01:00.000Z',
        worktreePath: '/test/workspace/worktree',
      },
    }),
  };

  const request: PipelineDispatchRequest = {
    requestId: 'test-2',
    chatJid: 'test-chat',
    sessionKey: 'test-session',
    groupFolder: 'test-group',
    runType: 'coding',
    taskText: 'Implement feature X',
    prompt: 'Context for feature X',
    config: {
      toolMode: 'full',
      isSubagent: false,
      workspaceMode: 'ephemeral_worktree',
    },
    allowFanout: true,
    workspaceRoot: '/test/workspace',
    runtimePrefs: { model: 'test-model' },
  };

  const output = await pipeline.runCodingTask(request, mockOrchestrator);

  assert.equal(output.ok, true, 'Should have ok=true');
  assert.equal(output.result, 'Feature X implemented', 'Should return worker result');
  assert.deepEqual(output.changedFiles, ['file1.ts', 'file2.ts'], 'Should return changed files');
  assert.deepEqual(output.commandsRun, ['npm test'], 'Should return commands run');
  assert.deepEqual(output.testsRun, ['test1', 'test2'], 'Should return tests run');
  assert.equal(output.worktreePath, '/test/workspace/worktree', 'Should return worktree path');
});

test('CodingPipeline.runCodingTask handles orchestrator failure', async () => {
  const deps = createMockCodingDeps();
  const pipeline = new CodingPipeline(deps);

  const mockOrchestrator = {
    runTask: async () => ({
      ok: false,
      result: null,
      streamed: false,
      workerResult: {
        status: 'error',
        summary: 'Failed',
        finalMessage: 'Implementation failed',
        changedFiles: [],
        commandsRun: [],
        testsRun: [],
        artifacts: [],
        childRunIds: [],
        startedAt: '2026-01-01T00:00:00.000Z',
        finishedAt: '2026-01-01T00:01:00.000Z',
        error: 'Implementation failed',
      },
    }),
  };

  const request: PipelineDispatchRequest = {
    requestId: 'test-3',
    chatJid: 'test-chat',
    sessionKey: 'test-session',
    groupFolder: 'test-group',
    runType: 'coding',
    taskText: 'Implement feature Y',
    config: {
      toolMode: 'full',
      isSubagent: false,
      workspaceMode: 'ephemeral_worktree',
    },
  };

  const output = await pipeline.runCodingTask(request, mockOrchestrator);

  assert.equal(output.ok, false, 'Should have ok=false');
  assert.equal(output.result, null, 'Should have null result');
});

test('CodingPipeline.runCodingTask cleans up active runs after execution', async () => {
  const deps = createMockCodingDeps();
  const pipeline = new CodingPipeline(deps);

  const mockOrchestrator = {
    runTask: async () => ({
      ok: true,
      result: 'Done',
      streamed: false,
      workerResult: {
        status: 'success',
        summary: 'Done',
        finalMessage: 'Done',
        changedFiles: [],
        commandsRun: [],
        testsRun: [],
        artifacts: [],
        childRunIds: [],
        startedAt: '',
        finishedAt: '',
      },
    }),
  };

  const request: PipelineDispatchRequest = {
    requestId: 'test-4',
    chatJid: 'test-chat',
    sessionKey: 'test-session',
    groupFolder: 'test-group',
    runType: 'coding',
    taskText: 'Test cleanup',
    config: {
      toolMode: 'full',
      isSubagent: false,
      workspaceMode: 'ephemeral_worktree',
    },
  };

  await pipeline.runCodingTask(request, mockOrchestrator);

  // Verify cleanup
  assert.ok(!deps.activeChatRuns.has('test-chat'), 'Should remove chatJid from activeChatRuns');
  assert.ok(!deps.activeChatRunsById.has('test-4'), 'Should remove requestId from activeChatRunsById');
});

test('CodingPipeline.deliver sends result message to chat', async () => {
  const deps = createMockCodingDeps();
  const pipeline = new CodingPipeline(deps);

  let sentMessage = '';
  let sentChatJid = '';
  deps.sendAgentResultMessage = async (chatJid, text) => {
    sentChatJid = chatJid;
    sentMessage = text;
    return true;
  };

  const output = {
    ok: true,
    result: 'Implementation complete',
    streamed: false,
  };

  const prepared = {
    requestId: 'test-5',
    chatJid: 'test-chat',
    sessionKey: 'test-session',
    groupFolder: 'test-group',
    abortController: new AbortController(),
    activeRunEntry: {
      chatJid: 'test-chat',
      startedAt: Date.now(),
      requestId: 'test-5',
      abortController: new AbortController(),
    },
  };

  await pipeline.deliver(output, prepared);

  assert.equal(sentChatJid, 'test-chat', 'Should send to correct chat');
  assert.equal(sentMessage, 'Implementation complete', 'Should send correct message');
});

// Mock dependencies factory
function createMockCodingDeps(): CodingPipelineDeps & {
  emittedTuiChatEvents: any[];
  emittedTuiAgentEvents: any[];
  sendAgentResultMessage: (chatJid: string, text: string) => Promise<boolean>;
} {
  return {
    state: {
      registeredGroups: {
        'test-group': { name: 'Test Group', folder: 'test-group', trigger: '' },
      },
    },
    constants: {
      assistantName: 'TestBot',
      mainGroupFolder: 'test',
    },
    activeChatRuns: new Map<string, any>(),
    activeChatRunsById: new Map<string, any>(),
    createCodingOrchestrator: () => ({
      runTask: async () => ({
        ok: true,
        result: 'coded',
        streamed: false,
        workerResult: {
          status: 'success',
          summary: 'Done',
          finalMessage: 'Done',
          changedFiles: [],
          commandsRun: [],
          testsRun: [],
          artifacts: [],
          childRunIds: [],
          startedAt: '',
          finishedAt: '',
        },
      }),
    }),
    emitTuiChatEvent: function(payload: any) {
      this.emittedTuiChatEvents.push(payload);
    },
    emitTuiAgentEvent: function(payload: any) {
      this.emittedTuiAgentEvents.push(payload);
    },
    sendAgentResultMessage: async (chatJid: string, text: string) => {
      return true;
    },
    updateChatUsage: () => {},
    persistAssistantHistory: () => {},
    emittedTuiChatEvents: [] as any[],
    emittedTuiAgentEvents: [] as any[],
  } as any;
}
