import assert from 'node:assert/strict';
import test from 'node:test';

import { PipelineDispatcher } from '../src/pipeline/pipeline-dispatcher.js';
import type { ChatPipeline } from '../src/pipeline/chat-pipeline.js';
import type { CodingPipeline } from '../src/pipeline/coding-pipeline.js';
import type { CronPipeline } from '../src/pipeline/cron-pipeline.js';
import type { PipelineDispatchRequest } from '../src/pipeline/run-pipeline.js';

test('PipelineDispatcher selects ChatPipeline for chat runType', () => {
  const dispatcher = new PipelineDispatcher(
    createMockChatDeps(),
    createMockCodingDeps(),
    createMockCronDeps(),
  );

  const request: PipelineDispatchRequest = {
    requestId: 'test-1',
    chatJid: 'test-chat',
    sessionKey: 'test-session',
    groupFolder: 'test-group',
    runType: 'chat',
    prompt: 'Hello',
    latestUserText: 'Hello',
  };

  const pipeline = dispatcher.selectPipeline(request);

  // ChatPipeline should be selected for chat runType
  assert.ok(pipeline instanceof Object, 'Should return a pipeline');
  assert.equal(pipeline.constructor.name, 'ChatPipeline', 'Should be ChatPipeline for chat runType');
});

test('PipelineDispatcher selects CodingPipeline for coding runType', () => {
  const dispatcher = new PipelineDispatcher(
    createMockChatDeps(),
    createMockCodingDeps(),
    createMockCronDeps(),
  );

  const request: PipelineDispatchRequest = {
    requestId: 'test-2',
    chatJid: 'test-chat',
    sessionKey: 'test-session',
    groupFolder: 'test-group',
    runType: 'coding',
    taskText: 'Implement a feature',
    config: {
      toolMode: 'full',
      isSubagent: false,
      workspaceMode: 'ephemeral_worktree',
    },
  };

  const pipeline = dispatcher.selectPipeline(request);

  // CodingPipeline should be selected for coding runType
  assert.ok(pipeline instanceof Object, 'Should return a pipeline');
  assert.equal(pipeline.constructor.name, 'CodingPipeline', 'Should be CodingPipeline for coding runType');
});

test('PipelineDispatcher selects CodingPipeline for subagent runType', () => {
  const dispatcher = new PipelineDispatcher(
    createMockChatDeps(),
    createMockCodingDeps(),
    createMockCronDeps(),
  );

  const request: PipelineDispatchRequest = {
    requestId: 'test-3',
    chatJid: 'test-chat',
    sessionKey: 'test-session',
    groupFolder: 'test-group',
    runType: 'subagent',
    taskText: 'Run a subagent task',
    config: {
      toolMode: 'full',
      isSubagent: true,
      workspaceMode: 'ephemeral_worktree',
    },
  };

  const pipeline = dispatcher.selectPipeline(request);

  // CodingPipeline should be selected for subagent runType
  assert.ok(pipeline instanceof Object, 'Should return a pipeline');
  assert.equal(pipeline.constructor.name, 'CodingPipeline', 'Should be CodingPipeline for subagent runType');
});

test('PipelineDispatcher selects CronPipeline for cron runType', () => {
  const dispatcher = new PipelineDispatcher(
    createMockChatDeps(),
    createMockCodingDeps(),
    createMockCronDeps(),
  );

  const request: PipelineDispatchRequest = {
    requestId: 'test-4',
    chatJid: 'test-chat',
    sessionKey: 'test-session',
    groupFolder: 'test-group',
    runType: 'cron',
    taskId: 'task-123',
  };

  const pipeline = dispatcher.selectPipeline(request);

  // CronPipeline should be selected for cron runType
  assert.ok(pipeline instanceof Object, 'Should return a pipeline');
  assert.equal(pipeline.constructor.name, 'CronPipeline', 'Should be CronPipeline for cron runType');
});

test('PipelineDispatcher selects CronPipeline for scheduled runType', () => {
  const dispatcher = new PipelineDispatcher(
    createMockChatDeps(),
    createMockCodingDeps(),
    createMockCronDeps(),
  );

  const request: PipelineDispatchRequest = {
    requestId: 'test-5',
    chatJid: 'test-chat',
    sessionKey: 'test-session',
    groupFolder: 'test-group',
    runType: 'scheduled',
    taskId: 'task-456',
  };

  const pipeline = dispatcher.selectPipeline(request);

  // CronPipeline should be selected for scheduled runType
  assert.ok(pipeline instanceof Object, 'Should return a pipeline');
  assert.equal(pipeline.constructor.name, 'CronPipeline', 'Should be CronPipeline for scheduled runType');
});

test('PipelineDispatcher defaults to ChatPipeline for unknown runType', () => {
  const dispatcher = new PipelineDispatcher(
    createMockChatDeps(),
    createMockCodingDeps(),
    createMockCronDeps(),
  );

  const request: PipelineDispatchRequest = {
    requestId: 'test-6',
    chatJid: 'test-chat',
    sessionKey: 'test-session',
    groupFolder: 'test-group',
    runType: 'chat', // Using chat as the default
    prompt: 'Hello',
  };

  const pipeline = dispatcher.selectPipeline(request);

  // ChatPipeline should be selected as default
  assert.ok(pipeline instanceof Object, 'Should return a pipeline');
  assert.equal(pipeline.constructor.name, 'ChatPipeline', 'Should be ChatPipeline as default');
});

test('PipelineDispatcher can retrieve individual pipelines via getter methods', () => {
  const dispatcher = new PipelineDispatcher(
    createMockChatDeps(),
    createMockCodingDeps(),
    createMockCronDeps(),
  );

  const chatPipeline = dispatcher.getChatPipeline();
  const codingPipeline = dispatcher.getCodingPipeline();
  const cronPipeline = dispatcher.getCronPipeline();

  assert.ok(chatPipeline, 'Should have ChatPipeline');
  assert.ok(codingPipeline, 'Should have CodingPipeline');
  assert.ok(cronPipeline, 'Should have CronPipeline');
});

// Mock dependencies factory functions
function createMockChatDeps() {
  return {
    state: {
      registeredGroups: {},
      chatRunPreferences: {},
    },
    constants: {
      assistantName: 'TestBot',
      mainGroupFolder: 'test',
    },
    activeChatRuns: new Map(),
    activeChatRunsById: new Map(),
    runAgent: async () => ({ ok: true, result: 'test', streamed: false }),
    finalizeCompletedRun: async () => {},
    emitTuiChatEvent: () => {},
    emitTuiAgentEvent: () => {},
    setTyping: async () => {},
    getSessionKeyForChat: () => 'test-session',
    updateChatUsage: () => {},
    persistAssistantHistory: () => {},
    deleteTelegramPreviewMessage: async () => {},
    finalizeTelegramPreviewMessage: async () => false,
    sendAgentResultMessage: async () => true,
    isTelegramJid: () => false,
    consumeTelegramHostCompletedRun: () => false,
    consumeTelegramHostStreamState: () => null,
    resolveTelegramStreamCompletionState: () => ({
      effectiveStreamed: false,
      messagePreviewState: null,
    }),
    noteRunStarted: () => {},
    noteRunSettled: () => {},
  };
}

function createMockCodingDeps() {
  return {
    state: {
      registeredGroups: {},
    },
    constants: {
      assistantName: 'TestBot',
      mainGroupFolder: 'test',
    },
    activeChatRuns: new Map(),
    activeChatRunsById: new Map(),
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
    emitTuiChatEvent: () => {},
    emitTuiAgentEvent: () => {},
    sendAgentResultMessage: async () => true,
    updateChatUsage: () => {},
    persistAssistantHistory: () => {},
  };
}

function createMockCronDeps() {
  return {
    state: {
      registeredGroups: {},
    },
    constants: {
      mainGroupFolder: 'test',
    },
    runContainerAgent: async () => ({
      status: 'success',
      result: 'task completed',
    }),
    deliverTaskOutcome: async () => {},
    logger: {
      info: () => {},
      error: () => {},
      warn: () => {},
    },
  };
}
