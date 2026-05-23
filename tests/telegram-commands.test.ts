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
  const audits: Array<{
    chatJid: string;
    command: string;
    allowed: boolean;
    reason: string;
  }> = [];
  const runProgress: Array<{
    chatJid: string;
    requestId: string;
    phase: string;
    text: string;
    detail?: string;
  }> = [];
  const resumedChats: Array<{
    chatJid: string;
    text: string;
    deliver: boolean;
  }> = [];

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
    validateProviderModelRef: () => ({ ok: true }),
    normalizeThinkLevel: () => null,
    normalizeReasoningLevel: () => null,
    normalizeTelegramDeliveryMode: (value) =>
      (
        ({
          off: 'off',
          stream: 'stream',
          partial: 'stream',
          block: 'stream',
          draft: 'draft',
          native: 'draft',
          progress: 'stream',
          live: 'stream',
          persistent: 'stream',
          append: 'stream',
          final: 'off',
        }) as Record<string, string>
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
    approveTelegramGroup: async () => ({ ok: true, text: 'approved' }),
    ignoreTelegramGroup: async () => ({ ok: true, text: 'ignored' }),
    unignoreTelegramGroup: async () => ({ ok: true, text: 'unignored' }),
    runGatewayServiceCommand: () => ({ ok: true, text: 'ok' }),
    runUpdateCommand: () => ({ ok: true, text: 'updated' }),
    startUpdateCommand: () => ({
      ok: true,
      text: 'worker started',
      reportId: 'update-1',
    }),
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
    emitRunProgress: (payload) => {
      runProgress.push(payload);
    },
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
    runProgress,
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
  deps.getTelegramSetupInputState = () => ({
    kind: 'provider',
    startedAt: Date.now(),
  });

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
    audits: Array<{
      chatJid: string;
      command: string;
      allowed: boolean;
      reason: string;
    }>;
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

test('handleTelegramCallbackQuery approves pending Telegram groups from settings panel', async () => {
  const deps = createBaseDeps() as TelegramCommandDeps & {
    sent: Array<{ chatJid: string; text: string }>;
  };
  const edited: Array<{ chatJid: string; messageId: number; panel: any }> = [];
  const approved: string[] = [];
  deps.isMainChat = () => true;
  deps.getTelegramSettingsPanelAction = () => ({
    kind: 'approve-telegram-group',
    chatJid: 'telegram:-1001',
  });
  deps.approveTelegramGroup = async (chatJid) => {
    approved.push(chatJid);
    return { ok: true, text: 'approved' };
  };
  deps.editTelegramSettingsPanel = async (chatJid, messageId, panel) => {
    edited.push({ chatJid, messageId, panel });
  };

  const handlers = createTelegramCommandHandlers(deps);
  await handlers.handleTelegramCallbackQuery({
    id: 'cb-approve',
    chatJid: 'telegram:main',
    messageId: 55,
    data: 'settings:group',
  });

  assert.deepEqual(approved, ['telegram:-1001']);
  assert.deepEqual(edited, [
    { chatJid: 'telegram:main', messageId: 55, panel: { kind: 'show-groups' } },
  ]);
  assert.deepEqual(deps.sent, []);
});

test('handleTelegramCommand opens group management panel only in main chat', async () => {
  const deps = createBaseDeps() as TelegramCommandDeps & {
    panels: Array<{ chatJid: string; panel: { kind: string } }>;
    sent: Array<{ chatJid: string; text: string }>;
  };
  deps.isMainChat = (chatJid) => chatJid === 'telegram:main';
  const handlers = createTelegramCommandHandlers(deps);

  await handlers.handleTelegramCommand({
    id: 'm-1',
    chatJid: 'telegram:main',
    chatName: 'Main',
    sender: 'user',
    senderName: 'Owner',
    timestamp: '2026-05-19T12:00:00.000Z',
    content: '/groups',
  });
  await handlers.handleTelegramCommand({
    id: 'm-2',
    chatJid: 'telegram:-1001',
    chatName: 'Field Team',
    sender: 'user',
    senderName: 'Worker',
    timestamp: '2026-05-19T12:01:00.000Z',
    content: '/groups',
  });

  assert.deepEqual(deps.panels, [
    { chatJid: 'telegram:main', panel: { kind: 'show-groups' } },
  ]);
  assert.match(deps.sent[0]?.text || '', /main\/admin chat/);
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
  assert.equal(
    codingCalls[0]?.workspaceRoot,
    '/tmp/projects/agintel-dashboard',
  );
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

  assert.match(
    deps.keyboardMessages[0]?.text || '',
    /not a git-backed project/i,
  );
  assert.equal(
    deps.keyboardMessages[0]?.keyboard[0]?.[0]?.text,
    'Start Plan Instead',
  );
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

  assert.equal(
    deps.sent[0]?.text,
    'Coder request canceled. Continuing in the main chat flow.',
  );
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
    audits: Array<{
      chatJid: string;
      command: string;
      allowed: boolean;
      reason: string;
    }>;
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

test('handleTelegramCommand starts /update in background and sends durable ack', async () => {
  const deps = createBaseDeps() as TelegramCommandDeps & {
    sent: Array<{ chatJid: string; text: string }>;
    audits: Array<{
      chatJid: string;
      command: string;
      allowed: boolean;
      reason: string;
    }>;
  };
  const started: string[] = [];
  deps.isMainChat = () => true;
  deps.startUpdateCommand = (chatJid) => {
    started.push(chatJid);
    return { ok: true, text: 'worker started', reportId: 'update-abc' };
  };
  deps.runUpdateCommand = () => {
    throw new Error('sync update should not run for Telegram /update');
  };

  const handlers = createTelegramCommandHandlers(deps);
  const handled = await handlers.handleTelegramCommand({
    chatJid: 'telegram:main',
    chatName: 'Main',
    content: '/update',
  });

  assert.equal(handled, true);
  assert.deepEqual(started, ['telegram:main']);
  assert.match(deps.sent[0]?.text || '', /Update started/);
  assert.match(deps.sent[0]?.text || '', /Report id: update-abc/);
  assert.deepEqual(
    deps.audits.map((audit) => audit.reason),
    ['update started', 'update worker started update-abc'],
  );
});

test('handleTelegramCommand registers spawned subagent runs in both active maps', async () => {
  let resolveRun:
    | ((value: {
        ok: boolean;
        result: string;
        streamed: boolean;
        usage?: { totalTokens?: number };
      }) => void)
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
  const activeRun = deps.activeChatRuns.get('telegram:main') as
    | { requestId: string }
    | undefined;
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
    deps.activeChatRuns
      .get(chatJid)
      ?.abortController.abort(new Error('Stopped by user via /stop'));
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
    deps.activeChatRuns
      .get(chatJid)
      ?.abortController.abort(
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
  deps.normalizeTelegramCommandToken = (value) =>
    value.split('@')[0]!.toLowerCase();
  (deps as any).normalizeTelegramDeliveryMode = (value: string) =>
    ({
      off: 'off',
      stream: 'stream',
      partial: 'stream',
      block: 'stream',
      draft: 'draft',
      native: 'draft',
      progress: 'stream',
      live: 'stream',
      persistent: 'stream',
      append: 'stream',
      final: 'off',
    })[value];

  const handlers = createTelegramCommandHandlers(deps);
  const handled = await handlers.handleTelegramCommand({
    chatJid: 'telegram:1',
    chatName: 'Chat',
    content: '/delivery progress',
  });

  assert.equal(handled, true);
  assert.deepEqual(updates, [{ telegramDeliveryMode: 'stream' }]);
  assert.match(deps.sent[0]?.text || '', /Delivery mode set to stream/i);
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

test('handleTelegramCommand maps append delivery mode to durable stream', async () => {
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
    content: '/delivery append',
  });

  assert.equal(handled, true);
  assert.deepEqual(updates, [{ telegramDeliveryMode: 'stream' }]);
  assert.match(deps.sent[0]?.text || '', /Delivery mode set to stream/i);
});

test('handleTelegramCommand reports canonical delivery modes in help text', async () => {
  const deps = createBaseDeps() as TelegramCommandDeps & {
    sent: Array<{ chatJid: string; text: string }>;
  };
  deps.state.chatRunPreferences['telegram:1'] = {
    telegramDeliveryMode: 'partial',
  } as any;

  const handlers = createTelegramCommandHandlers(deps);
  const handled = await handlers.handleTelegramCommand({
    chatJid: 'telegram:1',
    chatName: 'Chat',
    content: '/delivery final',
  });

  assert.equal(handled, true);
  assert.match(deps.sent[0]?.text || '', /Delivery mode set to off/i);
});

test('handleTelegramCommand /title keeps persisted value consistent with confirmation text', async () => {
  const deps = createBaseDeps() as TelegramCommandDeps & {
    sent: Array<{ chatJid: string; text: string }>;
  };
  deps.updateChatRunPreferences = (chatJid, updater) => {
    const current = deps.state.chatRunPreferences[chatJid] || {};
    const next = updater({ ...current });
    if (next.sessionTitle?.trim()) {
      next.sessionTitle = next.sessionTitle.trim().slice(0, 120);
    } else {
      delete next.sessionTitle;
    }
    deps.state.chatRunPreferences[chatJid] = next;
  };

  const longTitle = 'x'.repeat(140);
  const handlers = createTelegramCommandHandlers(deps);
  const setHandled = await handlers.handleTelegramCommand({
    chatJid: 'telegram:1',
    chatName: 'Chat',
    content: `/title ${longTitle}`,
  });

  assert.equal(setHandled, true);
  const confirmation = deps.sent[0]?.text || '';
  assert.match(confirmation, /^Session title set: /);
  const echoedTitle = confirmation.replace(/^Session title set: /, '');
  assert.equal(
    deps.state.chatRunPreferences['telegram:1']?.sessionTitle,
    echoedTitle,
  );
  assert.ok(echoedTitle.length <= 120);

  const showHandled = await handlers.handleTelegramCommand({
    chatJid: 'telegram:1',
    chatName: 'Chat',
    content: '/title',
  });

  assert.equal(showHandled, true);
  assert.equal(deps.sent[1]?.text, `Session title: ${echoedTitle}`);
});

test('handleTelegramCommand rejects invalid /model provider/model overrides', async () => {
  const deps = createBaseDeps() as TelegramCommandDeps & {
    sent: Array<{ chatJid: string; text: string }>;
    audits: Array<{
      chatJid: string;
      command: string;
      allowed: boolean;
      reason: string;
    }>;
  };
  deps.validateProviderModelRef = (provider, model) => ({
    ok: false,
    text: `Model "${provider}/${model}" is unavailable. Use /models or /model picker.`,
  });
  deps.updateChatRunPreferences = (chatJid, updater) => {
    const current = deps.state.chatRunPreferences[chatJid] || {};
    deps.state.chatRunPreferences[chatJid] = updater({ ...current });
  };

  const handlers = createTelegramCommandHandlers(deps);
  const handled = await handlers.handleTelegramCommand({
    chatJid: 'telegram:1',
    chatName: 'Chat',
    content: '/model kimi-coding/not-a-real-model',
  });

  assert.equal(handled, true);
  assert.deepEqual(deps.state.chatRunPreferences, {});
  assert.match(deps.sent[0]?.text || '', /is unavailable/i);
  assert.deepEqual(deps.audits[0], {
    chatJid: 'telegram:1',
    command: '/model',
    allowed: false,
    reason: 'invalid model override',
  });
});

test('handleTelegramCommand /model <model> resolves provider context and persists validated pair', async () => {
  const deps = createBaseDeps() as TelegramCommandDeps & {
    sent: Array<{ chatJid: string; text: string }>;
  };
  deps.getEffectiveModelLabel = () => 'minimax/MiniMax-M2.1';
  deps.validateProviderModelRef = (provider, model) =>
    provider === 'minimax' && model === 'MiniMax-M2.7'
      ? ({ ok: true } as const)
      : ({
          ok: false,
          text: `Model "${provider}/${model}" is unavailable. Use /models or /model picker.`,
        } as const);
  deps.updateChatRunPreferences = (chatJid, updater) => {
    const current = deps.state.chatRunPreferences[chatJid] || {};
    deps.state.chatRunPreferences[chatJid] = updater({ ...current });
  };

  const handlers = createTelegramCommandHandlers(deps);
  const handled = await handlers.handleTelegramCommand({
    chatJid: 'telegram:1',
    chatName: 'Chat',
    content: '/model MiniMax-M2.7',
  });

  assert.equal(handled, true);
  assert.deepEqual(deps.state.chatRunPreferences['telegram:1'], {
    provider: 'minimax',
    model: 'MiniMax-M2.7',
  });
  assert.match(deps.sent[0]?.text || '', /Model set for this chat/i);
});

test('handleTelegramSetupInput rejects invalid typed add-model-for-provider values', async () => {
  const deps = createBaseDeps() as TelegramCommandDeps & {
    sent: Array<{ chatJid: string; text: string }>;
  };
  deps.getTelegramSetupInputState = () => ({
    kind: 'add-model-for-provider',
    provider: 'minimax',
    startedAt: Date.now(),
  });
  deps.validateProviderModelRef = (provider, model) => ({
    ok: false,
    text: `Model "${provider}/${model}" is unavailable. Use /models or /model picker.`,
  });
  deps.updateChatRunPreferences = (chatJid, updater) => {
    const current = deps.state.chatRunPreferences[chatJid] || {};
    deps.state.chatRunPreferences[chatJid] = updater({ ...current });
  };

  const handlers = createTelegramCommandHandlers(deps);
  const handled = await handlers.handleTelegramSetupInput({
    chatJid: 'telegram:1',
    content: 'invalid-model',
  });

  assert.equal(handled, true);
  assert.deepEqual(deps.state.chatRunPreferences, {});
  assert.match(deps.sent[0]?.text || '', /is unavailable/i);
});

test('handleTelegramCallbackQuery rejects invalid set-model callback payloads', async () => {
  const deps = createBaseDeps() as TelegramCommandDeps & {
    sent: Array<{ chatJid: string; text: string }>;
  };
  const editedPanels: Array<{
    chatJid: string;
    messageId: number;
    panel: { kind: string };
  }> = [];
  deps.getTelegramSettingsPanelAction = () => ({
    kind: 'set-model',
    provider: 'minimax',
    model: 'not-real',
    returnTo: 'models',
  });
  deps.validateProviderModelRef = (provider, model) => ({
    ok: false,
    text: `Model "${provider}/${model}" is unavailable. Use /models or /model picker.`,
  });
  deps.editTelegramSettingsPanel = async (chatJid, messageId, panel) => {
    editedPanels.push({ chatJid, messageId, panel });
  };
  deps.updateChatRunPreferences = (chatJid, updater) => {
    const current = deps.state.chatRunPreferences[chatJid] || {};
    deps.state.chatRunPreferences[chatJid] = updater({ ...current });
  };

  const handlers = createTelegramCommandHandlers(deps);
  await handlers.handleTelegramCallbackQuery({
    id: 'cb-invalid-model',
    chatJid: 'telegram:1',
    messageId: 91,
    data: 'settings:stale',
  });

  assert.deepEqual(deps.state.chatRunPreferences, {});
  assert.equal(editedPanels.length, 1);
  assert.deepEqual(editedPanels[0]?.panel, { kind: 'show-model-providers' });
  assert.match(deps.sent[0]?.text || '', /is unavailable/i);
});

test('handleTelegramCommand /knowledge routes to host knowledge handler in main chat', async () => {
  const deps = createBaseDeps() as TelegramCommandDeps & {
    sent: Array<{ chatJid: string; text: string }>;
    audits: Array<{
      chatJid: string;
      command: string;
      allowed: boolean;
      reason: string;
    }>;
  };
  deps.isMainChat = () => true;
  deps.handleKnowledgeCommand = ({ action, input, chatJid }) =>
    `knowledge:${action}:${input}:${chatJid}`;

  const handlers = createTelegramCommandHandlers(deps);
  const handled = await handlers.handleTelegramCommand({
    chatJid: 'telegram:main',
    chatName: 'Main',
    content: '/knowledge ingest check irrigation pressure',
  });

  assert.equal(handled, true);
  assert.equal(
    deps.sent[0]?.text,
    'knowledge:ingest:check irrigation pressure:telegram:main',
  );
  assert.deepEqual(deps.audits[0], {
    chatJid: 'telegram:main',
    command: '/knowledge',
    allowed: true,
    reason: 'ingest',
  });
});

test('handleTelegramCommand routes menu-safe skill manager and librarian commands', async () => {
  const deps = createBaseDeps() as TelegramCommandDeps & {
    sent: Array<{ chatJid: string; text: string }>;
    audits: Array<{
      chatJid: string;
      command: string;
      allowed: boolean;
      reason: string;
    }>;
  };
  deps.isMainChat = () => true;
  deps.handleSkillManagerCommand = ({ action, input, chatJid }) =>
    `skill-manager:${action}:${input}:${chatJid}`;
  deps.handleLibrarianCommand = ({ action, input, chatJid }) =>
    `librarian:${action}:${input}:${chatJid}`;

  const handlers = createTelegramCommandHandlers(deps);
  const skillHandled = await handlers.handleTelegramCommand({
    chatJid: 'telegram:main',
    chatName: 'Main',
    content: '/skill_manager status',
  });
  const librarianHandled = await handlers.handleTelegramCommand({
    chatJid: 'telegram:main',
    chatName: 'Main',
    content: '/librarian capture check pump filter',
  });

  assert.equal(skillHandled, true);
  assert.equal(librarianHandled, true);
  assert.equal(deps.sent[0]?.text, 'skill-manager:status::telegram:main');
  assert.equal(
    deps.sent[1]?.text,
    'librarian:capture:check pump filter:telegram:main',
  );
  assert.deepEqual(deps.audits.slice(0, 2), [
    {
      chatJid: 'telegram:main',
      command: '/skill_manager',
      allowed: true,
      reason: 'status',
    },
    {
      chatJid: 'telegram:main',
      command: '/librarian',
      allowed: true,
      reason: 'capture',
    },
  ]);
});

test('handleTelegramCommand starts real agent runs for librarian and skill manager run actions', async () => {
  const deps = createBaseDeps() as TelegramCommandDeps & {
    sent: Array<{ chatJid: string; text: string }>;
    agentResults: Array<{
      chatJid: string;
      text: string;
      opts?: { prefixWhatsApp?: boolean };
    }>;
    runProgress: Array<{
      chatJid: string;
      requestId: string;
      phase: string;
      text: string;
      detail?: string;
    }>;
  };
  const runAgentCalls: Array<{
    group: any;
    prompt: string;
    chatJid: string;
    requestId?: string;
  }> = [];
  deps.isMainChat = () => true;
  deps.state.registeredGroups['telegram:main'] = {
    jid: 'telegram:main',
    name: 'Main',
    folder: 'main',
  };
  deps.runAgent = async (group, prompt, chatJid, _codingHint, requestId) => {
    runAgentCalls.push({ group, prompt, chatJid, requestId });
    return {
      ok: true,
      result: `agent completed: ${requestId}`,
      streamed: false,
    };
  };

  const handlers = createTelegramCommandHandlers(deps);
  const librarianHandled = await handlers.handleTelegramCommand({
    chatJid: 'telegram:main',
    chatName: 'Main',
    content: '/librarian run focus pumps',
  });
  const skillHandled = await handlers.handleTelegramCommand({
    chatJid: 'telegram:main',
    chatName: 'Main',
    content: '/skill_manager dry-run focus duplicates',
  });

  assert.equal(librarianHandled, true);
  assert.equal(skillHandled, true);
  assert.equal(runAgentCalls.length, 2);
  assert.match(runAgentCalls[0]?.prompt || '', /Manual knowledge librarian run/);
  assert.match(runAgentCalls[0]?.prompt || '', /focus pumps/);
  assert.match(runAgentCalls[1]?.prompt || '', /Manual skill manager dry-run/);
  assert.match(runAgentCalls[1]?.prompt || '', /focus duplicates/);
  assert.match(runAgentCalls[0]?.prompt || '', /run_progress/);
  assert.match(runAgentCalls[1]?.prompt || '', /run_progress/);
  assert.equal(deps.agentResults.length, 2);
  assert.match(
    deps.agentResults[0]?.text || '',
    /Librarian run complete \(librarian-/,
  );
  assert.match(
    deps.agentResults[1]?.text || '',
    /Skill manager dry-run complete \(skill-manager-/,
  );
  assert.match(deps.agentResults[0]?.text || '', /agent completed: librarian-/);
  assert.match(deps.agentResults[1]?.text || '', /agent completed: skill-manager-/);
  assert.deepEqual(
    deps.runProgress.map((event) => event.phase),
    [
      'spawn',
      'thinking',
      'finalizing',
      'completed',
      'spawn',
      'thinking',
      'finalizing',
      'completed',
    ],
  );
  assert.match(deps.runProgress[0]?.text || '', /^Librarian status:/);
  assert.match(deps.runProgress[4]?.text || '', /^Skill manager status:/);
  assert.equal(deps.activeChatRuns.size, 0);
});

test('handleTelegramCommand /new sets fresh-run flag and clears session title', async () => {
  const deps = createBaseDeps() as TelegramCommandDeps & {
    sent: Array<{ chatJid: string; text: string }>;
  };
  deps.state.chatRunPreferences['telegram:1'] = {
    sessionTitle: 'Old Session',
  };
  deps.updateChatRunPreferences = (chatJid, updater) => {
    const current = deps.state.chatRunPreferences[chatJid] || {};
    deps.state.chatRunPreferences[chatJid] = updater({ ...current });
  };

  const handlers = createTelegramCommandHandlers(deps);
  const handled = await handlers.handleTelegramCommand({
    chatJid: 'telegram:1',
    chatName: 'Chat',
    content: '/new',
  });

  assert.equal(handled, true);
  assert.equal(
    deps.state.chatRunPreferences['telegram:1']?.nextRunNoContinue,
    true,
  );
  assert.equal(
    deps.state.chatRunPreferences['telegram:1']?.sessionTitle,
    undefined,
  );
  assert.match(
    deps.sent[0]?.text || '',
    /Session title was cleared for this chat\./,
  );
});

test('handleTelegramCallbackQuery trigger-new clears session title', async () => {
  const deps = createBaseDeps() as TelegramCommandDeps;
  deps.state.chatRunPreferences['telegram:1'] = {
    sessionTitle: 'Panel Session',
  };
  deps.getTelegramSettingsPanelAction = () => ({ kind: 'trigger-new' });
  deps.updateChatRunPreferences = (chatJid, updater) => {
    const current = deps.state.chatRunPreferences[chatJid] || {};
    deps.state.chatRunPreferences[chatJid] = updater({ ...current });
  };

  const handlers = createTelegramCommandHandlers(deps);
  await handlers.handleTelegramCallbackQuery({
    id: 'cb-trigger-new',
    chatJid: 'telegram:1',
    messageId: 92,
    data: 'settings:new',
  });

  assert.equal(
    deps.state.chatRunPreferences['telegram:1']?.nextRunNoContinue,
    true,
  );
  assert.equal(
    deps.state.chatRunPreferences['telegram:1']?.sessionTitle,
    undefined,
  );
});
