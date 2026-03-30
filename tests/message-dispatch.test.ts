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
    resolveTelegramStreamCompletionState: ({ externallyCompleted, previewState }) => ({
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
        content: 'do you not remember when you just told me about the news stories?',
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
    resolveTelegramStreamCompletionState: ({ externallyCompleted, previewState }) => ({
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
        content: 'do you not remember when you just told me about the news stories?',
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
    content: 'do you not remember when you just told me about the news stories?',
    timestamp: '2026-03-29T18:05:12.000Z',
    is_from_me: 0,
  });

  assert.match(capturedPrompt, /\[RECENT CONVERSATION\]/);
  assert.match(capturedPrompt, /\[NEW INBOUND MESSAGES\]/);
  assert.match(capturedPrompt, /FarmFriend: Here are the agtech and AI agent headlines\./);
  assert.match(capturedPrompt, /do you not remember when you just told me about the news stories\?/);
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
    resolveTelegramStreamCompletionState: ({ externallyCompleted, previewState }) => ({
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
    resolveTelegramStreamCompletionState: ({ externallyCompleted, previewState }) => ({
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
    runAgent: async (_group, prompt, _chatJid, _codingHint, _requestId, runtimePrefs) => {
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
    resolveTelegramStreamCompletionState: ({ externallyCompleted, previewState }) => ({
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
    resolveTelegramStreamCompletionState: ({ externallyCompleted, previewState }) => ({
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
  assert.match(String(promptLogs[0]?.finalPrompt || ''), /\[RECENT CONVERSATION\]/);
  assert.match(String(promptLogs[0]?.finalPrompt || ''), /capture the prompt log/);
});
