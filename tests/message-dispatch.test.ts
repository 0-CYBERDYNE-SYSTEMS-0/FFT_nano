import assert from 'node:assert/strict';
import test from 'node:test';

import type { TelegramMessagePreviewState } from '../src/telegram-streaming.js';
import { EMPTY_NON_HEARTBEAT_OUTPUT_MESSAGE } from '../src/agent-empty-output.js';
import {
  createMessageDispatcher,
  finalizeCompletedRun,
} from '../src/message-dispatch.js';

function createEmitter() {
  const events: Array<{
    kind: 'chat' | 'agent';
    payload: Record<string, unknown>;
  }> = [];
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

test('finalizeCompletedRun skips duplicate send when Telegram delivery already completed externally', async () => {
  const emitter = createEmitter();
  const sent: string[] = [];

  await finalizeCompletedRun({
    chatJid: 'telegram:1',
    runId: 'run-external',
    sessionKey: 'telegram:1',
    result: 'done',
    streamed: true,
    usage: { totalTokens: 10 },
    abortSignal: new AbortController().signal,
    externallyCompleted: true,
    telegramPreviewState: null,
    updateChatUsage: () => {},
    persistAssistantHistory: () => {},
    deleteTelegramPreviewMessage: async () => {},
    finalizeTelegramPreviewMessage: async () => false,
    sendAgentResultMessage: async (_chatJid, text) => {
      sent.push(text);
    },
    emitTuiChatEvent: emitter.emitTuiChatEvent,
    emitTuiAgentEvent: emitter.emitTuiAgentEvent,
  });

  assert.deepEqual(sent, []);
  assert.equal(emitter.events.at(-1)?.kind, 'agent');
});

test('finalizeCompletedRun sends diagnostic for empty final output', async () => {
  const emitter = createEmitter();
  const persisted: string[] = [];
  const sent: string[] = [];

  await finalizeCompletedRun({
    chatJid: 'telegram:1',
    runId: 'run-empty',
    sessionKey: 'telegram:1',
    result: '   ',
    streamed: false,
    usage: { totalTokens: 12, provider: 'zai', model: 'glm-4.7' },
    abortSignal: new AbortController().signal,
    externallyCompleted: false,
    telegramPreviewState: null,
    updateChatUsage: () => {},
    persistAssistantHistory: (_chatJid, text) => {
      persisted.push(text);
    },
    deleteTelegramPreviewMessage: async () => {},
    finalizeTelegramPreviewMessage: async () => false,
    sendAgentResultMessage: async (_chatJid, text) => {
      sent.push(text);
      return true;
    },
    emitTuiChatEvent: emitter.emitTuiChatEvent,
    emitTuiAgentEvent: emitter.emitTuiAgentEvent,
  });

  assert.equal(sent.length, 1);
  assert.equal(persisted.length, 1);
  assert.match(sent[0], /LLM produced no user-visible final response/);
  assert.match(sent[0], /run=run-empty/);
  assert.match(sent[0], /provider=zai/);
  assert.doesNotMatch(sent[0], /Task completed/);
  assert.equal(sent[0], persisted[0]);
});

test('finalizeCompletedRun suppresses withheld verification output without diagnostic', async () => {
  const emitter = createEmitter();
  const persisted: string[] = [];
  const sent: string[] = [];

  await finalizeCompletedRun({
    chatJid: 'telegram:1',
    runId: 'run-verification-failed',
    sessionKey: 'telegram:1',
    result: null,
    streamed: false,
    usage: { totalTokens: 12, provider: 'zai', model: 'glm-4.7' },
    abortSignal: new AbortController().signal,
    externallyCompleted: false,
    telegramPreviewState: null,
    suppressUserDelivery: true,
    updateChatUsage: () => {},
    persistAssistantHistory: (_chatJid, text) => {
      persisted.push(text);
    },
    deleteTelegramPreviewMessage: async () => {},
    finalizeTelegramPreviewMessage: async () => false,
    sendAgentResultMessage: async (_chatJid, text) => {
      sent.push(text);
      return true;
    },
    emitTuiChatEvent: emitter.emitTuiChatEvent,
    emitTuiAgentEvent: emitter.emitTuiAgentEvent,
  });

  assert.deepEqual(sent, []);
  assert.deepEqual(persisted, []);
  assert.equal(
    emitter.events.some((event) => event.kind === 'chat'),
    false,
  );
  assert.equal(emitter.events.at(-1)?.kind, 'agent');
});

test('finalizeCompletedRun does not trust external completion for empty final output', async () => {
  const emitter = createEmitter();
  const sent: string[] = [];

  await finalizeCompletedRun({
    chatJid: 'telegram:1',
    runId: 'run-empty-external',
    sessionKey: 'telegram:1',
    result: null,
    streamed: true,
    usage: undefined,
    abortSignal: new AbortController().signal,
    externallyCompleted: true,
    telegramPreviewState: null,
    updateChatUsage: () => {},
    persistAssistantHistory: () => {},
    deleteTelegramPreviewMessage: async () => {},
    finalizeTelegramPreviewMessage: async () => false,
    sendAgentResultMessage: async (_chatJid, text) => {
      sent.push(text);
      return true;
    },
    emitTuiChatEvent: emitter.emitTuiChatEvent,
    emitTuiAgentEvent: emitter.emitTuiAgentEvent,
  });

  assert.equal(sent.length, 1);
  assert.match(sent[0], /LLM produced no user-visible final response/);
  assert.match(sent[0], /external_delivery=yes/);
});

test('finalizeCompletedRun preserves streamed Telegram preview when final output is empty', async () => {
  const emitter = createEmitter();
  const persisted: string[] = [];
  const sent: string[] = [];
  const finalized: Array<{ messageId: number; text: string }> = [];

  await finalizeCompletedRun({
    chatJid: 'telegram:1',
    runId: 'run-empty-preview',
    sessionKey: 'telegram:1',
    result: '',
    streamed: true,
    usage: undefined,
    abortSignal: new AbortController().signal,
    externallyCompleted: false,
    telegramPreviewState: {
      messageId: 444,
      lastText: 'This streamed answer should remain in chat.',
      updatedAt: Date.now(),
    },
    updateChatUsage: () => {},
    persistAssistantHistory: (_chatJid, text) => {
      persisted.push(text);
      return '2026-05-11T00:00:00.000Z';
    },
    deleteTelegramPreviewMessage: async () => {
      throw new Error('should not delete streamed preview');
    },
    finalizeTelegramPreviewMessage: async (_chatJid, messageId, text) => {
      finalized.push({ messageId, text });
      return true;
    },
    sendAgentResultMessage: async (_chatJid, text) => {
      sent.push(text);
      return true;
    },
    emitTuiChatEvent: emitter.emitTuiChatEvent,
    emitTuiAgentEvent: emitter.emitTuiAgentEvent,
  });

  assert.deepEqual(persisted, ['This streamed answer should remain in chat.']);
  assert.deepEqual(finalized, [
    { messageId: 444, text: 'This streamed answer should remain in chat.' },
  ]);
  assert.deepEqual(sent, []);
  assert.equal(
    emitter.events.some((event) => event.kind === 'chat'),
    true,
  );
});

test('finalizeCompletedRun sends durable fallback after streamed empty retry output', async () => {
  const emitter = createEmitter();
  const persisted: string[] = [];
  const sent: string[] = [];

  await finalizeCompletedRun({
    chatJid: 'telegram:1',
    runId: 'run-empty-streamed-retry',
    sessionKey: 'telegram:1',
    result: EMPTY_NON_HEARTBEAT_OUTPUT_MESSAGE,
    streamed: false,
    usage: undefined,
    abortSignal: new AbortController().signal,
    externallyCompleted: false,
    telegramPreviewState: null,
    updateChatUsage: () => {},
    persistAssistantHistory: (_chatJid, text) => {
      persisted.push(text);
    },
    deleteTelegramPreviewMessage: async () => {},
    finalizeTelegramPreviewMessage: async () => false,
    sendAgentResultMessage: async (_chatJid, text) => {
      sent.push(text);
      return true;
    },
    emitTuiChatEvent: emitter.emitTuiChatEvent,
    emitTuiAgentEvent: emitter.emitTuiAgentEvent,
  });

  assert.deepEqual(sent, [EMPTY_NON_HEARTBEAT_OUTPUT_MESSAGE]);
  assert.deepEqual(persisted, [EMPTY_NON_HEARTBEAT_OUTPUT_MESSAGE]);
});

test('finalizeCompletedRun sanitizes evaluator verdict-shaped final output at delivery boundary', async () => {
  const emitter = createEmitter();
  const persisted: string[] = [];
  const sent: string[] = [];

  await finalizeCompletedRun({
    chatJid: 'telegram:1',
    runId: 'run-sanitize-final',
    sessionKey: 'telegram:1',
    result: '{"pass":false,"score":"1","issues":["missing artifact"],"feedback":"retry"}',
    streamed: false,
    usage: undefined,
    abortSignal: new AbortController().signal,
    externallyCompleted: false,
    telegramPreviewState: null,
    updateChatUsage: () => {},
    persistAssistantHistory: (_chatJid, text) => {
      persisted.push(text);
    },
    deleteTelegramPreviewMessage: async () => {},
    finalizeTelegramPreviewMessage: async () => false,
    sendAgentResultMessage: async (_chatJid, text) => {
      sent.push(text);
      return true;
    },
    emitTuiChatEvent: emitter.emitTuiChatEvent,
    emitTuiAgentEvent: emitter.emitTuiAgentEvent,
  });

  assert.deepEqual(sent, ['verification_failed']);
  assert.deepEqual(persisted, ['verification_failed']);
  const finalChat = emitter.events.find(
    (event) => event.kind === 'chat' && event.payload.state === 'final',
  );
  assert.equal(finalChat?.payload.message?.content, 'verification_failed');
});

test('finalizeCompletedRun deletes preview on abort and emits aborted state', async () => {
  const emitter = createEmitter();
  const deleted: number[] = [];
  const persistedTimestamps: Array<{ chatJid: string; timestamp: string }> = [];
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
    timestampToPersist: '2026-03-22T12:00:00.000Z',
    updateChatUsage: () => {},
    persistLastAgentTimestamp: (chatJid, timestamp) => {
      persistedTimestamps.push({ chatJid, timestamp });
    },
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
  assert.deepEqual(persistedTimestamps, [
    { chatJid: 'telegram:2', timestamp: '2026-03-22T12:00:00.000Z' },
  ]);
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
  const tuiMessageQueue = new Map<
    string,
    Array<{ text: string; runId: string; deliver: boolean }>
  >();

  const dispatcher = createMessageDispatcher({
    state: {
      registeredGroups: {
        'telegram:1': {
          jid: 'telegram:1',
          name: 'Test',
          folder: 'test',
          trigger: '@FarmFriend',
        },
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
    resolveTelegramStreamCompletionState: ({
      externallyCompleted,
      previewState,
    }) => ({
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
  const usageCalls: Array<{
    chatJid: string;
    usage?: { totalTokens?: number };
  }> = [];
  const finalized: string[] = [];

  const dispatcher = createMessageDispatcher({
    state: {
      registeredGroups: {
        'telegram:1': {
          jid: 'telegram:1',
          name: 'Test',
          folder: 'test',
          trigger: '@FarmFriend',
        },
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
    resolveTelegramStreamCompletionState: ({
      externallyCompleted,
      previewState,
    }) => ({
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

test('runDirectSessionTurn emits one user message and one start event', async () => {
  const emitter = createEmitter();

  const dispatcher = createMessageDispatcher({
    state: {
      registeredGroups: {
        'telegram:1': {
          jid: 'telegram:1',
          name: 'Test',
          folder: 'test',
          trigger: '@FarmFriend',
        },
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
      usage: undefined,
    }),
    consumeNextRunNoContinue: () => false,
    updateChatUsage: () => {},
    persistAssistantHistory: () => {},
    persistTuiUserHistory: () => {},
    deleteTelegramPreviewMessage: async () => {},
    finalizeTelegramPreviewMessage: async () => false,
    sendAgentResultMessage: async () => {},
    emitTuiChatEvent: emitter.emitTuiChatEvent,
    emitTuiAgentEvent: emitter.emitTuiAgentEvent,
    isTelegramJid: () => false,
    consumeTelegramHostCompletedRun: () => false,
    consumeTelegramHostStreamState: () => null,
    resolveTelegramStreamCompletionState: ({
      externallyCompleted,
      previewState,
    }) => ({
      effectiveStreamed: externallyCompleted,
      messagePreviewState: previewState,
    }),
    finalizeCompletedRun,
  });

  const start = await dispatcher.runDirectSessionTurn({
    chatJid: 'telegram:1',
    text: 'hello once',
    runId: 'run-once',
    deliver: false,
  });

  assert.deepEqual(start, { runId: 'run-once', status: 'started' });
  await new Promise((resolve) => setImmediate(resolve));

  const userMessages = emitter.events.filter(
    (event) =>
      event.kind === 'chat' &&
      event.payload.state === 'message' &&
      (event.payload.message as { role?: string } | undefined)?.role === 'user',
  );
  const startEvents = emitter.events.filter(
    (event) =>
      event.kind === 'agent' &&
      event.payload.phase === 'start' &&
      event.payload.detail === 'running',
  );

  assert.equal(userMessages.length, 1);
  assert.equal(startEvents.length, 1);
});

test('runDirectSessionTurn does not deliver a suppressed verification failure', async () => {
  const emitter = createEmitter();
  const sent: string[] = [];
  const persisted: string[] = [];

  const dispatcher = createMessageDispatcher({
    state: {
      registeredGroups: {
        'telegram:1': {
          jid: 'telegram:1',
          name: 'Main',
          folder: 'main',
          trigger: '@FarmFriend',
        },
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
      result: 'draft answer that failed verification',
      streamed: false,
      suppressUserDelivery: true,
      controlPlaneStatus: 'verification_failed',
    }),
    consumeNextRunNoContinue: () => false,
    updateChatUsage: () => {},
    persistAssistantHistory: (_chatJid, text) => {
      persisted.push(text);
    },
    persistTuiUserHistory: () => {},
    deleteTelegramPreviewMessage: async () => {},
    finalizeTelegramPreviewMessage: async () => false,
    sendAgentResultMessage: async (_chatJid, text) => {
      sent.push(text);
      return true;
    },
    emitTuiChatEvent: emitter.emitTuiChatEvent,
    emitTuiAgentEvent: emitter.emitTuiAgentEvent,
    isTelegramJid: () => true,
    consumeTelegramHostCompletedRun: () => false,
    consumeTelegramHostStreamState: () => null,
    resolveTelegramStreamCompletionState: ({
      externallyCompleted,
      previewState,
    }) => ({
      effectiveStreamed: externallyCompleted,
      messagePreviewState: previewState,
    }),
    finalizeCompletedRun,
  } as any);

  const start = await dispatcher.runDirectSessionTurn({
    chatJid: 'telegram:1',
    text: 'make the fixes',
    runId: 'run-suppressed',
    deliver: true,
  });

  assert.deepEqual(start, { runId: 'run-suppressed', status: 'started' });
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(sent, []);
  assert.deepEqual(persisted, []);
  assert.equal(
    emitter.events.some(
      (event) =>
        event.kind === 'chat' &&
        event.payload.state === 'final' &&
        (event.payload.message as { role?: string } | undefined)?.role ===
          'assistant',
    ),
    false,
  );
});

test('processMessage injects recent assistant context alongside new inbound messages', async () => {
  let capturedPrompt = '';

  const dispatcher = createMessageDispatcher({
    state: {
      registeredGroups: {
        'telegram:continuity': {
          jid: 'telegram:continuity',
          name: 'Continuity',
          folder: 'main',
          trigger: '@FarmFriend',
        },
      },
      chatRunPreferences: {},
      lastAgentTimestamp: {
        'telegram:continuity': '2026-03-29T18:04:52.000Z',
      },
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
    getMessagesSince: () => [
      {
        id: 'u-followup',
        chat_jid: 'telegram:continuity',
        sender: 'telegram:continuity',
        sender_name: 'TD',
        content:
          'do you not remember when you just told me about the news stories?',
        timestamp: '2026-03-29T18:05:12.000Z',
        is_from_me: 0,
      },
    ],
    getSessionKeyForChat: () => 'main',
    resolveMainOnboardingGate: () => ({ active: false }),
    buildOnboardingInterviewPrompt: ({ prompt }) => prompt,
    extractOnboardingCompletion: (text) => ({ text, completed: false }),
    completeMainWorkspaceOnboarding: () => {},
    rememberHeartbeatTarget: () => {},
    runAgent: async (_group, prompt) => {
      capturedPrompt = prompt;
      return { ok: true, result: 'done', streamed: false };
    },
    consumeNextRunNoContinue: () => false,
    updateChatUsage: () => {},
    persistAssistantHistory: () => {},
    deleteTelegramPreviewMessage: async () => {},
    finalizeTelegramPreviewMessage: async () => false,
    sendAgentResultMessage: async () => {},
    emitTuiChatEvent: () => {},
    emitTuiAgentEvent: () => {},
    isTelegramJid: () => false,
    consumeTelegramHostCompletedRun: () => false,
    consumeTelegramHostStreamState: () => null,
    resolveTelegramStreamCompletionState: ({
      externallyCompleted,
      previewState,
    }) => ({
      effectiveStreamed: externallyCompleted,
      messagePreviewState: previewState,
    }),
    finalizeCompletedRun,
    getRecentConversation: () => [
      {
        id: 'u-news',
        chat_jid: 'telegram:continuity',
        sender: 'telegram:continuity',
        sender_name: 'TD',
        content: 'search web and get news',
        timestamp: '2026-03-29T18:03:18.000Z',
        is_from_me: 0,
      },
      {
        id: 'a-news',
        chat_jid: 'telegram:continuity',
        sender: 'FarmFriend',
        sender_name: 'FarmFriend',
        content: 'FarmFriend: Here are the agtech and AI agent headlines.',
        timestamp: '2026-03-29T18:03:48.000Z',
        is_from_me: 1,
      },
      {
        id: 'u-followup',
        chat_jid: 'telegram:continuity',
        sender: 'telegram:continuity',
        sender_name: 'TD',
        content:
          'do you not remember when you just told me about the news stories?',
        timestamp: '2026-03-29T18:05:12.000Z',
        is_from_me: 0,
      },
    ],
  } as any);

  await dispatcher.processMessage({
    id: 'u-followup',
    chat_jid: 'telegram:continuity',
    sender: 'telegram:continuity',
    sender_name: 'TD',
    content:
      'do you not remember when you just told me about the news stories?',
    timestamp: '2026-03-29T18:05:12.000Z',
    is_from_me: 0,
  });

  assert.match(capturedPrompt, /\[RECENT CONVERSATION\]/);
  assert.match(capturedPrompt, /\[NEW INBOUND MESSAGES\]/);
  assert.match(
    capturedPrompt,
    /FarmFriend: Here are the agtech and AI agent headlines\./,
  );
  assert.match(
    capturedPrompt,
    /do you not remember when you just told me about the news stories\?/,
  );
});

test('processMessage excludes hidden TUI rows from recent conversation', async () => {
  let capturedPrompt = '';

  const dispatcher = createMessageDispatcher({
    state: {
      registeredGroups: {
        'telegram:hidden-tui': {
          jid: 'telegram:hidden-tui',
          name: 'Hidden TUI',
          folder: 'main',
          trigger: '@FarmFriend',
        },
      },
      chatRunPreferences: {},
      lastAgentTimestamp: {
        'telegram:hidden-tui': '2026-03-29T18:04:52.000Z',
      },
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
    getMessagesSince: () => [
      {
        id: 'u-followup',
        chat_jid: 'telegram:hidden-tui',
        sender: 'telegram:hidden-tui',
        sender_name: 'TD',
        content: 'what did you already tell me?',
        timestamp: '2026-03-29T18:05:12.000Z',
        is_from_me: 0,
      },
    ],
    getSessionKeyForChat: () => 'main',
    resolveMainOnboardingGate: () => ({ active: false }),
    buildOnboardingInterviewPrompt: ({ prompt }) => prompt,
    extractOnboardingCompletion: (text) => ({ text, completed: false }),
    completeMainWorkspaceOnboarding: () => {},
    rememberHeartbeatTarget: () => {},
    runAgent: async (_group, prompt) => {
      capturedPrompt = prompt;
      return { ok: true, result: 'done', streamed: false };
    },
    consumeNextRunNoContinue: () => false,
    updateChatUsage: () => {},
    persistAssistantHistory: () => {},
    deleteTelegramPreviewMessage: async () => {},
    finalizeTelegramPreviewMessage: async () => false,
    sendAgentResultMessage: async () => {},
    emitTuiChatEvent: () => {},
    emitTuiAgentEvent: () => {},
    isTelegramJid: () => false,
    consumeTelegramHostCompletedRun: () => false,
    consumeTelegramHostStreamState: () => null,
    resolveTelegramStreamCompletionState: ({
      externallyCompleted,
      previewState,
    }) => ({
      effectiveStreamed: externallyCompleted,
      messagePreviewState: previewState,
    }),
    finalizeCompletedRun,
    getRecentConversation: () => [
      {
        id: 'tui-hidden',
        chat_jid: 'telegram:hidden-tui',
        sender: '__fft_tui__',
        sender_name: 'TUI',
        content: 'internal operator note',
        timestamp: '2026-03-29T18:04:53.000Z',
        is_from_me: 0,
      },
      {
        id: 'a-public',
        chat_jid: 'telegram:hidden-tui',
        sender: 'FarmFriend',
        sender_name: 'FarmFriend',
        content: 'FarmFriend: public answer already shown to chat',
        timestamp: '2026-03-29T18:04:54.000Z',
        is_from_me: 1,
      },
      {
        id: 'u-followup',
        chat_jid: 'telegram:hidden-tui',
        sender: 'telegram:hidden-tui',
        sender_name: 'TD',
        content: 'what did you already tell me?',
        timestamp: '2026-03-29T18:05:12.000Z',
        is_from_me: 0,
      },
    ],
  } as any);

  await dispatcher.processMessage({
    id: 'u-followup',
    chat_jid: 'telegram:hidden-tui',
    sender: 'telegram:hidden-tui',
    sender_name: 'TD',
    content: 'what did you already tell me?',
    timestamp: '2026-03-29T18:05:12.000Z',
    is_from_me: 0,
  });

  assert.match(capturedPrompt, /public answer already shown to chat/);
  assert.doesNotMatch(capturedPrompt, /internal operator note/);
});

test('processMessage excludes legacy internal evaluator rows from recent conversation', async () => {
  let capturedPrompt = '';

  const dispatcher = createMessageDispatcher({
    state: {
      registeredGroups: {
        'telegram:internal-history': {
          jid: 'telegram:internal-history',
          name: 'Internal History',
          folder: 'main',
          trigger: '@FarmFriend',
        },
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
    getMessagesSince: () => [
      {
        id: 'u-followup',
        chat_jid: 'telegram:internal-history',
        sender: 'telegram:internal-history',
        sender_name: 'TD',
        content: 'continue',
        timestamp: '2026-03-29T18:05:12.000Z',
        is_from_me: 0,
      },
    ],
    getSessionKeyForChat: () => 'main',
    resolveMainOnboardingGate: () => ({ active: false }),
    buildOnboardingInterviewPrompt: ({ prompt }) => prompt,
    extractOnboardingCompletion: (text) => ({ text, completed: false }),
    completeMainWorkspaceOnboarding: () => {},
    rememberHeartbeatTarget: () => {},
    runAgent: async (_group, prompt) => {
      capturedPrompt = prompt;
      return { ok: true, result: 'done', streamed: false };
    },
    consumeNextRunNoContinue: () => false,
    updateChatUsage: () => {},
    persistAssistantHistory: () => {},
    deleteTelegramPreviewMessage: async () => {},
    finalizeTelegramPreviewMessage: async () => false,
    sendAgentResultMessage: async () => {},
    emitTuiChatEvent: () => {},
    emitTuiAgentEvent: () => {},
    isTelegramJid: () => false,
    consumeTelegramHostCompletedRun: () => false,
    consumeTelegramHostStreamState: () => null,
    resolveTelegramStreamCompletionState: ({
      externallyCompleted,
      previewState,
    }) => ({
      effectiveStreamed: externallyCompleted,
      messagePreviewState: previewState,
    }),
    finalizeCompletedRun,
    getRecentConversation: () => [
      {
        id: 'a-good',
        chat_jid: 'telegram:internal-history',
        sender: 'FarmFriend',
        sender_name: 'FarmFriend',
        content: 'FarmFriend: public answer already shown',
        timestamp: '2026-03-29T18:04:50.000Z',
        is_from_me: 1,
      },
      {
        id: 'a-evaluator',
        chat_jid: 'telegram:internal-history',
        sender: 'FarmFriend',
        sender_name: 'FarmFriend',
        content:
          'FarmFriend: Quality check flagged potential issues (score 4/10): internal issue',
        timestamp: '2026-03-29T18:04:54.000Z',
        is_from_me: 1,
      },
      {
        id: 'a-validator-escalation',
        chat_jid: 'telegram:internal-history',
        sender: 'FarmFriend',
        sender_name: 'FarmFriend',
        content:
          'FarmFriend: I could not verify that this task is complete, so I am stopping before presenting it as done.\nThe remaining fix appears to require operator approval for a potentially destructive or sensitive action.\nApprove the exact cleanup/repair action before I continue.',
        timestamp: '2026-03-29T18:04:55.000Z',
        is_from_me: 1,
      },
      {
        id: 'u-followup',
        chat_jid: 'telegram:internal-history',
        sender: 'telegram:internal-history',
        sender_name: 'TD',
        content: 'continue',
        timestamp: '2026-03-29T18:05:12.000Z',
        is_from_me: 0,
      },
    ],
  } as any);

  await dispatcher.processMessage({
    id: 'u-followup',
    chat_jid: 'telegram:internal-history',
    sender: 'telegram:internal-history',
    sender_name: 'TD',
    content: 'continue',
    timestamp: '2026-03-29T18:05:12.000Z',
    is_from_me: 0,
  });

  assert.match(capturedPrompt, /public answer already shown/);
  assert.doesNotMatch(capturedPrompt, /Quality check flagged/);
  assert.doesNotMatch(capturedPrompt, /score 4\/10/);
  assert.doesNotMatch(capturedPrompt, /I could not verify/);
  assert.doesNotMatch(capturedPrompt, /Approve the exact cleanup\/repair action/);
});

test('processMessage keeps interrupt queue semantics only for new inbound messages', async () => {
  let capturedPrompt = '';

  const dispatcher = createMessageDispatcher({
    state: {
      registeredGroups: {
        'telegram:interrupt': {
          jid: 'telegram:interrupt',
          name: 'Interrupt',
          folder: 'main',
          trigger: '@FarmFriend',
        },
      },
      chatRunPreferences: {
        'telegram:interrupt': {
          queueMode: 'interrupt',
        },
      },
      lastAgentTimestamp: {
        'telegram:interrupt': '2026-03-29T18:04:52.000Z',
      },
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
    getMessagesSince: () => [
      {
        id: 'u-burst-1',
        chat_jid: 'telegram:interrupt',
        sender: 'telegram:interrupt',
        sender_name: 'TD',
        content: 'first burst',
        timestamp: '2026-03-29T18:05:10.000Z',
        is_from_me: 0,
      },
      {
        id: 'u-burst-2',
        chat_jid: 'telegram:interrupt',
        sender: 'telegram:interrupt',
        sender_name: 'TD',
        content: 'second burst',
        timestamp: '2026-03-29T18:05:11.000Z',
        is_from_me: 0,
      },
      {
        id: 'u-burst-3',
        chat_jid: 'telegram:interrupt',
        sender: 'telegram:interrupt',
        sender_name: 'TD',
        content: 'latest burst',
        timestamp: '2026-03-29T18:05:12.000Z',
        is_from_me: 0,
      },
    ],
    getSessionKeyForChat: () => 'main',
    resolveMainOnboardingGate: () => ({ active: false }),
    buildOnboardingInterviewPrompt: ({ prompt }) => prompt,
    extractOnboardingCompletion: (text) => ({ text, completed: false }),
    completeMainWorkspaceOnboarding: () => {},
    rememberHeartbeatTarget: () => {},
    runAgent: async (_group, prompt) => {
      capturedPrompt = prompt;
      return { ok: true, result: 'done', streamed: false };
    },
    consumeNextRunNoContinue: () => false,
    updateChatUsage: () => {},
    persistAssistantHistory: () => {},
    deleteTelegramPreviewMessage: async () => {},
    finalizeTelegramPreviewMessage: async () => false,
    sendAgentResultMessage: async () => {},
    emitTuiChatEvent: () => {},
    emitTuiAgentEvent: () => {},
    isTelegramJid: () => false,
    consumeTelegramHostCompletedRun: () => false,
    consumeTelegramHostStreamState: () => null,
    resolveTelegramStreamCompletionState: ({
      externallyCompleted,
      previewState,
    }) => ({
      effectiveStreamed: externallyCompleted,
      messagePreviewState: previewState,
    }),
    finalizeCompletedRun,
    getRecentConversation: () => [
      {
        id: 'a-context',
        chat_jid: 'telegram:interrupt',
        sender: 'FarmFriend',
        sender_name: 'FarmFriend',
        content: 'FarmFriend: Earlier assistant context.',
        timestamp: '2026-03-29T18:05:09.000Z',
        is_from_me: 1,
      },
      {
        id: 'u-burst-3',
        chat_jid: 'telegram:interrupt',
        sender: 'telegram:interrupt',
        sender_name: 'TD',
        content: 'latest burst',
        timestamp: '2026-03-29T18:05:12.000Z',
        is_from_me: 0,
      },
    ],
  } as any);

  await dispatcher.processMessage({
    id: 'u-burst-3',
    chat_jid: 'telegram:interrupt',
    sender: 'telegram:interrupt',
    sender_name: 'TD',
    content: 'latest burst',
    timestamp: '2026-03-29T18:05:12.000Z',
    is_from_me: 0,
  });

  assert.match(capturedPrompt, /Earlier assistant context/);
  assert.match(capturedPrompt, /latest burst/);
  assert.doesNotMatch(capturedPrompt, /first burst/);
  assert.doesNotMatch(capturedPrompt, /second burst/);
  assert.match(
    capturedPrompt,
    /Prioritize the latest user intent, but do not drop unresolved work/,
  );
});

test('processMessage drains queued user messages after the active run settles', async () => {
  let runCount = 0;
  const capturedPrompts: string[] = [];
  let releaseFirstRun: (() => void) | null = null;
  let markFirstRunStarted: (() => void) | null = null;
  const firstRunStarted = new Promise<void>((resolve) => {
    markFirstRunStarted = resolve;
  });
  const firstRunGate = new Promise<void>((resolve) => {
    releaseFirstRun = resolve;
  });

  const dispatcher = createMessageDispatcher({
    state: {
      registeredGroups: {
        'telegram:drain': {
          jid: 'telegram:drain',
          name: 'Drain',
          folder: 'main',
          trigger: '@FarmFriend',
        },
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
    getSessionKeyForChat: () => 'main',
    resolveMainOnboardingGate: () => ({ active: false }),
    buildOnboardingInterviewPrompt: ({ prompt }) => prompt,
    extractOnboardingCompletion: (text) => ({ text, completed: false }),
    completeMainWorkspaceOnboarding: () => {},
    rememberHeartbeatTarget: () => {},
    runAgent: async (_group, prompt) => {
      runCount += 1;
      capturedPrompts.push(prompt);
      if (runCount === 1) {
        markFirstRunStarted?.();
        await firstRunGate;
      }
      return { ok: true, result: `done-${runCount}`, streamed: false };
    },
    consumeNextRunNoContinue: () => false,
    updateChatUsage: () => {},
    persistAssistantHistory: () => {},
    deleteTelegramPreviewMessage: async () => {},
    finalizeTelegramPreviewMessage: async () => false,
    sendAgentResultMessage: async () => {},
    emitTuiChatEvent: () => {},
    emitTuiAgentEvent: () => {},
    isTelegramJid: () => false,
    consumeTelegramHostCompletedRun: () => false,
    consumeTelegramHostStreamState: () => null,
    resolveTelegramStreamCompletionState: ({
      externallyCompleted,
      previewState,
    }) => ({
      effectiveStreamed: externallyCompleted,
      messagePreviewState: previewState,
    }),
    finalizeCompletedRun,
  } as any);

  const firstDispatch = dispatcher.processMessage({
    id: 'u-first',
    chat_jid: 'telegram:drain',
    sender: 'telegram:drain',
    sender_name: 'TD',
    content: 'first question',
    timestamp: '2026-03-29T18:05:12.000Z',
    is_from_me: 0,
  });
  await firstRunStarted;
  await dispatcher.processMessage({
    id: 'u-second',
    chat_jid: 'telegram:drain',
    sender: 'telegram:drain',
    sender_name: 'TD',
    content: 'second question',
    timestamp: '2026-03-29T18:05:13.000Z',
    is_from_me: 0,
  });

  assert.equal(runCount, 1);
  releaseFirstRun?.();
  await firstDispatch;

  const waitUntil = async (predicate: () => boolean) => {
    const timeoutAt = Date.now() + 1500;
    while (Date.now() < timeoutAt) {
      if (predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.fail('Timed out waiting for queued message drain');
  };
  await waitUntil(() => runCount === 2);
  assert.match(capturedPrompts[1] || '', /second question/);
});

test('processMessage drains queued inbound only after watermark finalization', async () => {
  const chatJid = 'telegram:watermark';
  const ts0 = '2026-03-29T18:05:10.000Z';
  const ts1 = '2026-03-29T18:05:12.000Z';
  let secondArrived = false;
  let runCount = 0;
  const capturedPrompts: string[] = [];
  let releaseFirstRun: (() => void) | null = null;
  let markFirstRunStarted: (() => void) | null = null;
  const firstRunStarted = new Promise<void>((resolve) => {
    markFirstRunStarted = resolve;
  });
  const firstRunGate = new Promise<void>((resolve) => {
    releaseFirstRun = resolve;
  });
  const msg1 = {
    id: 'u-watermark-1',
    chat_jid: chatJid,
    sender: chatJid,
    sender_name: 'TD',
    content: 'first message',
    timestamp: '2026-03-29T18:05:11.000Z',
    is_from_me: 0,
  };
  const msg2 = {
    id: 'u-watermark-2',
    chat_jid: chatJid,
    sender: chatJid,
    sender_name: 'TD',
    content: 'second message',
    timestamp: '2026-03-29T18:05:12.000Z',
    is_from_me: 0,
  };

  const dispatcher = createMessageDispatcher({
    state: {
      registeredGroups: {
        [chatJid]: {
          jid: chatJid,
          name: 'Watermark',
          folder: 'main',
          trigger: '@FarmFriend',
        },
      },
      chatRunPreferences: {},
      lastAgentTimestamp: {
        [chatJid]: ts0,
      },
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
    getMessagesSince: (_jid, sinceTimestamp) => {
      if (sinceTimestamp === ts1) return [msg2];
      if (sinceTimestamp === ts0) return secondArrived ? [msg1, msg2] : [msg1];
      return [];
    },
    getSessionKeyForChat: () => 'main',
    resolveMainOnboardingGate: () => ({ active: false }),
    buildOnboardingInterviewPrompt: ({ prompt }) => prompt,
    extractOnboardingCompletion: (text) => ({ text, completed: false }),
    completeMainWorkspaceOnboarding: () => {},
    rememberHeartbeatTarget: () => {},
    runAgent: async (_group, prompt) => {
      runCount += 1;
      capturedPrompts.push(prompt);
      if (runCount === 1) {
        markFirstRunStarted?.();
        await firstRunGate;
      }
      return { ok: true, result: `done-${runCount}`, streamed: false };
    },
    consumeNextRunNoContinue: () => false,
    updateChatUsage: () => {},
    persistAssistantHistory: () => {},
    deleteTelegramPreviewMessage: async () => {},
    finalizeTelegramPreviewMessage: async () => false,
    sendAgentResultMessage: async () => {},
    emitTuiChatEvent: () => {},
    emitTuiAgentEvent: () => {},
    isTelegramJid: () => false,
    consumeTelegramHostCompletedRun: () => false,
    consumeTelegramHostStreamState: () => null,
    resolveTelegramStreamCompletionState: ({
      externallyCompleted,
      previewState,
    }) => ({
      effectiveStreamed: externallyCompleted,
      messagePreviewState: previewState,
    }),
    finalizeCompletedRun: async (params) => {
      params.persistLastAgentTimestamp?.(params.chatJid, ts1);
    },
  } as any);

  const firstDispatch = dispatcher.processMessage(msg1 as any);
  await firstRunStarted;
  secondArrived = true;
  await dispatcher.processMessage(msg2 as any);
  releaseFirstRun?.();
  await firstDispatch;

  const waitUntil = async (predicate: () => boolean) => {
    const timeoutAt = Date.now() + 1500;
    while (Date.now() < timeoutAt) {
      if (predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.fail('Timed out waiting for watermark drain');
  };
  await waitUntil(() => runCount === 2);

  assert.match(capturedPrompts[1] || '', /second message/);
  assert.doesNotMatch(capturedPrompts[1] || '', /first message/);
});

test('processMessage drains inbound backlog once without duplicate reruns', async () => {
  let runCount = 0;
  const capturedPrompts: string[] = [];
  let getMessagesSinceCalls = 0;
  let releaseFirstRun: (() => void) | null = null;
  let markFirstRunStarted: (() => void) | null = null;
  const firstRunStarted = new Promise<void>((resolve) => {
    markFirstRunStarted = resolve;
  });
  const firstRunGate = new Promise<void>((resolve) => {
    releaseFirstRun = resolve;
  });

  const backlogMessages = [
    {
      id: 'u-backlog-1',
      chat_jid: 'telegram:dedupe',
      sender: 'telegram:dedupe',
      sender_name: 'TD',
      content: 'second question while busy',
      timestamp: '2026-03-29T18:05:13.000Z',
      is_from_me: 0,
    },
    {
      id: 'u-backlog-2',
      chat_jid: 'telegram:dedupe',
      sender: 'telegram:dedupe',
      sender_name: 'TD',
      content: 'third question while busy',
      timestamp: '2026-03-29T18:05:14.000Z',
      is_from_me: 0,
    },
  ];

  const dispatcher = createMessageDispatcher({
    state: {
      registeredGroups: {
        'telegram:dedupe': {
          jid: 'telegram:dedupe',
          name: 'Dedupe',
          folder: 'main',
          trigger: '@FarmFriend',
        },
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
    getMessagesSince: () => {
      getMessagesSinceCalls += 1;
      return getMessagesSinceCalls === 1 ? [] : backlogMessages;
    },
    getSessionKeyForChat: () => 'main',
    resolveMainOnboardingGate: () => ({ active: false }),
    buildOnboardingInterviewPrompt: ({ prompt }) => prompt,
    extractOnboardingCompletion: (text) => ({ text, completed: false }),
    completeMainWorkspaceOnboarding: () => {},
    rememberHeartbeatTarget: () => {},
    runAgent: async (_group, prompt) => {
      runCount += 1;
      capturedPrompts.push(prompt);
      if (runCount === 1) {
        markFirstRunStarted?.();
        await firstRunGate;
      }
      return { ok: true, result: `done-${runCount}`, streamed: false };
    },
    consumeNextRunNoContinue: () => false,
    updateChatUsage: () => {},
    persistAssistantHistory: () => {},
    deleteTelegramPreviewMessage: async () => {},
    finalizeTelegramPreviewMessage: async () => false,
    sendAgentResultMessage: async () => {},
    emitTuiChatEvent: () => {},
    emitTuiAgentEvent: () => {},
    isTelegramJid: () => false,
    consumeTelegramHostCompletedRun: () => false,
    consumeTelegramHostStreamState: () => null,
    resolveTelegramStreamCompletionState: ({
      externallyCompleted,
      previewState,
    }) => ({
      effectiveStreamed: externallyCompleted,
      messagePreviewState: previewState,
    }),
    finalizeCompletedRun,
  } as any);

  const firstDispatch = dispatcher.processMessage({
    id: 'u-initial',
    chat_jid: 'telegram:dedupe',
    sender: 'telegram:dedupe',
    sender_name: 'TD',
    content: 'first question',
    timestamp: '2026-03-29T18:05:12.000Z',
    is_from_me: 0,
  });
  await firstRunStarted;
  await dispatcher.processMessage(backlogMessages[0] as any);
  await dispatcher.processMessage(backlogMessages[1] as any);

  releaseFirstRun?.();
  await firstDispatch;

  const waitUntil = async (predicate: () => boolean) => {
    const timeoutAt = Date.now() + 1500;
    while (Date.now() < timeoutAt) {
      if (predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.fail('Timed out waiting for backlog drain');
  };
  await waitUntil(() => runCount >= 2);
  await new Promise((resolve) => setTimeout(resolve, 60));

  assert.equal(runCount, 2);
  assert.match(capturedPrompts[1] || '', /second question while busy/);
  assert.match(capturedPrompts[1] || '', /third question while busy/);
});

test('drain continues to queued TUI when queued inbound is ignored', async () => {
  const chatJid = 'telegram:non-main';
  let runCount = 0;
  const capturedPrompts: string[] = [];
  let releaseFirstRun: (() => void) | null = null;
  let markFirstRunStarted: (() => void) | null = null;
  const firstRunStarted = new Promise<void>((resolve) => {
    markFirstRunStarted = resolve;
  });
  const firstRunGate = new Promise<void>((resolve) => {
    releaseFirstRun = resolve;
  });

  const dispatcher = createMessageDispatcher({
    state: {
      registeredGroups: {
        [chatJid]: {
          jid: chatJid,
          name: 'Non Main',
          folder: 'group-a',
          trigger: '@FarmFriend',
        },
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
    getSessionKeyForChat: () => chatJid,
    resolveMainOnboardingGate: () => ({ active: false }),
    buildOnboardingInterviewPrompt: ({ prompt }) => prompt,
    extractOnboardingCompletion: (text) => ({ text, completed: false }),
    completeMainWorkspaceOnboarding: () => {},
    rememberHeartbeatTarget: () => {},
    runAgent: async (_group, prompt) => {
      runCount += 1;
      capturedPrompts.push(prompt);
      if (runCount === 1) {
        markFirstRunStarted?.();
        await firstRunGate;
      }
      return { ok: true, result: `done-${runCount}`, streamed: false };
    },
    consumeNextRunNoContinue: () => false,
    updateChatUsage: () => {},
    persistAssistantHistory: () => {},
    deleteTelegramPreviewMessage: async () => {},
    finalizeTelegramPreviewMessage: async () => false,
    sendAgentResultMessage: async () => {},
    emitTuiChatEvent: () => {},
    emitTuiAgentEvent: () => {},
    isTelegramJid: () => false,
    consumeTelegramHostCompletedRun: () => false,
    consumeTelegramHostStreamState: () => null,
    resolveTelegramStreamCompletionState: ({
      externallyCompleted,
      previewState,
    }) => ({
      effectiveStreamed: externallyCompleted,
      messagePreviewState: previewState,
    }),
    finalizeCompletedRun,
  } as any);

  const firstDispatch = dispatcher.processMessage({
    id: 'u-non-main-start',
    chat_jid: chatJid,
    sender: chatJid,
    sender_name: 'TD',
    content: '@FarmFriend start',
    timestamp: '2026-03-29T18:05:12.000Z',
    is_from_me: 0,
  });
  await firstRunStarted;

  await dispatcher.processMessage({
    id: 'u-non-main-ignored',
    chat_jid: chatJid,
    sender: chatJid,
    sender_name: 'TD',
    content: 'this should be ignored without trigger',
    timestamp: '2026-03-29T18:05:13.000Z',
    is_from_me: 0,
  });
  const queued = await dispatcher.runDirectSessionTurn({
    chatJid,
    text: 'queued tui turn',
    runId: 'tui-queued-1',
    deliver: false,
  });
  assert.equal(queued.status, 'queued');

  releaseFirstRun?.();
  await firstDispatch;

  const waitUntil = async (predicate: () => boolean) => {
    const timeoutAt = Date.now() + 1500;
    while (Date.now() < timeoutAt) {
      if (predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.fail('Timed out waiting for TUI drain');
  };
  await waitUntil(() => runCount === 2);
  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.equal(runCount, 2);
  assert.match(capturedPrompts[1] || '', /queued tui turn/);
});

test('processMessage prepends unresolved continuity summary when provided', async () => {
  let capturedPrompt = '';
  const dispatcher = createMessageDispatcher({
    state: {
      registeredGroups: {
        'telegram:continuity-preamble': {
          jid: 'telegram:continuity-preamble',
          name: 'Continuity Preamble',
          folder: 'main',
          trigger: '@FarmFriend',
        },
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
    getSessionKeyForChat: () => 'main',
    resolveMainOnboardingGate: () => ({ active: false }),
    buildOnboardingInterviewPrompt: ({ prompt }) => prompt,
    extractOnboardingCompletion: (text) => ({ text, completed: false }),
    completeMainWorkspaceOnboarding: () => {},
    rememberHeartbeatTarget: () => {},
    runAgent: async (_group, prompt) => {
      capturedPrompt = prompt;
      return { ok: true, result: 'done', streamed: false };
    },
    consumeNextRunNoContinue: () => false,
    updateChatUsage: () => {},
    persistAssistantHistory: () => {},
    deleteTelegramPreviewMessage: async () => {},
    finalizeTelegramPreviewMessage: async () => false,
    sendAgentResultMessage: async () => {},
    emitTuiChatEvent: () => {},
    emitTuiAgentEvent: () => {},
    isTelegramJid: () => false,
    consumeTelegramHostCompletedRun: () => false,
    consumeTelegramHostStreamState: () => null,
    resolveTelegramStreamCompletionState: ({
      externallyCompleted,
      previewState,
    }) => ({
      effectiveStreamed: externallyCompleted,
      messagePreviewState: previewState,
    }),
    finalizeCompletedRun,
    getUnresolvedWorkSummary: () =>
      'Pending file delivery requests: 1. Verify action_results/<requestId>.json before declaring completion.',
  } as any);

  await dispatcher.processMessage({
    id: 'u-continuity',
    chat_jid: 'telegram:continuity-preamble',
    sender: 'telegram:continuity-preamble',
    sender_name: 'TD',
    content: 'send me the generated image',
    timestamp: '2026-03-29T18:05:12.000Z',
    is_from_me: 0,
  });

  assert.match(capturedPrompt, /\[UNRESOLVED CONTINUITY CHECK\]/);
  assert.match(
    capturedPrompt,
    /Pending file delivery requests: 1\. Verify action_results\/<requestId>\.json before declaring completion\./,
  );
});

test('processMessage skips recent context when the next run disables continuation', async () => {
  let capturedPrompt = '';
  const promptLogs: Array<Record<string, unknown>> = [];

  const dispatcher = createMessageDispatcher({
    state: {
      registeredGroups: {
        'telegram:nocontinue': {
          jid: 'telegram:nocontinue',
          name: 'No Continue',
          folder: 'main',
          trigger: '@FarmFriend',
        },
      },
      chatRunPreferences: {},
      lastAgentTimestamp: {
        'telegram:nocontinue': '2026-03-29T18:04:52.000Z',
      },
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
    getMessagesSince: () => [
      {
        id: 'u-rebase',
        chat_jid: 'telegram:nocontinue',
        sender: 'telegram:nocontinue',
        sender_name: 'TD',
        content: 'follow up after rebase',
        timestamp: '2026-03-29T18:05:12.000Z',
        is_from_me: 0,
      },
    ],
    getSessionKeyForChat: () => 'main',
    resolveMainOnboardingGate: () => ({ active: false }),
    buildOnboardingInterviewPrompt: ({ prompt }) => prompt,
    extractOnboardingCompletion: (text) => ({ text, completed: false }),
    completeMainWorkspaceOnboarding: () => {},
    rememberHeartbeatTarget: () => {},
    runAgent: async (
      _group,
      prompt,
      _chatJid,
      _codingHint,
      _requestId,
      runtimePrefs,
    ) => {
      capturedPrompt = prompt;
      assert.equal(runtimePrefs.nextRunNoContinue, true);
      return { ok: true, result: 'done', streamed: false };
    },
    consumeNextRunNoContinue: () => true,
    updateChatUsage: () => {},
    persistAssistantHistory: () => {},
    deleteTelegramPreviewMessage: async () => {},
    finalizeTelegramPreviewMessage: async () => false,
    sendAgentResultMessage: async () => {},
    emitTuiChatEvent: () => {},
    emitTuiAgentEvent: () => {},
    isTelegramJid: () => false,
    consumeTelegramHostCompletedRun: () => false,
    consumeTelegramHostStreamState: () => null,
    resolveTelegramStreamCompletionState: ({
      externallyCompleted,
      previewState,
    }) => ({
      effectiveStreamed: externallyCompleted,
      messagePreviewState: previewState,
    }),
    finalizeCompletedRun,
    getRecentConversation: () => [
      {
        id: 'a-prev',
        chat_jid: 'telegram:nocontinue',
        sender: 'FarmFriend',
        sender_name: 'FarmFriend',
        content: 'FarmFriend: Previous answer before the rebase.',
        timestamp: '2026-03-29T18:04:52.000Z',
        is_from_me: 1,
      },
    ],
    writePromptInputLog: (payload) => {
      promptLogs.push(payload);
    },
  } as any);

  await dispatcher.processMessage({
    id: 'u-rebase',
    chat_jid: 'telegram:nocontinue',
    sender: 'telegram:nocontinue',
    sender_name: 'TD',
    content: 'follow up after rebase',
    timestamp: '2026-03-29T18:05:12.000Z',
    is_from_me: 0,
  });

  assert.doesNotMatch(capturedPrompt, /Previous answer before the rebase/);
  assert.equal(promptLogs.length, 1);
  assert.equal(promptLogs[0]?.noContinue, true);
  assert.equal(promptLogs[0]?.recentContextCount, 0);
});

test('processMessage emits prompt input diagnostics with metadata and final prompt text', async () => {
  const promptLogs: Array<Record<string, unknown>> = [];

  const dispatcher = createMessageDispatcher({
    state: {
      registeredGroups: {
        'telegram:prompt-log': {
          jid: 'telegram:prompt-log',
          name: 'Prompt Log',
          folder: 'main',
          trigger: '@FarmFriend',
        },
      },
      chatRunPreferences: {},
      lastAgentTimestamp: {
        'telegram:prompt-log': '2026-03-29T18:04:52.000Z',
      },
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
    getMessagesSince: () => [
      {
        id: 'u-log',
        chat_jid: 'telegram:prompt-log',
        sender: 'telegram:prompt-log',
        sender_name: 'TD',
        content: 'capture the prompt log',
        timestamp: '2026-03-29T18:05:12.000Z',
        is_from_me: 0,
      },
    ],
    getSessionKeyForChat: () => 'main',
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
    isTelegramJid: () => false,
    consumeTelegramHostCompletedRun: () => false,
    consumeTelegramHostStreamState: () => null,
    resolveTelegramStreamCompletionState: ({
      externallyCompleted,
      previewState,
    }) => ({
      effectiveStreamed: externallyCompleted,
      messagePreviewState: previewState,
    }),
    finalizeCompletedRun,
    getRecentConversation: () => [
      {
        id: 'a-log',
        chat_jid: 'telegram:prompt-log',
        sender: 'FarmFriend',
        sender_name: 'FarmFriend',
        content: 'FarmFriend: prior context for diagnostics',
        timestamp: '2026-03-29T18:04:52.000Z',
        is_from_me: 1,
      },
    ],
    writePromptInputLog: (payload) => {
      promptLogs.push(payload);
    },
  } as any);

  await dispatcher.processMessage({
    id: 'u-log',
    chat_jid: 'telegram:prompt-log',
    sender: 'telegram:prompt-log',
    sender_name: 'TD',
    content: 'capture the prompt log',
    timestamp: '2026-03-29T18:05:12.000Z',
    is_from_me: 0,
  });

  assert.equal(promptLogs.length, 1);
  assert.equal(promptLogs[0]?.chatJid, 'telegram:prompt-log');
  assert.equal(promptLogs[0]?.queueMode, 'collect');
  assert.equal(promptLogs[0]?.selectedMessageCount, 1);
  assert.equal(promptLogs[0]?.recentContextCount, 1);
  assert.match(
    String(promptLogs[0]?.finalPrompt || ''),
    /\[RECENT CONVERSATION\]/,
  );
  assert.match(
    String(promptLogs[0]?.finalPrompt || ''),
    /capture the prompt log/,
  );
});

test('processMessage sanitizes invalid persisted model overrides before run dispatch', async () => {
  const sent: string[] = [];
  let capturedRuntimePrefs: Record<string, any> | null = null;

  const dispatcher = createMessageDispatcher({
    state: {
      registeredGroups: {
        'telegram:sanitize': {
          jid: 'telegram:sanitize',
          name: 'Sanitize',
          folder: 'main',
          trigger: '@FarmFriend',
        },
      },
      chatRunPreferences: {
        'telegram:sanitize': {
          provider: 'kimi',
          model: 'invalid-model',
        },
      },
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
    sendMessage: async (_chatJid, text) => {
      sent.push(text);
      return true;
    },
    setTyping: async () => {},
    getMessagesSince: () => [],
    getSessionKeyForChat: () => 'main',
    resolveMainOnboardingGate: () => ({ active: false }),
    buildOnboardingInterviewPrompt: ({ prompt }) => prompt,
    extractOnboardingCompletion: (text) => ({ text, completed: false }),
    completeMainWorkspaceOnboarding: () => {},
    rememberHeartbeatTarget: () => {},
    runAgent: async (
      _group,
      _prompt,
      _chatJid,
      _codingHint,
      _requestId,
      runtimePrefs,
    ) => {
      capturedRuntimePrefs = { ...runtimePrefs };
      return { ok: true, result: 'done', streamed: false };
    },
    consumeNextRunNoContinue: () => false,
    updateChatUsage: () => {},
    persistAssistantHistory: () => {},
    deleteTelegramPreviewMessage: async () => {},
    finalizeTelegramPreviewMessage: async () => false,
    sendAgentResultMessage: async () => true,
    emitTuiChatEvent: () => {},
    emitTuiAgentEvent: () => {},
    isTelegramJid: () => true,
    consumeTelegramHostCompletedRun: () => false,
    consumeTelegramHostStreamState: () => null,
    resolveTelegramStreamCompletionState: ({
      externallyCompleted,
      previewState,
    }) => ({
      effectiveStreamed: externallyCompleted,
      messagePreviewState: previewState,
    }),
    finalizeCompletedRun,
    sanitizeRunPreferences: (_chatJid, runtimePrefs) => {
      assert.equal(runtimePrefs.provider, 'kimi');
      assert.equal(runtimePrefs.model, 'invalid-model');
      return {
        runPreferences: {},
        noticeText: 'Cleared invalid model override.',
      };
    },
  } as any);

  await dispatcher.processMessage({
    id: 'u-sanitize',
    chat_jid: 'telegram:sanitize',
    sender: 'telegram:sanitize',
    sender_name: 'TD',
    content: 'hello',
    timestamp: '2026-03-29T18:05:12.000Z',
    is_from_me: 0,
  });

  assert.deepEqual(capturedRuntimePrefs, {});
  assert.equal(sent[0], 'Cleared invalid model override.');
});

test('runDirectSessionTurn applies sanitized model preferences before run starts', async () => {
  const sent: string[] = [];
  let capturedRuntimePrefs: Record<string, any> | null = null;

  const dispatcher = createMessageDispatcher({
    state: {
      registeredGroups: {
        'telegram:direct-sanitize': {
          jid: 'telegram:direct-sanitize',
          name: 'Direct Sanitize',
          folder: 'main',
          trigger: '@FarmFriend',
        },
      },
      chatRunPreferences: {
        'telegram:direct-sanitize': {
          provider: 'kimi',
          model: 'invalid-model',
        },
      },
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
    sendMessage: async (_chatJid, text) => {
      sent.push(text);
      return true;
    },
    setTyping: async () => {},
    getMessagesSince: () => [],
    getSessionKeyForChat: () => 'main',
    resolveMainOnboardingGate: () => ({ active: false }),
    buildOnboardingInterviewPrompt: ({ prompt }) => prompt,
    extractOnboardingCompletion: (text) => ({ text, completed: false }),
    completeMainWorkspaceOnboarding: () => {},
    rememberHeartbeatTarget: () => {},
    runAgent: async (
      _group,
      _prompt,
      _chatJid,
      _codingHint,
      _requestId,
      runtimePrefs,
    ) => {
      capturedRuntimePrefs = { ...runtimePrefs };
      return { ok: true, result: 'done', streamed: false };
    },
    consumeNextRunNoContinue: () => false,
    updateChatUsage: () => {},
    persistAssistantHistory: () => {},
    deleteTelegramPreviewMessage: async () => {},
    finalizeTelegramPreviewMessage: async () => false,
    sendAgentResultMessage: async () => true,
    emitTuiChatEvent: () => {},
    emitTuiAgentEvent: () => {},
    isTelegramJid: () => true,
    consumeTelegramHostCompletedRun: () => false,
    consumeTelegramHostStreamState: () => null,
    resolveTelegramStreamCompletionState: ({
      externallyCompleted,
      previewState,
    }) => ({
      effectiveStreamed: externallyCompleted,
      messagePreviewState: previewState,
    }),
    finalizeCompletedRun,
    sanitizeRunPreferences: (_chatJid, runtimePrefs) => {
      assert.equal(runtimePrefs.provider, 'kimi');
      assert.equal(runtimePrefs.model, 'invalid-model');
      return {
        runPreferences: { model: 'MiniMax-M2.1', provider: 'minimax' },
        noticeText: 'Cleared invalid model override.',
      };
    },
  } as any);

  const start = await dispatcher.runDirectSessionTurn({
    chatJid: 'telegram:direct-sanitize',
    text: 'hello',
    runId: 'sanitize-run',
    deliver: false,
  });

  assert.deepEqual(start, { runId: 'sanitize-run', status: 'started' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(capturedRuntimePrefs, {
    model: 'MiniMax-M2.1',
    provider: 'minimax',
  });
  assert.equal(sent[0], 'Cleared invalid model override.');
});
