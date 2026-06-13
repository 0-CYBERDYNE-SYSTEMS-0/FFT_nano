import assert from 'node:assert/strict';
import test from 'node:test';

import { createAppRuntime } from '../src/app.js';

test('startTelegram registers polling handler and routes callback queries', async () => {
  let pollHandler:
    | ((event: {
        kind?: string;
        id?: string;
        chatJid?: string;
        data?: string;
      }) => Promise<void>)
    | undefined;
  const callbacks: string[] = [];

  const runtime = createAppRuntime({
    state: {
      telegramBot: undefined,
      registeredGroups: {},
    },
    constants: {
      telegramBotToken: 'token',
      telegramApiBaseUrl: undefined,
      assistantName: 'FarmFriend',
      triggerPattern: /@FarmFriend/i,
    },
    createTelegramBot: () => ({
      startPolling: (handler) => {
        pollHandler = handler;
      },
    }),
    refreshTelegramCommandMenus: async () => {},
    handleTelegramCallbackQuery: async (event) => {
      callbacks.push(event.id);
    },
    handleTelegramSetupInput: async () => false,
    handleTelegramCommand: async () => false,
    storeChatMetadata: () => {},
    maybeRegisterTelegramChat: () => false,
    isMainChat: () => false,
    persistTelegramMedia: async (event) => event.content,
    storeTextMessage: () => {},
    logger: {
      info: () => {},
    },
  });

  await runtime.startTelegram();
  assert.ok(pollHandler);

  await pollHandler?.({
    kind: 'callback_query',
    id: 'cb-1',
    chatJid: 'telegram:1',
    data: 'panel:tasks',
  });

  assert.deepEqual(callbacks, ['cb-1']);
});

test('startTelegram stops message handling after setup input consumes the event', async () => {
  let pollHandler:
    | ((event: {
        id: string;
        chatJid: string;
        chatName: string;
        timestamp: string;
        content: string;
      }) => Promise<void>)
    | undefined;
  let commandCalls = 0;
  let stored = 0;

  const runtime = createAppRuntime({
    state: {
      telegramBot: undefined,
      registeredGroups: {
        'telegram:1': {
          jid: 'telegram:1',
          name: 'Test',
          folder: 'test',
          trigger: '@FarmFriend',
        },
      },
    },
    constants: {
      telegramBotToken: 'token',
      telegramApiBaseUrl: undefined,
      assistantName: 'FarmFriend',
      triggerPattern: /@FarmFriend/i,
    },
    createTelegramBot: () => ({
      startPolling: (handler) => {
        pollHandler = handler;
      },
    }),
    refreshTelegramCommandMenus: async () => {},
    handleTelegramCallbackQuery: async () => {},
    handleTelegramSetupInput: async () => true,
    handleTelegramCommand: async () => {
      commandCalls += 1;
      return false;
    },
    storeChatMetadata: () => {},
    maybeRegisterTelegramChat: () => false,
    isMainChat: () => false,
    persistTelegramMedia: async (event) => event.content,
    storeTextMessage: () => {
      stored += 1;
    },
    logger: {
      info: () => {},
    },
  });

  await runtime.startTelegram();
  await pollHandler?.({
    id: 'm-1',
    chatJid: 'telegram:1',
    chatName: 'Test',
    timestamp: '2026-03-21T12:00:00.000Z',
    content: 'hello',
  });

  assert.equal(commandCalls, 0);
  assert.equal(stored, 0);
});

test('startTelegram routes unregistered Telegram group messages to approval handler', async () => {
  let pollHandler:
    | ((event: {
        id: string;
        chatJid: string;
        chatName: string;
        timestamp: string;
        content: string;
      }) => Promise<void>)
    | undefined;
  const approvals: string[] = [];
  let stored = 0;

  const runtime = createAppRuntime({
    state: {
      telegramBot: undefined,
      registeredGroups: {},
    },
    constants: {
      telegramBotToken: 'token',
      telegramApiBaseUrl: undefined,
      assistantName: 'FarmFriend',
      triggerPattern: /@FarmFriend/i,
    },
    createTelegramBot: () => ({
      startPolling: (handler) => {
        pollHandler = handler;
      },
    }),
    refreshTelegramCommandMenus: async () => {},
    handleTelegramCallbackQuery: async () => {},
    handleTelegramSetupInput: async () => false,
    handleTelegramCommand: async () => false,
    handleTelegramUnknownGroup: async (event) => {
      approvals.push(event.chatJid);
    },
    storeChatMetadata: () => {},
    maybeRegisterTelegramChat: () => false,
    isMainChat: () => false,
    persistTelegramMedia: async (event) => event.content,
    storeTextMessage: () => {
      stored += 1;
    },
    logger: {
      info: () => {},
    },
  });

  await runtime.startTelegram();
  await pollHandler?.({
    id: 'm-unknown',
    chatJid: 'telegram:-1001',
    chatName: 'Field Team',
    timestamp: '2026-05-19T12:00:00.000Z',
    content: '@FarmFriend hello',
  });

  assert.deepEqual(approvals, ['telegram:-1001']);
  assert.equal(stored, 0);
});

test('main allows onboarding mode without configured channels', async () => {
  let tuiStarted = 0;
  let webStarted = 0;
  let schedulerStarted = 0;
  let messageLoopStarted = 0;

  const runtime = createAppRuntime({
    state: {
      telegramBot: undefined,
      registeredGroups: {},
    },
    constants: {
      telegramBotToken: undefined,
      telegramApiBaseUrl: undefined,
      assistantName: 'FarmFriend',
      triggerPattern: /@FarmFriend/i,
      dataDir: '/tmp/fft-nano-test',
      featureFarm: false,
      farmStateEnabled: false,
      whatsappEnabled: false,
      onboardingMode: true,
    },
    createTelegramBot: () => ({
      startPolling: () => {},
    }),
    refreshTelegramCommandMenus: async () => {},
    handleTelegramCallbackQuery: async () => {},
    handleTelegramSetupInput: async () => false,
    handleTelegramCommand: async () => false,
    storeChatMetadata: () => {},
    maybeRegisterTelegramChat: () => false,
    isMainChat: () => false,
    persistTelegramMedia: async (event) => event.content,
    storeTextMessage: () => {},
    logger: {
      info: () => {},
      warn: () => {},
    },
    ensureContainerSystemRunning: () => {},
    initDatabase: () => {},
    loadState: () => {},
    migrateLegacyClaudeMemoryFiles: () => {},
    migrateCompactionSummariesFromSoul: () => {},
    maybePromoteConfiguredTelegramMain: () => {},
    acquireSingletonLock: () => {},
    startTuiGatewayService: async () => {
      tuiStarted += 1;
      return true;
    },
    startWebControlCenterService: async () => {
      webStarted += 1;
    },
    startSchedulerLoop: () => {
      schedulerStarted += 1;
    },
    startMessageLoop: async () => {
      messageLoopStarted += 1;
    },
    maybeRunBootMdOnce: () => {},
  });

  await runtime.main();

  assert.equal(tuiStarted, 1);
  assert.equal(webStarted, 1);
  assert.equal(schedulerStarted, 0);
  assert.equal(messageLoopStarted, 0);
});

test('main allows TUI-only mode without starting channel delivery loops', async () => {
  let telegramStarted = 0;
  let schedulerStarted = 0;
  let messageLoopStarted = 0;
  let heartbeatStarted = 0;
  let outboxFlushed = 0;
  let longRunsResumed = 0;

  const runtime = createAppRuntime({
    state: {
      telegramBot: undefined,
      registeredGroups: {},
    },
    constants: {
      telegramBotToken: undefined,
      assistantName: 'FarmFriend',
      triggerPattern: /@FarmFriend/i,
      featureFarm: false,
      farmStateEnabled: false,
      whatsappEnabled: false,
      onboardingMode: false,
    },
    createTelegramBot: () => {
      telegramStarted += 1;
      return { startPolling: () => {} };
    },
    refreshTelegramCommandMenus: async () => {},
    handleTelegramCallbackQuery: async () => {},
    handleTelegramSetupInput: async () => false,
    handleTelegramCommand: async () => false,
    storeChatMetadata: () => {},
    maybeRegisterTelegramChat: () => false,
    isMainChat: () => false,
    persistTelegramMedia: async (event) => event.content,
    storeTextMessage: () => {},
    logger: {
      info: () => {},
      warn: () => {},
    },
    ensureContainerSystemRunning: () => {},
    initDatabase: () => {},
    loadState: () => {},
    migrateLegacyClaudeMemoryFiles: () => {},
    migrateCompactionSummariesFromSoul: () => {},
    maybePromoteConfiguredTelegramMain: () => {},
    acquireSingletonLock: () => {},
    startTuiGatewayService: async () => true,
    startWebControlCenterService: async () => {},
    startSchedulerLoop: () => {
      schedulerStarted += 1;
    },
    startMessageLoop: async () => {
      messageLoopStarted += 1;
    },
    startHeartbeatLoop: () => {
      heartbeatStarted += 1;
    },
    flushDeliveryOutbox: async () => {
      outboxFlushed += 1;
      return { delivered: 0, stillPending: 0 };
    },
    resumeRecoverableLongRuns: async () => {
      longRunsResumed += 1;
      return { resumed: 0, abandoned: 0 };
    },
    maybeRunBootMdOnce: () => {},
  });

  await runtime.main();

  assert.equal(telegramStarted, 0);
  assert.equal(schedulerStarted, 0);
  assert.equal(messageLoopStarted, 0);
  assert.equal(heartbeatStarted, 0);
  assert.equal(outboxFlushed, 0);
  assert.equal(longRunsResumed, 0);
});

test('main rejects channel-free startup when the TUI gateway is unavailable', async () => {
  const runtime = createAppRuntime({
    state: {
      telegramBot: undefined,
      registeredGroups: {},
    },
    constants: {
      telegramBotToken: undefined,
      assistantName: 'FarmFriend',
      triggerPattern: /@FarmFriend/i,
      featureFarm: false,
      farmStateEnabled: false,
      whatsappEnabled: false,
      onboardingMode: false,
    },
    createTelegramBot: () => ({ startPolling: () => {} }),
    refreshTelegramCommandMenus: async () => {},
    handleTelegramCallbackQuery: async () => {},
    handleTelegramSetupInput: async () => false,
    handleTelegramCommand: async () => false,
    storeChatMetadata: () => {},
    maybeRegisterTelegramChat: () => false,
    isMainChat: () => false,
    persistTelegramMedia: async (event) => event.content,
    storeTextMessage: () => {},
    logger: {
      info: () => {},
      warn: () => {},
    },
    ensureContainerSystemRunning: () => {},
    initDatabase: () => {},
    loadState: () => {},
    migrateLegacyClaudeMemoryFiles: () => {},
    migrateCompactionSummariesFromSoul: () => {},
    maybePromoteConfiguredTelegramMain: () => {},
    acquireSingletonLock: () => {},
    startTuiGatewayService: async () => false,
    startWebControlCenterService: async () => {},
  });

  await assert.rejects(
    runtime.main(),
    /No channels enabled.*TUI gateway is unavailable/,
  );
});
