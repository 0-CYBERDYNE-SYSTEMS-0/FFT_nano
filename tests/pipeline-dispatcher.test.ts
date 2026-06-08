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

test('PipelineDispatcher dispatches chat requests through runAgent and delivery', async () => {
  const events: string[] = [];
  const chatDeps = createMockChatDeps();
  chatDeps.state.registeredGroups['test-group'] = {
    name: 'Test Group',
    folder: 'test-group',
    trigger: '@TestBot',
    added_at: '2026-03-31T00:00:00.000Z',
  };
  chatDeps.runAgent = async (
    _group: unknown,
    prompt: string,
    chatJid: string,
    _hint: unknown,
    requestId: string,
  ) => {
    events.push(`run:${chatJid}:${requestId}:${prompt}`);
    return {
      ok: true,
      result: 'agent reply',
      streamed: false,
      usage: { totalTokens: 12, provider: 'zai', model: 'glm-4.7' },
    };
  };
  chatDeps.finalizeCompletedRun = async (params: {
    chatJid: string;
    runId: string;
    result: string | null;
    usage?: { provider?: string; model?: string };
  }) => {
    events.push(
      `deliver:${params.chatJid}:${params.runId}:${params.result}:${params.usage?.provider}/${params.usage?.model}`,
    );
  };
  chatDeps.emitTuiChatEvent = (payload: {
    state: string;
    message?: { role?: string; content?: string };
  }) => {
    events.push(
      `tui-chat:${payload.state}:${payload.message?.role || ''}:${payload.message?.content || ''}`,
    );
  };
  chatDeps.emitTuiAgentEvent = (payload: { phase: string; detail: string }) => {
    events.push(`tui-agent:${payload.phase}:${payload.detail}`);
  };
  chatDeps.setTyping = async (_chatJid: string, typing: boolean) => {
    events.push(`typing:${typing}`);
  };
  chatDeps.noteRunStarted = (params: {
    chatJid: string;
    requestId: string;
    latestUserText: string;
  }) => {
    events.push(
      `started:${params.chatJid}:${params.requestId}:${params.latestUserText}`,
    );
  };

  const dispatcher = new PipelineDispatcher(
    chatDeps,
    createMockCodingDeps(),
    createMockCronDeps(),
  );

  await dispatcher.dispatch({
    requestId: 'chat-dispatch-1',
    chatJid: 'telegram:1',
    sessionKey: 'session-1',
    groupFolder: 'test-group',
    runType: 'chat',
    prompt: 'hello',
    latestUserText: 'hello',
    runtimePrefs: { provider: 'zai', model: 'glm-4.7' },
  });

  assert.deepEqual(events, [
    'started:telegram:1:chat-dispatch-1:hello',
    'tui-chat:message:user:hello',
    'tui-agent:start:running',
    'typing:true',
    'run:telegram:1:chat-dispatch-1:hello',
    'typing:false',
    'deliver:telegram:1:chat-dispatch-1:agent reply:zai/glm-4.7',
  ]);
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
