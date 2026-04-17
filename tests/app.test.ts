import assert from 'node:assert/strict';
import test from 'node:test';

import { createAppRuntime } from '../src/app.js';

test('startTelegram registers polling handler and routes callback queries', async () => {
  let pollHandler:
    | ((event: { kind?: string; id?: string; chatJid?: string; data?: string }) => Promise<void>)
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
        'telegram:1': { jid: 'telegram:1', name: 'Test', folder: 'test', trigger: '@FarmFriend' },
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
