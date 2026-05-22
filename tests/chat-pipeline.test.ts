import assert from 'node:assert/strict';
import test from 'node:test';

import { ChatPipeline } from '../src/pipeline/chat-pipeline.js';
import type { ChatPipelineDeps } from '../src/pipeline/chat-pipeline.js';
import type { PipelineDispatchRequest } from '../src/pipeline/run-pipeline.js';

test('ChatPipeline.prepare registers active run and emits events', async () => {
  const deps = createMockChatDeps();
  const pipeline = new ChatPipeline(deps);

  const request: PipelineDispatchRequest = {
    requestId: 'test-1',
    chatJid: 'test-chat',
    sessionKey: 'test-session',
    groupFolder: 'test-group',
    runType: 'chat',
    prompt: 'Hello world',
    latestUserText: 'Hello world',
  };

  const prepared = await pipeline.prepare(request);

  // Verify active run is registered
  assert.ok(deps.activeChatRuns.has('test-chat'), 'Should register chatJid in activeChatRuns');
  assert.ok(deps.activeChatRunsById.has('test-1'), 'Should register requestId in activeChatRunsById');

  // Verify emitted events
  assert.equal(deps.emittedTuiChatEvents.length, 1, 'Should emit one TUI chat event');
  assert.equal(deps.emittedTuiChatEvents[0].state, 'message', 'Should emit message state');
  assert.equal(deps.emittedTuiChatEvents[0].message?.content, 'Hello world', 'Should emit user message');

  assert.equal(deps.emittedTuiAgentEvents.length, 1, 'Should emit one TUI agent event');
  assert.equal(deps.emittedTuiAgentEvents[0].phase, 'start', 'Should emit start phase');

  // Verify typing was set
  assert.ok(deps.typingSet, 'Should set typing to true');
  assert.equal(deps.typingChatJid, 'test-chat', 'Should set typing for correct chat');

  // Verify prepared run structure
  assert.equal(prepared.requestId, 'test-1', 'Should have correct requestId');
  assert.equal(prepared.chatJid, 'test-chat', 'Should have correct chatJid');
  assert.equal(prepared.sessionKey, 'test-session', 'Should have correct sessionKey');
  assert.ok(prepared.abortController, 'Should have abort controller');
});

test('ChatPipeline.runChatTurn executes runAgent and returns output', async () => {
  const deps = createMockChatDeps();
  // Override runAgent with full signature
  deps.runAgent = async (
    group: any,
    prompt: string,
    chatJid: string,
    codingHint: any,
    requestId: string,
    runtimePrefs: Record<string, unknown>,
    options: Record<string, unknown>,
    abortSignal: AbortSignal,
  ) => {
    deps.runAgentCalled = true;
    deps.runAgentGroup = group;
    deps.runAgentPrompt = prompt;
    deps.runAgentChatJid = chatJid;
    return {
      ok: true,
      result: 'Hello from agent',
      streamed: true,
      usage: { totalTokens: 100 },
    };
  };

  const pipeline = new ChatPipeline(deps);

  const request: PipelineDispatchRequest = {
    requestId: 'test-2',
    chatJid: 'test-chat',
    sessionKey: 'test-session',
    groupFolder: 'test-group',
    runType: 'chat',
    prompt: 'Hello',
    latestUserText: 'Hello',
    codingHint: 'none',
    runtimePrefs: { model: 'test-model' },
  };

  const output = await pipeline.runChatTurn(request);

  assert.equal(output.ok, true, 'Should have ok=true');
  assert.equal(output.result, 'Hello from agent', 'Should return agent result');
  assert.equal(output.streamed, true, 'Should return streamed=true');
  assert.deepEqual(output.usage, { totalTokens: 100 }, 'Should return usage');

  // Verify runAgent was called with correct args
  assert.ok(deps.runAgentCalled, 'runAgent should be called');
  assert.equal(deps.runAgentGroup, deps.state.registeredGroups['test-group'], 'Should pass correct group');
  assert.equal(deps.runAgentPrompt, 'Hello', 'Should pass correct prompt');
  assert.equal(deps.runAgentChatJid, 'test-chat', 'Should pass correct chatJid');
});

test('ChatPipeline.runChatTurn handles runAgent failure', async () => {
  const deps = createMockChatDeps();
  deps.runAgent = async () => ({
    ok: false,
    result: null,
    streamed: false,
    suppressUserDelivery: true,
  });

  const pipeline = new ChatPipeline(deps);

  const request: PipelineDispatchRequest = {
    requestId: 'test-3',
    chatJid: 'test-chat',
    sessionKey: 'test-session',
    groupFolder: 'test-group',
    runType: 'chat',
    prompt: 'Fail',
    latestUserText: 'Fail',
  };

  const output = await pipeline.runChatTurn(request);

  assert.equal(output.ok, false, 'Should have ok=false');
  assert.equal(output.result, null, 'Should have null result');
  assert.equal(output.suppressUserDelivery, true, 'Should preserve suppressUserDelivery');
});

test('ChatPipeline.runChatTurn cleans up active runs after execution', async () => {
  const deps = createMockChatDeps();
  // Override runAgent with full signature
  deps.runAgent = async (
    group: any,
    prompt: string,
    chatJid: string,
    codingHint: any,
    requestId: string,
    runtimePrefs: Record<string, unknown>,
    options: Record<string, unknown>,
    abortSignal: AbortSignal,
  ) => {
    deps.runAgentCalled = true;
    return { ok: true, result: 'test', streamed: false };
  };

  const pipeline = new ChatPipeline(deps);

  const request: PipelineDispatchRequest = {
    requestId: 'test-4',
    chatJid: 'test-chat',
    sessionKey: 'test-session',
    groupFolder: 'test-group',
    runType: 'chat',
    prompt: 'Test cleanup',
    latestUserText: 'Test cleanup',
  };

  await pipeline.runChatTurn(request);

  // Verify cleanup - typing is reset (set to false) after execution
  assert.equal(deps.typingSet, false, 'Should reset typing to false');
  assert.equal(deps.typingChatJid, 'test-chat', 'Should reset typing for correct chat');
  assert.ok(!deps.activeChatRuns.has('test-chat'), 'Should remove chatJid from activeChatRuns');
  assert.ok(!deps.activeChatRunsById.has('test-4'), 'Should remove requestId from activeChatRunsById');
});

// Mock dependencies factory
function createMockChatDeps(): ChatPipelineDeps & {
  emittedTuiChatEvents: any[];
  emittedTuiAgentEvents: any[];
  typingSet: boolean;
  typingChatJid: string | null;
  runAgentCalled: boolean;
  runAgentGroup: unknown;
  runAgentPrompt: string;
  runAgentChatJid: string;
} {
  const deps = {
    state: {
      registeredGroups: {
        'test-group': { name: 'Test Group', folder: 'test-group', trigger: '' },
      },
      chatRunPreferences: {},
      lastAgentTimestamp: {},
    },
    constants: {
      assistantName: 'TestBot',
      mainGroupFolder: 'test',
    },
    activeChatRuns: new Map<string, any>(),
    activeChatRunsById: new Map<string, any>(),
    runAgent: async () => ({ ok: true, result: 'test', streamed: false }),
    finalizeCompletedRun: async () => {},
    emitTuiChatEvent: function(payload: any) {
      deps.emittedTuiChatEvents.push(payload);
    },
    emitTuiAgentEvent: function(payload: any) {
      deps.emittedTuiAgentEvents.push(payload);
    },
    setTyping: async function(chatJid: string, typing: boolean) {
      deps.typingSet = typing;
      deps.typingChatJid = chatJid;
    },
    getSessionKeyForChat: () => 'test-session',
    updateChatUsage: () => {},
    persistAssistantHistory: () => {},
    deleteTelegramPreviewMessage: async () => {},
    finalizeTelegramPreviewMessage: async () => false,
    sendAgentResultMessage: async () => true,
    isTelegramJid: () => false,
    prepareTelegramCompletionState: async () => ({
      externallyCompleted: false,
      previewState: null,
    }),
    consumeTelegramHostCompletedRun: () => false,
    consumeTelegramHostStreamState: () => null,
    resolveTelegramStreamCompletionState: () => ({
      effectiveStreamed: false,
      messagePreviewState: null,
    }),
    noteRunStarted: () => {},
    noteRunSettled: () => {},
    emittedTuiChatEvents: [] as any[],
    emittedTuiAgentEvents: [] as any[],
    typingSet: false,
    typingChatJid: null as string | null,
    runAgentCalled: false,
    runAgentGroup: null as unknown,
    runAgentPrompt: '',
    runAgentChatJid: '',
  };

  // Override runAgent to track calls
  deps.runAgent = async (group, prompt, chatJid) => {
    deps.runAgentCalled = true;
    deps.runAgentGroup = group;
    deps.runAgentPrompt = prompt;
    deps.runAgentChatJid = chatJid;
    return { ok: true, result: 'test', streamed: false };
  };

  return deps as any;
}
