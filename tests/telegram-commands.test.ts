import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createTelegramCommandHandlers,
  type TelegramCommandDeps,
} from '../src/telegram-commands.js';

function createBaseDeps(): TelegramCommandDeps {
  const sent: Array<{ chatJid: string; text: string }> = [];
  const panels: Array<{ chatJid: string; panel: { kind: string } }> = [];
  const persisted: Array<Record<string, string | undefined>> = [];
  const audits: Array<{ chatJid: string; command: string; allowed: boolean; reason: string }> =
    [];

  const deps: TelegramCommandDeps = {
    state: {
      telegramBot: {},
      chatRunPreferences: {},
      registeredGroups: {},
      chatUsageStats: {},
    },
    constants: {
      assistantName: 'FarmFriend',
      mainGroupFolder: 'main',
      telegramAdminSecret: 'secret',
      telegramSettingsPanelPrefix: 'settings:',
      runtimeProviderPresetEnv: 'RUNTIME_PROVIDER_PRESET',
    },
    activeChatRuns: new Map(),
    activeCoderRuns: new Map(),
    sendMessage: async (chatJid, text) => {
      sent.push({ chatJid, text });
    },
    sendTelegramSettingsPanel: async (chatJid, panel) => {
      panels.push({ chatJid, panel });
    },
    editTelegramSettingsPanel: async () => {},
    promptTelegramSetupInput: async () => {},
    clearTelegramSetupInputState: () => {},
    getTelegramSetupInputState: () => null,
    getTelegramSettingsPanelAction: () => null,
    updateChatRunPreferences: () => {},
    isMainChat: () => false,
    formatTasksText: () => 'tasks',
    formatGroupsText: () => 'groups',
    formatStatusText: () => 'status',
    formatHelpText: () => 'help',
    formatUsageText: () => 'usage',
    formatActiveSubagentsText: () => 'subagents',
    summarizeTask: () => 'task detail',
    formatTaskRunsText: () => 'task runs',
    runPiListModels: () => ({ text: 'models' }),
    normalizeThinkLevel: () => null,
    normalizeReasoningLevel: () => null,
    parseQueueArgs: () => ({}),
    parseVerboseDirective: () => ({ kind: 'none' }),
    describeVerboseMode: () => 'verbose',
    getEffectiveVerboseMode: () => 'off',
    getEffectiveModelLabel: () => 'provider/model',
    resolveMainOnboardingGate: () => ({ active: false }),
    onboardingCommandBlockedText: () => 'blocked',
    runCompactionForChat: async () => 'done',
    parseTelegramChatId: () => '123',
    parseTelegramTargetJid: () => null,
    normalizeTelegramCommandToken: (value) => value.toLowerCase(),
    promoteChatToMain: () => {},
    refreshTelegramCommandMenus: async () => {},
    hasMainGroup: () => false,
    runGatewayServiceCommand: () => ({ ok: true, text: 'ok' }),
    buildRuntimeProviderPresetUpdates: () => ({}),
    getRuntimeConfigEnv: () => ({}),
    persistRuntimeConfigUpdates: (updates) => {
      persisted.push(updates);
    },
    resolveRuntimeConfigSnapshot: () => ({
      providerPreset: 'manual',
      apiKeyEnv: 'OPENAI_API_KEY',
    }),
    registerTelegramSettingsPanelAction: () => 'panel-action',
    buildAdminPanelKeyboard: () => [],
    getTaskById: () => null,
    updateTask: () => {},
    deleteTask: () => {},
    emitTuiChatEvent: () => {},
    emitTuiAgentEvent: () => {},
    getSessionKeyForChat: (chatJid) => chatJid,
    runAgent: async () => ({ ok: true, result: 'done', streamed: false }),
    setTyping: async () => {},
    persistAssistantHistory: () => {},
    sendAgentResultMessage: async () => {},
    updateChatUsage: () => {},
    logTelegramCommandAudit: (chatJid, command, allowed, reason) => {
      audits.push({ chatJid, command, allowed, reason });
    },
  };

  Object.assign(deps, { sent, panels, persisted, audits });
  return deps;
}

test('handleTelegramSetupInput persists provider value and confirms to chat', async () => {
  const deps = createBaseDeps() as TelegramCommandDeps & {
    sent: Array<{ chatJid: string; text: string }>;
    panels: Array<{ chatJid: string; panel: { kind: string } }>;
    persisted: Array<Record<string, string | undefined>>;
  };
  deps.getTelegramSetupInputState = () => ({ kind: 'provider', startedAt: Date.now() });

  const handlers = createTelegramCommandHandlers(deps);
  const handled = await handlers.handleTelegramSetupInput({
    chatJid: 'telegram:1',
    content: ' minimax ',
  });

  assert.equal(handled, true);
  assert.deepEqual(deps.persisted, [
    {
      RUNTIME_PROVIDER_PRESET: undefined,
      PI_API: 'minimax',
    },
  ]);
  assert.deepEqual(deps.panels, [
    { chatJid: 'telegram:1', panel: { kind: 'show-setup-home' } },
  ]);
  assert.match(deps.sent[0]?.text || '', /Saved provider: minimax/);
});

test('handleTelegramCallbackQuery routes admin panel actions for main chat', async () => {
  const deps = createBaseDeps() as TelegramCommandDeps & {
    sent: Array<{ chatJid: string; text: string }>;
    audits: Array<{ chatJid: string; command: string; allowed: boolean; reason: string }>;
  };
  deps.isMainChat = () => true;

  const handlers = createTelegramCommandHandlers(deps);
  await handlers.handleTelegramCallbackQuery({
    id: 'cb-1',
    chatJid: 'telegram:main',
    messageId: 44,
    data: 'panel:tasks',
  });

  assert.equal(deps.sent[0]?.text, 'tasks');
  assert.deepEqual(deps.audits[0], {
    chatJid: 'telegram:main',
    command: 'panel:tasks',
    allowed: true,
    reason: 'ok',
  });
});

test('handleTelegramCommand registers spawned subagent runs in both active maps', async () => {
  let resolveRun:
    | ((value: { ok: boolean; result: string; streamed: boolean; usage?: { totalTokens?: number } }) => void)
    | undefined;
  const deps = createBaseDeps() as TelegramCommandDeps & {
    activeChatRunsById: Map<string, unknown>;
    sent: Array<{ chatJid: string; text: string }>;
  };
  deps.state.registeredGroups['telegram:main'] = {
    jid: 'telegram:main',
    name: 'Main',
    folder: 'main',
    trigger: '@FarmFriend',
  };
  deps.isMainChat = () => true;
  deps.activeChatRunsById = new Map();
  deps.runAgent = () =>
    new Promise((resolve) => {
      resolveRun = resolve;
    });

  const handlers = createTelegramCommandHandlers(deps as TelegramCommandDeps);
  const commandPromise = handlers.handleTelegramCommand({
    chatJid: 'telegram:main',
    chatName: 'Main',
    content: '/subagents spawn inspect this',
  });

  await new Promise((resolve) => setImmediate(resolve));
  const activeRun = deps.activeChatRuns.get('telegram:main') as { requestId: string } | undefined;
  assert.ok(activeRun);
  assert.equal(deps.activeChatRunsById.has(activeRun!.requestId), true);

  resolveRun?.({ ok: true, result: 'done', streamed: false });
  await commandPromise;
});
