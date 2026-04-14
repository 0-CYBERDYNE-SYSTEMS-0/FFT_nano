import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createTelegramCommandHandlers,
  type TelegramCommandDeps,
} from '../src/telegram-commands.js';

function createBaseDeps(): TelegramCommandDeps {
  const sent: Array<{ chatJid: string; text: string }> = [];
  const agentResults: Array<{
    chatJid: string;
    text: string;
    opts?: { prefixWhatsApp?: boolean };
  }> = [];
  const panels: Array<{ chatJid: string; panel: { kind: string } }> = [];
  const persisted: Array<Record<string, string | undefined>> = [];
  const keyboardMessages: Array<{
    chatJid: string;
    text: string;
    keyboard: Array<Array<{ text: string; callbackData: string }>>;
  }> = [];
  const audits: Array<{ chatJid: string; command: string; allowed: boolean; reason: string }> =
    [];
  const resumedChats: Array<{ chatJid: string; text: string; deliver: boolean }> =
    [];

  const deps: TelegramCommandDeps = {
    state: {
      telegramBot: {
        answerCallbackQuery: async () => {},
        sendMessageWithKeyboard: async (
          chatJid: string,
          text: string,
          keyboard: Array<Array<{ text: string; callbackData: string }>>,
        ) => {
          keyboardMessages.push({ chatJid, text, keyboard });
        },
      },
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
    normalizeTelegramDeliveryMode: (value) =>
      (
        {
          off: 'off',
          partial: 'partial',
          block: 'partial',
          draft: 'draft',
          native: 'draft',
          progress: 'partial',
          live: 'partial',
          persistent: 'partial',
          final: 'off',
        } as Record<string, string>
      )[value.trim().toLowerCase()] ?? null,
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
    runCodingTask: async () => ({ ok: true, result: 'done', streamed: false }),
    resumeDirectSessionTurn: async (chatJid, text, deliver) => {
      resumedChats.push({ chatJid, text, deliver });
      return { runId: 'resume-1', status: 'started' as const };
    },
    prepareCoderTarget: async ({ taskText }) => ({
      status: 'ready',
      workspaceRoot: '/tmp/projects/agintel-dashboard',
      taskText,
      projectLabel: 'agintel-dashboard',
    }),
    createCoderProject: async ({ slug }) => ({
      workspaceRoot: `/tmp/projects/${slug}`,
      projectLabel: slug,
      isGitRepo: false,
    }),
    setTyping: async () => {},
    persistAssistantHistory: () => {},
    sendAgentResultMessage: async (chatJid, text, opts) => {
      agentResults.push({ chatJid, text, opts });
      return true;
    },
    updateChatUsage: () => {},
    logTelegramCommandAudit: (chatJid, command, allowed, reason) => {
      audits.push({ chatJid, command, allowed, reason });
    },
  };

  Object.assign(deps, {
    sent,
    agentResults,
    panels,
    persisted,
    audits,
    keyboardMessages,
    resumedChats,
  });
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

test('handleTelegramCallbackQuery starts a coder plan from approval actions', async () => {
  const deps = createBaseDeps() as TelegramCommandDeps & {
    sent: Array<{ chatJid: string; text: string }>;
  };
  deps.state.registeredGroups['telegram:main'] = {
    jid: 'telegram:main',
    name: 'Main',
    folder: 'main',
    trigger: '@FarmFriend',
  };
  deps.getTelegramSettingsPanelAction = () => ({
    kind: 'coder-approve-plan',
    taskText: 'fix the auth bug',
  });

  const codingCalls: Array<Record<string, unknown>> = [];
  deps.runCodingTask = async (params) => {
    codingCalls.push(params as Record<string, unknown>);
    return { ok: true, result: 'done', streamed: false };
  };

  const handlers = createTelegramCommandHandlers(deps);
  await handlers.handleTelegramCallbackQuery({
    id: 'cb-plan',
    chatJid: 'telegram:main',
    messageId: 55,
    data: 'cfg:plan',
  });

  assert.equal(codingCalls.length, 1);
  assert.equal(codingCalls[0]?.mode, 'plan');
  assert.equal(codingCalls[0]?.workspaceRoot, '/tmp/projects/agintel-dashboard');
  assert.match(deps.sent[0]?.text || '', /Starting coder plan run/);
});

test('handleTelegramCallbackQuery offers plan fallback when execute target is not git-backed', async () => {
  const deps = createBaseDeps() as TelegramCommandDeps & {
    keyboardMessages: Array<{
      chatJid: string;
      text: string;
      keyboard: Array<Array<{ text: string; callbackData: string }>>;
    }>;
  };
  deps.getTelegramSettingsPanelAction = () => ({
    kind: 'coder-select-project',
    mode: 'execute',
    taskText: 'build it',
    projectPath: '/tmp/projects/orchard-os',
    projectLabel: 'orchard-os',
    isGitRepo: false,
  });

  const handlers = createTelegramCommandHandlers(deps);
  await handlers.handleTelegramCallbackQuery({
    id: 'cb-non-git',
    chatJid: 'telegram:main',
    messageId: 56,
    data: 'cfg:exec',
  });

  assert.match(deps.keyboardMessages[0]?.text || '', /not a git-backed project/i);
  assert.equal(deps.keyboardMessages[0]?.keyboard[0]?.[0]?.text, 'Start Plan Instead');
});

test('handleTelegramCallbackQuery resumes normal chat when auto-suggest cancel is selected', async () => {
  const deps = createBaseDeps() as TelegramCommandDeps & {
    sent: Array<{ chatJid: string; text: string }>;
    resumedChats: Array<{ chatJid: string; text: string; deliver: boolean }>;
  };
  deps.getTelegramSettingsPanelAction = () => ({
    kind: 'coder-cancel-resume',
    taskText: 'please build an app with auth and tests',
  });

  const handlers = createTelegramCommandHandlers(deps);
  await handlers.handleTelegramCallbackQuery({
    id: 'cb-resume',
    chatJid: 'telegram:main',
    messageId: 57,
    data: 'cfg:cancel-resume',
  });

  assert.equal(deps.sent[0]?.text, 'Coder request canceled. Continuing in the main chat flow.');
  assert.deepEqual(deps.resumedChats, [
    {
      chatJid: 'telegram:main',
      text: 'please build an app with auth and tests',
      deliver: true,
    },
  ]);
});

test('handleTelegramCallbackQuery keeps plain coder cancel as cancel only', async () => {
  const deps = createBaseDeps() as TelegramCommandDeps & {
    sent: Array<{ chatJid: string; text: string }>;
    resumedChats: Array<{ chatJid: string; text: string; deliver: boolean }>;
  };
  deps.getTelegramSettingsPanelAction = () => ({
    kind: 'coder-cancel',
  });

  const handlers = createTelegramCommandHandlers(deps);
  await handlers.handleTelegramCallbackQuery({
    id: 'cb-cancel-only',
    chatJid: 'telegram:main',
    messageId: 58,
    data: 'cfg:cancel-only',
  });

  assert.equal(deps.sent[0]?.text, 'Coder request canceled.');
  assert.equal(deps.resumedChats.length, 0);
});

test('handleTelegramCommand blocks /coder-create-project while onboarding is pending', async () => {
  const deps = createBaseDeps() as TelegramCommandDeps & {
    sent: Array<{ chatJid: string; text: string }>;
    audits: Array<{ chatJid: string; command: string; allowed: boolean; reason: string }>;
  };
  deps.isMainChat = () => true;
  deps.resolveMainOnboardingGate = () => ({ active: true });

  const handlers = createTelegramCommandHandlers(deps);
  const handled = await handlers.handleTelegramCommand({
    chatJid: 'telegram:main',
    chatName: 'Main',
    content: '/coder-create-project orchard-os build the first dashboard',
  });

  assert.equal(handled, true);
  assert.equal(deps.sent[0]?.text, 'blocked');
  assert.deepEqual(deps.audits[0], {
    chatJid: 'telegram:main',
    command: '/coder-create-project',
    allowed: false,
    reason: 'blocked by onboarding gate',
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
  deps.runCodingTask = () =>
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

test('handleTelegramCallbackQuery sends terminal failure message when coder run fails', async () => {
  const deps = createBaseDeps() as TelegramCommandDeps & {
    sent: Array<{ chatJid: string; text: string }>;
    agentResults: Array<{ chatJid: string; text: string }>;
  };
  deps.state.registeredGroups['telegram:main'] = {
    jid: 'telegram:main',
    name: 'Main',
    folder: 'main',
    trigger: '@FarmFriend',
  };
  deps.getTelegramSettingsPanelAction = () => ({
    kind: 'coder-approve-execute',
    taskText: 'fix the auth bug',
  });
  deps.runCodingTask = async () => ({
    ok: false,
    result: 'Pi run stalled before producing progress',
    streamed: false,
  });

  const handlers = createTelegramCommandHandlers(deps);
  await handlers.handleTelegramCallbackQuery({
    id: 'cb-fail',
    chatJid: 'telegram:main',
    messageId: 88,
    data: 'cfg:exec',
  });

  assert.match(deps.sent[0]?.text || '', /Starting coder run/i);
  assert.equal(deps.agentResults.length, 1);
  assert.match(deps.agentResults[0]?.text || '', /coder run failed/i);
  assert.match(
    deps.agentResults[0]?.text || '',
    /Pi run stalled before producing progress/i,
  );
});

test('handleTelegramCallbackQuery sends terminal completion message when coder run has no result text', async () => {
  const deps = createBaseDeps() as TelegramCommandDeps & {
    sent: Array<{ chatJid: string; text: string }>;
    agentResults: Array<{ chatJid: string; text: string }>;
  };
  deps.state.registeredGroups['telegram:main'] = {
    jid: 'telegram:main',
    name: 'Main',
    folder: 'main',
    trigger: '@FarmFriend',
  };
  deps.getTelegramSettingsPanelAction = () => ({
    kind: 'coder-approve-execute',
    taskText: 'fix the auth bug',
  });
  deps.runCodingTask = async () => ({
    ok: true,
    result: null,
    streamed: false,
  });

  const handlers = createTelegramCommandHandlers(deps);
  await handlers.handleTelegramCallbackQuery({
    id: 'cb-empty',
    chatJid: 'telegram:main',
    messageId: 89,
    data: 'cfg:exec',
  });

  assert.match(deps.sent[0]?.text || '', /Starting coder run/i);
  assert.equal(deps.agentResults.length, 1);
  assert.match(deps.agentResults[0]?.text || '', /coder run completed/i);
});

test('handleTelegramCallbackQuery reports aborted when fallback runAgent returns empty result after stop', async () => {
  const deps = createBaseDeps() as TelegramCommandDeps & {
    sent: Array<{ chatJid: string; text: string }>;
    agentResults: Array<{ chatJid: string; text: string }>;
  };
  deps.state.registeredGroups['telegram:main'] = {
    jid: 'telegram:main',
    name: 'Main',
    folder: 'main',
    trigger: '@FarmFriend',
  };
  deps.getTelegramSettingsPanelAction = () => ({
    kind: 'coder-approve-execute',
    taskText: 'fix the auth bug',
  });
  deps.runCodingTask = undefined;
  deps.runAgent = async (_group, _prompt, chatJid) => {
    deps.activeChatRuns.get(chatJid)?.abortController.abort(
      new Error('Stopped by user via /stop'),
    );
    return {
      ok: true,
      result: null,
      streamed: false,
    };
  };

  const handlers = createTelegramCommandHandlers(deps);
  await handlers.handleTelegramCallbackQuery({
    id: 'cb-abort',
    chatJid: 'telegram:main',
    messageId: 90,
    data: 'cfg:exec',
  });

  assert.match(deps.sent[0]?.text || '', /Starting coder run/i);
  assert.equal(deps.agentResults.length, 1);
  assert.match(deps.agentResults[0]?.text || '', /coder run aborted/i);
  assert.doesNotMatch(deps.agentResults[0]?.text || '', /coder run completed/i);
});

test('handleTelegramCommand reports aborted when subagent fallback runAgent is stopped', async () => {
  const deps = createBaseDeps() as TelegramCommandDeps & {
    sent: Array<{ chatJid: string; text: string }>;
    agentResults: Array<{ chatJid: string; text: string }>;
  };
  deps.state.registeredGroups['telegram:main'] = {
    jid: 'telegram:main',
    name: 'Main',
    folder: 'main',
    trigger: '@FarmFriend',
  };
  deps.isMainChat = () => true;
  deps.runCodingTask = undefined;
  deps.runAgent = async (_group, _prompt, chatJid) => {
    deps.activeChatRuns.get(chatJid)?.abortController.abort(
      new Error('Stopped by user via /subagents stop current'),
    );
    return {
      ok: true,
      result: null,
      streamed: false,
    };
  };

  const handlers = createTelegramCommandHandlers(deps);
  const handled = await handlers.handleTelegramCommand({
    chatJid: 'telegram:main',
    chatName: 'Main',
    content: '/subagents spawn inspect this',
  });

  assert.equal(handled, true);
  assert.match(deps.sent[0]?.text || '', /Starting subagent run/i);
  assert.equal(deps.agentResults.length, 1);
  assert.match(deps.agentResults[0]?.text || '', /subagent run aborted/i);
  assert.doesNotMatch(
    deps.agentResults[0]?.text || '',
    /subagent run completed/i,
  );
});

test('handleTelegramCommand opens delivery panel when called without args', async () => {
  const deps = createBaseDeps() as TelegramCommandDeps & {
    panels: Array<{ chatJid: string; panel: { kind: string } }>;
  };

  const handlers = createTelegramCommandHandlers(deps);
  const handled = await handlers.handleTelegramCommand({
    chatJid: 'telegram:1',
    chatName: 'Chat',
    content: '/delivery',
  });

  assert.equal(handled, true);
  assert.deepEqual(deps.panels, [
    { chatJid: 'telegram:1', panel: { kind: 'show-delivery' } },
  ]);
});

test('handleTelegramCommand normalizes delivery aliases to canonical persisted values', async () => {
  const updates: Array<Record<string, any>> = [];
  const deps = createBaseDeps() as TelegramCommandDeps & {
    sent: Array<{ chatJid: string; text: string }>;
  };
  deps.updateChatRunPreferences = (_chatJid, updater) => {
    updates.push(updater({}));
  };
  deps.state.chatRunPreferences['telegram:1'] = {};
  deps.normalizeTelegramCommandToken = (value) => value.split('@')[0]!.toLowerCase();
  (deps as any).normalizeTelegramDeliveryMode = (value: string) =>
    ({
      off: 'off',
      partial: 'partial',
      block: 'partial',
      draft: 'draft',
      native: 'draft',
      progress: 'partial',
      live: 'partial',
      persistent: 'partial',
      final: 'off',
    })[value];

  const handlers = createTelegramCommandHandlers(deps);
  const handled = await handlers.handleTelegramCommand({
    chatJid: 'telegram:1',
    chatName: 'Chat',
    content: '/delivery progress',
  });

  assert.equal(handled, true);
  assert.deepEqual(updates, [{ telegramDeliveryMode: 'partial' }]);
  assert.match(deps.sent[0]?.text || '', /Delivery mode set to partial/i);
});

test('handleTelegramCommand accepts the native Telegram draft delivery mode', async () => {
  const updates: Array<Record<string, any>> = [];
  const deps = createBaseDeps() as TelegramCommandDeps & {
    sent: Array<{ chatJid: string; text: string }>;
  };
  deps.updateChatRunPreferences = (_chatJid, updater) => {
    updates.push(updater({}));
  };

  const handlers = createTelegramCommandHandlers(deps);
  const handled = await handlers.handleTelegramCommand({
    chatJid: 'telegram:1',
    chatName: 'Chat',
    content: '/delivery draft',
  });

  assert.equal(handled, true);
  assert.deepEqual(updates, [{ telegramDeliveryMode: 'draft' }]);
  assert.match(deps.sent[0]?.text || '', /Delivery mode set to draft/i);
});

test('handleTelegramCommand reports canonical delivery modes in help text', async () => {
  const deps = createBaseDeps() as TelegramCommandDeps & {
    sent: Array<{ chatJid: string; text: string }>;
  };
  deps.state.chatRunPreferences['telegram:1'] = { telegramDeliveryMode: 'partial' } as any;

  const handlers = createTelegramCommandHandlers(deps);
  const handled = await handlers.handleTelegramCommand({
    chatJid: 'telegram:1',
    chatName: 'Chat',
    content: '/delivery final',
  });

  assert.equal(handled, true);
  assert.match(deps.sent[0]?.text || '', /Delivery mode set to off/i);
});
