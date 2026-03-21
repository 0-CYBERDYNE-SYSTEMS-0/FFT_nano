import assert from 'node:assert/strict';
import test from 'node:test';

import type { TelegramMessagePreviewState } from '../src/telegram-streaming.js';
import { createMessageDispatcher, finalizeCompletedRun } from '../src/message-dispatch.js';

function createEmitter() {
  const events: Array<{ kind: 'chat' | 'agent'; payload: Record<string, unknown> }> = [];
  return {
    events,
    emitTuiChatEvent: (payload: Record<string, unknown>) => {
      events.push({ kind: 'chat', payload });
    },
    emitTuiAgentEvent: (payload: Record<string, unknown>) => {
      events.push({ kind: 'agent', payload });
    },
  };
}

test('finalizeCompletedRun finalizes Telegram preview in place and skips duplicate send', async () => {
  const emitter = createEmitter();
  const persisted: string[] = [];
  const sent: string[] = [];
  const finalized: number[] = [];

  const previewState: TelegramMessagePreviewState = {
    messageId: 123,
    lastText: 'preview',
    updatedAt: 1000,
  };

  await finalizeCompletedRun({
    chatJid: 'telegram:1',
    runId: 'run-1',
    sessionKey: 'telegram:1',
    result: 'done',
    streamed: true,
    usage: { totalTokens: 10 },
    abortSignal: new AbortController().signal,
    externallyCompleted: false,
    telegramPreviewState: previewState,
    timestampToPersist: '2026-03-21T12:00:00.000Z',
    updateChatUsage: () => {},
    persistLastAgentTimestamp: () => {},
    persistAssistantHistory: (_chatJid, text) => {
      persisted.push(text);
    },
    deleteTelegramPreviewMessage: async () => {
      throw new Error('should not delete');
    },
    finalizeTelegramPreviewMessage: async (_chatJid, messageId) => {
      finalized.push(messageId);
      return true;
    },
    sendAgentResultMessage: async (_chatJid, text) => {
      sent.push(text);
    },
    emitTuiChatEvent: emitter.emitTuiChatEvent,
    emitTuiAgentEvent: emitter.emitTuiAgentEvent,
  });

  assert.deepEqual(persisted, ['done']);
  assert.deepEqual(finalized, [123]);
  assert.deepEqual(sent, []);
  assert.equal(emitter.events.at(-1)?.kind, 'agent');
});

test('finalizeCompletedRun deletes preview on abort and emits aborted state', async () => {
  const emitter = createEmitter();
  const deleted: number[] = [];
  const controller = new AbortController();
  controller.abort();

  await finalizeCompletedRun({
    chatJid: 'telegram:2',
    runId: 'run-2',
    sessionKey: 'telegram:2',
    result: 'ignored',
    streamed: false,
    usage: undefined,
    abortSignal: controller.signal,
    externallyCompleted: false,
    telegramPreviewState: {
      messageId: 456,
      lastText: 'preview',
      updatedAt: 1000,
    },
    updateChatUsage: () => {},
    persistAssistantHistory: () => {
      throw new Error('should not persist');
    },
    deleteTelegramPreviewMessage: async (_chatJid, messageId) => {
      deleted.push(messageId);
    },
    finalizeTelegramPreviewMessage: async () => false,
    sendAgentResultMessage: async () => {
      throw new Error('should not send');
    },
    emitTuiChatEvent: emitter.emitTuiChatEvent,
    emitTuiAgentEvent: emitter.emitTuiAgentEvent,
  });

  assert.deepEqual(deleted, [456]);
  assert.deepEqual(
    emitter.events.map((event) => event.payload.state || event.payload.detail),
    ['aborted', 'aborted'],
  );
});

test('runDirectSessionTurn queues behind an active run', async () => {
  const activeChatRuns = new Map([
    [
      'telegram:1',
      {
        chatJid: 'telegram:1',
        startedAt: Date.now(),
        requestId: 'existing-run',
        abortController: new AbortController(),
      },
    ],
  ]);
  const tuiMessageQueue = new Map<string, Array<{ text: string; runId: string; deliver: boolean }>>();

  const dispatcher = createMessageDispatcher({
    state: {
      registeredGroups: {
        'telegram:1': { jid: 'telegram:1', name: 'Test', folder: 'test', trigger: '@FarmFriend' },
      },
      chatRunPreferences: {},
    },
    constants: {
      assistantName: 'FarmFriend',
      mainGroupFolder: 'main',
      triggerPattern: /@FarmFriend/i,
      tuiSenderName: 'TUI',
    },
    activeChatRuns,
    activeChatRunsById: new Map(),
    activeCoderRuns: new Map(),
    tuiMessageQueue,
    sendMessage: async () => {},
    setTyping: async () => {},
    getMessagesSince: () => [],
    getSessionKeyForChat: (chatJid) => chatJid,
    resolveMainOnboardingGate: () => ({ active: false }),
    buildOnboardingInterviewPrompt: ({ prompt }) => prompt,
    extractOnboardingCompletion: (text) => ({ text, completed: false }),
    completeMainWorkspaceOnboarding: () => {},
    rememberHeartbeatTarget: () => {},
    runAgent: async () => ({ ok: true, result: 'done', streamed: false }),
    consumeNextRunNoContinue: () => false,
    updateChatUsage: () => {},
    persistAssistantHistory: () => {},
    deleteTelegramPreviewMessage: async () => {},
    finalizeTelegramPreviewMessage: async () => false,
    sendAgentResultMessage: async () => {},
    emitTuiChatEvent: () => {},
    emitTuiAgentEvent: () => {},
    isTelegramJid: () => true,
    consumeTelegramHostCompletedRun: () => false,
    consumeTelegramHostStreamState: () => null,
    resolveTelegramStreamCompletionState: ({ externallyCompleted, previewState }) => ({
      effectiveStreamed: externallyCompleted,
      messagePreviewState: previewState,
    }),
    finalizeCompletedRun,
  });

  const result = await dispatcher.runDirectSessionTurn({
    chatJid: 'telegram:1',
    text: 'next',
    runId: 'queued-run',
    deliver: true,
  });

  assert.deepEqual(result, { runId: 'existing-run', status: 'queued' });
  assert.deepEqual(tuiMessageQueue.get('telegram:1'), [
    { text: 'next', runId: 'queued-run', deliver: true },
  ]);
});

test('runDirectSessionTurn does not double-count usage when finalizer updates stats', async () => {
  const usageCalls: Array<{ chatJid: string; usage?: { totalTokens?: number } }> = [];
  const finalized: string[] = [];

  const dispatcher = createMessageDispatcher({
    state: {
      registeredGroups: {
        'telegram:1': { jid: 'telegram:1', name: 'Test', folder: 'test', trigger: '@FarmFriend' },
      },
      chatRunPreferences: {},
    },
    constants: {
      assistantName: 'FarmFriend',
      mainGroupFolder: 'main',
      triggerPattern: /@FarmFriend/i,
      tuiSenderName: 'TUI',
    },
    activeChatRuns: new Map(),
    activeChatRunsById: new Map(),
    activeCoderRuns: new Map(),
    tuiMessageQueue: new Map(),
    sendMessage: async () => {},
    setTyping: async () => {},
    getMessagesSince: () => [],
    getSessionKeyForChat: (chatJid) => chatJid,
    resolveMainOnboardingGate: () => ({ active: false }),
    buildOnboardingInterviewPrompt: ({ prompt }) => prompt,
    extractOnboardingCompletion: (text) => ({ text, completed: false }),
    completeMainWorkspaceOnboarding: () => {},
    rememberHeartbeatTarget: () => {},
    runAgent: async () => ({
      ok: true,
      result: 'done',
      streamed: false,
      usage: { totalTokens: 7 },
    }),
    consumeNextRunNoContinue: () => false,
    updateChatUsage: (chatJid, usage) => {
      usageCalls.push({ chatJid, usage });
    },
    persistAssistantHistory: () => {},
    deleteTelegramPreviewMessage: async () => {},
    finalizeTelegramPreviewMessage: async () => false,
    sendAgentResultMessage: async () => {},
    emitTuiChatEvent: () => {},
    emitTuiAgentEvent: () => {},
    isTelegramJid: () => false,
    consumeTelegramHostCompletedRun: () => false,
    consumeTelegramHostStreamState: () => null,
    resolveTelegramStreamCompletionState: ({ externallyCompleted, previewState }) => ({
      effectiveStreamed: externallyCompleted,
      messagePreviewState: previewState,
    }),
    finalizeCompletedRun: async (params) => {
      params.updateChatUsage(params.chatJid, params.usage);
      finalized.push(params.chatJid);
    },
  });

  const start = await dispatcher.runDirectSessionTurn({
    chatJid: 'telegram:1',
    text: 'hello',
    runId: 'run-usage',
    deliver: true,
  });

  assert.deepEqual(start, { runId: 'run-usage', status: 'started' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(finalized, ['telegram:1']);
  assert.equal(usageCalls.length, 1);
  assert.deepEqual(usageCalls[0], {
    chatJid: 'telegram:1',
    usage: { totalTokens: 7 },
  });
});
