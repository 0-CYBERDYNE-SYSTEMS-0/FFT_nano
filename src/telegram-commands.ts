export interface TelegramCommandMessage {
  chatJid: string;
  chatName: string;
  content: string;
}

export interface TelegramSetupInputMessage {
  chatJid: string;
  content: string;
}

export interface TelegramCommandCallbackQuery {
  id: string;
  chatJid: string;
  messageId: number;
  data: string;
}

type RunUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  provider?: string;
  model?: string;
};

type RunResult = {
  ok: boolean;
  result: string | null;
  streamed: boolean;
  usage?: RunUsage;
};

type CodingRunResult = RunResult & {
  workerResult?: {
    status: 'success' | 'error' | 'aborted';
    summary: string;
    finalMessage: string;
    changedFiles: string[];
    commandsRun: string[];
    testsRun: string[];
    artifacts: string[];
    childRunIds: string[];
    startedAt: string;
    finishedAt: string;
    diffSummary?: string;
    worktreePath?: string;
    error?: string;
  };
};

type SetupState = {
  kind: 'provider' | 'model' | 'endpoint' | 'api-key';
  startedAt?: number;
};

export interface TelegramCommandDeps {
  state: {
    telegramBot?: any | null;
    chatRunPreferences: Record<string, Record<string, any>>;
    registeredGroups: Record<string, any>;
    chatUsageStats: Record<string, unknown>;
  };
  constants: {
    assistantName: string;
    mainGroupFolder: string;
    telegramAdminSecret?: string;
    telegramSettingsPanelPrefix: string;
    runtimeProviderPresetEnv: string;
  };
  activeChatRuns: Map<
    string,
    {
      chatJid: string;
      startedAt: number;
      requestId: string;
      abortController: AbortController;
    }
  >;
  activeChatRunsById?: Map<
    string,
    {
      chatJid: string;
      startedAt: number;
      requestId: string;
      abortController: AbortController;
    }
  >;
  activeCoderRuns: Map<
    string,
    {
      requestId: string;
      mode: 'plan' | 'execute';
      chatJid: string;
      groupName: string;
      startedAt: number;
      parentRequestId?: string;
      backend?: 'pi';
      route?:
        | 'coder_execute'
        | 'coder_plan'
        | 'auto_execute'
        | 'subagent_execute'
        | 'subagent_plan';
      state?: 'starting' | 'running' | 'completed' | 'failed' | 'aborted';
      worktreePath?: string;
      childRunIds?: string[];
      abortController?: AbortController;
    }
  >;
  sendMessage: (chatJid: string, text: string) => Promise<void>;
  sendTelegramSettingsPanel: (chatJid: string, panel: any) => Promise<void>;
  editTelegramSettingsPanel: (
    chatJid: string,
    messageId: number,
    panel: any,
  ) => Promise<void>;
  promptTelegramSetupInput: (
    chatJid: string,
    kind: SetupState['kind'],
    prompt: string,
  ) => Promise<void>;
  clearTelegramSetupInputState: (chatJid: string) => void;
  getTelegramSetupInputState: (chatJid: string) => SetupState | null;
  getTelegramSettingsPanelAction: (chatJid: string, data: string) => any;
  updateChatRunPreferences: (
    chatJid: string,
    updater: (prefs: Record<string, any>) => Record<string, any>,
  ) => void;
  isMainChat: (chatJid: string) => boolean;
  formatTasksText: (mode?: 'list' | 'due') => string;
  formatGroupsText: () => string;
  formatStatusText: (chatJid?: string) => string;
  formatHelpText: (isMainChat: boolean) => string;
  formatUsageText: (chatJid: string, scope?: 'chat' | 'all') => string;
  formatActiveSubagentsText: () => string;
  summarizeTask: (taskId: string) => string;
  formatTaskRunsText: (taskId: string, limit: number) => string;
  runPiListModels: (searchText: string) => { text: string };
  normalizeThinkLevel: (value: string) => string | null | undefined;
  normalizeReasoningLevel: (value: string) => string | null | undefined;
  normalizeTelegramDeliveryMode: (value: string) => string | null | undefined;
  parseQueueArgs: (value: string) => {
    reset?: boolean;
    mode?: string;
    debounceMs?: number;
    cap?: number;
    drop?: string;
  };
  parseVerboseDirective: (
    value: string,
  ) => { kind: 'invalid' | 'none' | 'cycle' } | { kind: 'set'; mode: string };
  describeVerboseMode: (mode: any) => string;
  getEffectiveVerboseMode: (mode?: any) => string;
  getEffectiveModelLabel: (chatJid: string) => string;
  resolveMainOnboardingGate: (chatJid: string) => { active: boolean };
  onboardingCommandBlockedText: () => string;
  runCompactionForChat: (
    chatJid: string,
    instructions: string,
  ) => Promise<string>;
  parseTelegramChatId: (chatJid: string) => string | null;
  parseTelegramTargetJid: (value: string) => string | null;
  normalizeTelegramCommandToken: (token: string) => string | null;
  promoteChatToMain: (chatJid: string, chatName: string) => void;
  refreshTelegramCommandMenus: () => Promise<void>;
  hasMainGroup: () => boolean;
  runGatewayServiceCommand: (action: 'status' | 'restart' | 'doctor') => {
    ok: boolean;
    text: string;
  };
  buildRuntimeProviderPresetUpdates: (
    params: any,
  ) => Record<string, string | undefined>;
  getRuntimeConfigEnv: () => Record<string, string | undefined>;
  persistRuntimeConfigUpdates: (
    updates: Record<string, string | undefined>,
  ) => void;
  resolveRuntimeConfigSnapshot: (env: Record<string, string | undefined>) => {
    providerPreset: string;
    apiKeyEnv: string;
  };
  registerTelegramSettingsPanelAction: (chatJid: string, action: any) => string;
  buildAdminPanelKeyboard: () => Array<
    Array<{ text: string; callbackData: string }>
  >;
  getTaskById: (taskId: string) => unknown;
  updateTask: (taskId: string, patch: Record<string, unknown>) => void;
  deleteTask: (taskId: string) => void;
  emitTuiChatEvent: (payload: any) => void;
  emitTuiAgentEvent: (payload: any) => void;
  getSessionKeyForChat: (chatJid: string) => string;
  runAgent: (
    group: any,
    prompt: string,
    chatJid: string,
    codingHint: any,
    requestId: any,
    runtimePrefs: Record<string, any>,
    options: Record<string, unknown>,
    abortSignal: AbortSignal,
  ) => Promise<RunResult>;
  runCodingTask?: (params: {
    requestId: string;
    parentRequestId?: string;
    mode: 'plan' | 'execute';
    route:
      | 'coder_execute'
      | 'coder_plan'
      | 'auto_execute'
      | 'subagent_execute'
      | 'subagent_plan';
    originChatJid: string;
    originGroupFolder: string;
    taskText: string;
    workspaceMode: 'ephemeral_worktree' | 'read_only';
    timeoutSeconds: number;
    allowFanout: boolean;
    sessionContext: string;
    assistantName: string;
    sessionKey: string;
    group: any;
    runtimePrefs?: Record<string, any>;
    abortController?: AbortController;
  }) => Promise<CodingRunResult>;
  setTyping: (chatJid: string, typing: boolean) => Promise<void>;
  persistAssistantHistory: (
    chatJid: string,
    text: string,
    runId?: string,
  ) => void;
  sendAgentResultMessage: (
    chatJid: string,
    text: string,
    opts?: { prefixWhatsApp?: boolean },
  ) => Promise<void>;
  updateChatUsage: (chatJid: string, usage?: RunUsage) => void;
  logTelegramCommandAudit: (
    chatJid: string,
    command: string,
    allowed: boolean,
    reason: string,
  ) => void;
  whatsappEnabled?: boolean;
  hasWhatsAppSocket?: () => boolean;
  syncGroupMetadata?: (force?: boolean) => Promise<void>;
  saveState?: () => void;
}

export function createTelegramCommandHandlers(deps: TelegramCommandDeps): {
  handleTelegramCallbackQuery: (
    q: TelegramCommandCallbackQuery,
  ) => Promise<void>;
  handleTelegramSetupInput: (m: TelegramSetupInputMessage) => Promise<boolean>;
  handleTelegramCommand: (m: TelegramCommandMessage) => Promise<boolean>;
} {
  async function handleTelegramCallbackQuery(
    q: TelegramCommandCallbackQuery,
  ): Promise<void> {
    if (!deps.state.telegramBot) return;

    try {
      await deps.state.telegramBot.answerCallbackQuery?.(q.id);
    } catch (err) {
      void err;
    }

    const settingsAction = deps.getTelegramSettingsPanelAction(
      q.chatJid,
      q.data,
    );
    if (settingsAction) {
      switch (settingsAction.kind) {
        case 'show-home':
        case 'show-model-providers':
        case 'show-models-for-provider':
        case 'show-think':
        case 'show-reasoning':
        case 'show-delivery':
        case 'show-verbose':
        case 'show-queue':
        case 'show-subagents':
        case 'show-setup-home':
        case 'show-setup-providers':
        case 'show-setup-models':
        case 'show-setup-endpoint':
        case 'show-setup-api-key':
          await deps.editTelegramSettingsPanel(
            q.chatJid,
            q.messageId,
            settingsAction,
          );
          return;
        case 'set-model':
          deps.updateChatRunPreferences(q.chatJid, (prefs) => {
            prefs.provider = settingsAction.provider;
            prefs.model = settingsAction.model;
            return prefs;
          });
          await deps.editTelegramSettingsPanel(q.chatJid, q.messageId, {
            kind: 'show-models-for-provider',
            provider: settingsAction.provider,
            page: 0,
          });
          return;
        case 'reset-model':
          deps.updateChatRunPreferences(q.chatJid, (prefs) => {
            delete prefs.provider;
            delete prefs.model;
            return prefs;
          });
          await deps.editTelegramSettingsPanel(
            q.chatJid,
            q.messageId,
            settingsAction.returnTo === 'models'
              ? { kind: 'show-model-providers' }
              : { kind: 'show-home' },
          );
          return;
        case 'set-think':
          deps.updateChatRunPreferences(q.chatJid, (prefs) => {
            if (settingsAction.value === 'off') delete prefs.thinkLevel;
            else prefs.thinkLevel = settingsAction.value;
            return prefs;
          });
          await deps.editTelegramSettingsPanel(q.chatJid, q.messageId, {
            kind: 'show-think',
          });
          return;
        case 'set-reasoning':
          deps.updateChatRunPreferences(q.chatJid, (prefs) => {
            if (settingsAction.value === 'off') {
              delete prefs.reasoningLevel;
              delete prefs.showReasoning;
            } else {
              prefs.reasoningLevel = settingsAction.value;
              prefs.showReasoning = settingsAction.value === 'stream';
            }
            return prefs;
          });
          await deps.editTelegramSettingsPanel(q.chatJid, q.messageId, {
            kind: 'show-reasoning',
          });
          return;
        case 'set-delivery':
          deps.updateChatRunPreferences(q.chatJid, (prefs) => {
            prefs.telegramDeliveryMode = settingsAction.value;
            return prefs;
          });
          await deps.editTelegramSettingsPanel(q.chatJid, q.messageId, {
            kind: 'show-delivery',
          });
          return;
        case 'set-verbose':
          deps.updateChatRunPreferences(q.chatJid, (prefs) => {
            if (settingsAction.value === 'off') delete prefs.verboseMode;
            else prefs.verboseMode = settingsAction.value;
            return prefs;
          });
          await deps.editTelegramSettingsPanel(q.chatJid, q.messageId, {
            kind: 'show-verbose',
          });
          return;
        case 'set-queue-mode':
          deps.updateChatRunPreferences(q.chatJid, (prefs) => {
            if (settingsAction.value === 'collect') delete prefs.queueMode;
            else prefs.queueMode = settingsAction.value;
            return prefs;
          });
          await deps.editTelegramSettingsPanel(q.chatJid, q.messageId, {
            kind: 'show-queue',
          });
          return;
        case 'stop-subagents':
          if (!deps.isMainChat(q.chatJid)) {
            await deps.sendMessage(
              q.chatJid,
              `${deps.constants.assistantName}: subagent controls are only available in the main/admin chat.`,
            );
            return;
          }
          if (settingsAction.target === 'all') {
            for (const run of deps.activeCoderRuns.values()) {
              run.abortController?.abort(
                new Error('Stopped via Telegram panel (all)'),
              );
            }
          } else {
            const run = Array.from(deps.activeCoderRuns.values())
              .filter((entry) => entry.chatJid === q.chatJid)
              .sort((a, b) => b.startedAt - a.startedAt)[0];
            if (run) {
              run.abortController?.abort(
                new Error('Stopped via Telegram panel (current)'),
              );
            }
          }
          await deps.editTelegramSettingsPanel(q.chatJid, q.messageId, {
            kind: 'show-subagents',
          });
          return;
        case 'trigger-new':
          deps.updateChatRunPreferences(q.chatJid, (prefs) => {
            prefs.nextRunNoContinue = true;
            return prefs;
          });
          await deps.editTelegramSettingsPanel(q.chatJid, q.messageId, {
            kind: 'show-home',
          });
          return;
        case 'set-setup-provider':
          deps.persistRuntimeConfigUpdates(
            deps.buildRuntimeProviderPresetUpdates({
              preset: settingsAction.preset,
              source: deps.getRuntimeConfigEnv(),
              applyLocalDefaults: true,
            }),
          );
          deps.clearTelegramSetupInputState(q.chatJid);
          await deps.editTelegramSettingsPanel(q.chatJid, q.messageId, {
            kind: 'show-setup-models',
            preset: settingsAction.preset,
            page: 0,
          });
          return;
        case 'set-setup-model':
          deps.persistRuntimeConfigUpdates(
            deps.buildRuntimeProviderPresetUpdates({
              preset: settingsAction.preset,
              model: settingsAction.model,
              source: deps.getRuntimeConfigEnv(),
            }),
          );
          deps.clearTelegramSetupInputState(q.chatJid);
          await deps.editTelegramSettingsPanel(q.chatJid, q.messageId, {
            kind: 'show-setup-home',
          });
          return;
        case 'prompt-setup-provider':
          await deps.editTelegramSettingsPanel(q.chatJid, q.messageId, {
            kind: 'show-setup-home',
          });
          await deps.promptTelegramSetupInput(
            q.chatJid,
            'provider',
            'Send the raw provider id to save into PI_API. Example: minimax, kimi-coding, openai, ollama, or another pi-supported provider.',
          );
          return;
        case 'prompt-setup-model': {
          const snapshot = deps.resolveRuntimeConfigSnapshot(
            deps.getRuntimeConfigEnv(),
          );
          if (snapshot.providerPreset !== 'manual') {
            await deps.editTelegramSettingsPanel(q.chatJid, q.messageId, {
              kind: 'show-setup-models',
              preset: snapshot.providerPreset,
              page: 0,
            });
            return;
          }
          await deps.editTelegramSettingsPanel(q.chatJid, q.messageId, {
            kind: 'show-setup-home',
          });
          await deps.promptTelegramSetupInput(
            q.chatJid,
            'model',
            'Send the raw model id to save into PI_MODEL.',
          );
          return;
        }
        case 'prompt-setup-model-typed':
          await deps.editTelegramSettingsPanel(q.chatJid, q.messageId, {
            kind: 'show-setup-home',
          });
          await deps.promptTelegramSetupInput(
            q.chatJid,
            'model',
            'Send the raw model id to save into PI_MODEL.',
          );
          return;
        case 'prompt-setup-endpoint':
          await deps.editTelegramSettingsPanel(q.chatJid, q.messageId, {
            kind: 'show-setup-endpoint',
          });
          await deps.promptTelegramSetupInput(
            q.chatJid,
            'endpoint',
            'Send the openai-compatible base URL to save. Example: http://localhost:11434/v1 (Ollama) or http://127.0.0.1:1234/v1 (LM Studio)',
          );
          return;
        case 'clear-setup-endpoint':
          deps.persistRuntimeConfigUpdates({
            PI_BASE_URL: undefined,
            OPENAI_BASE_URL: undefined,
          });
          deps.clearTelegramSetupInputState(q.chatJid);
          await deps.editTelegramSettingsPanel(q.chatJid, q.messageId, {
            kind: 'show-setup-endpoint',
          });
          return;
        case 'prompt-setup-api-key':
          await deps.editTelegramSettingsPanel(q.chatJid, q.messageId, {
            kind: 'show-setup-api-key',
          });
          await deps.promptTelegramSetupInput(
            q.chatJid,
            'api-key',
            `Send the API key for ${deps.resolveRuntimeConfigSnapshot(deps.getRuntimeConfigEnv()).apiKeyEnv}.`,
          );
          return;
        case 'clear-setup-api-key': {
          const snapshot = deps.resolveRuntimeConfigSnapshot(
            deps.getRuntimeConfigEnv(),
          );
          deps.persistRuntimeConfigUpdates({ [snapshot.apiKeyEnv]: undefined });
          deps.clearTelegramSetupInputState(q.chatJid);
          await deps.editTelegramSettingsPanel(q.chatJid, q.messageId, {
            kind: 'show-setup-api-key',
          });
          return;
        }
        case 'restart-gateway': {
          await deps.sendMessage(
            q.chatJid,
            'Restarting gateway service. Expect a brief disconnect while the host restarts.',
          );
          const result = deps.runGatewayServiceCommand('restart');
          if (!result.ok) {
            await deps.sendMessage(
              q.chatJid,
              `Gateway restart failed:\n${result.text}`,
            );
          }
          return;
        }
      }
    }

    if (q.data.startsWith(deps.constants.telegramSettingsPanelPrefix)) {
      await deps.sendMessage(
        q.chatJid,
        'That panel expired. Run /model, /think, /reasoning, /verbose, /queue, or /subagents again.',
      );
      return;
    }

    if (!q.data.startsWith('panel:')) {
      return;
    }

    if (!deps.isMainChat(q.chatJid)) {
      deps.logTelegramCommandAudit(q.chatJid, q.data, false, 'non-main chat');
      await deps.sendMessage(
        q.chatJid,
        `${deps.constants.assistantName}: admin panel actions are only available in the main/admin chat.`,
      );
      return;
    }

    switch (q.data) {
      case 'panel:tasks':
        deps.logTelegramCommandAudit(q.chatJid, q.data, true, 'ok');
        await deps.sendMessage(q.chatJid, deps.formatTasksText());
        return;
      case 'panel:coder':
        deps.logTelegramCommandAudit(q.chatJid, q.data, true, 'ok');
        await deps.sendMessage(
          q.chatJid,
          [
            'Coder delegation:',
            '- /coder <task> to execute',
            '- /coding <task> as /coder alias',
            '- /coder-plan <task> for read-only plan',
            '- use coding agent',
          ].join('\n'),
        );
        return;
      case 'panel:groups':
        deps.logTelegramCommandAudit(q.chatJid, q.data, true, 'ok');
        await deps.sendMessage(q.chatJid, deps.formatGroupsText());
        return;
      case 'panel:health':
        deps.logTelegramCommandAudit(q.chatJid, q.data, true, 'ok');
        await deps.sendMessage(q.chatJid, deps.formatStatusText(q.chatJid));
        return;
      default:
        return;
    }
  }

  async function handleTelegramSetupInput(
    m: TelegramSetupInputMessage,
  ): Promise<boolean> {
    const pending = deps.getTelegramSetupInputState(m.chatJid);
    if (!pending) return false;

    const content = m.content.trim();
    if (!content || content.startsWith('/')) return false;

    switch (pending.kind) {
      case 'provider':
        deps.persistRuntimeConfigUpdates({
          [deps.constants.runtimeProviderPresetEnv]: undefined,
          PI_API: content,
        });
        deps.clearTelegramSetupInputState(m.chatJid);
        await deps.sendTelegramSettingsPanel(m.chatJid, {
          kind: 'show-setup-home',
        });
        await deps.sendMessage(
          m.chatJid,
          `Saved provider: ${content}\nUse /setup -> Model next if you need to change PI_MODEL.`,
        );
        return true;
      case 'model':
        deps.persistRuntimeConfigUpdates({ PI_MODEL: content });
        deps.clearTelegramSetupInputState(m.chatJid);
        await deps.sendTelegramSettingsPanel(m.chatJid, {
          kind: 'show-setup-home',
        });
        await deps.sendMessage(m.chatJid, `Saved model: ${content}`);
        return true;
      case 'endpoint':
        deps.persistRuntimeConfigUpdates({
          PI_BASE_URL: content,
          OPENAI_BASE_URL: content,
        });
        deps.clearTelegramSetupInputState(m.chatJid);
        await deps.sendTelegramSettingsPanel(m.chatJid, {
          kind: 'show-setup-home',
        });
        await deps.sendMessage(
          m.chatJid,
          `Saved openai-compatible endpoint: ${content}`,
        );
        return true;
      case 'api-key': {
        const snapshot = deps.resolveRuntimeConfigSnapshot(
          deps.getRuntimeConfigEnv(),
        );
        deps.persistRuntimeConfigUpdates({ [snapshot.apiKeyEnv]: content });
        deps.clearTelegramSetupInputState(m.chatJid);
        await deps.sendTelegramSettingsPanel(m.chatJid, {
          kind: 'show-setup-home',
        });
        await deps.sendMessage(
          m.chatJid,
          `Saved API key in ${snapshot.apiKeyEnv}.`,
        );
        return true;
      }
      default:
        return false;
    }
  }

  async function handleTelegramCommand(
    m: TelegramCommandMessage,
  ): Promise<boolean> {
    const content = m.content.trim();
    if (!content.startsWith('/')) return false;

    const [rawCmd, ...restTokens] = content.split(/\s+/);
    const cmd = deps.normalizeTelegramCommandToken(rawCmd);
    if (!cmd) return false;
    const colonArg = (() => {
      const atSplit = rawCmd.split('@')[0] || rawCmd;
      const colonIndex = atSplit.indexOf(':');
      if (colonIndex === -1) return null;
      const value = atSplit.slice(colonIndex + 1).trim();
      return value || null;
    })();
    const rest = colonArg ? [colonArg, ...restTokens] : restTokens;
    const isMainGroup = deps.isMainChat(m.chatJid);

    if (cmd === '/id') {
      deps.logTelegramCommandAudit(m.chatJid, cmd, true, 'ok');
      const chatId = deps.parseTelegramChatId(m.chatJid);
      await deps.sendMessage(
        m.chatJid,
        chatId
          ? `Chat id: ${chatId}`
          : 'Could not parse chat id for this chat.',
      );
      return true;
    }

    if (cmd === '/help') {
      deps.logTelegramCommandAudit(m.chatJid, cmd, true, 'ok');
      await deps.sendMessage(m.chatJid, deps.formatHelpText(isMainGroup));
      return true;
    }

    if (cmd === '/status') {
      deps.logTelegramCommandAudit(m.chatJid, cmd, true, 'ok');
      await deps.sendMessage(m.chatJid, deps.formatStatusText(m.chatJid));
      return true;
    }

    if (cmd === '/models') {
      deps.logTelegramCommandAudit(m.chatJid, cmd, true, 'ok');
      const searchText = rest.join(' ');
      const listed = deps.runPiListModels(searchText);
      if (!searchText && deps.state.telegramBot?.sendMessageWithKeyboard) {
        await deps.state.telegramBot.sendMessageWithKeyboard(
          m.chatJid,
          listed.text,
          [
            [
              {
                text: 'Open Model Picker',
                callbackData: deps.registerTelegramSettingsPanelAction(
                  m.chatJid,
                  {
                    kind: 'show-model-providers',
                  },
                ),
              },
            ],
          ],
        );
      } else {
        await deps.sendMessage(m.chatJid, listed.text);
      }
      return true;
    }

    if (cmd === '/model') {
      const argText = rest.join(' ').trim();
      if (!argText) {
        deps.logTelegramCommandAudit(m.chatJid, cmd, true, 'show');
        if (deps.state.telegramBot) {
          await deps.sendTelegramSettingsPanel(m.chatJid, {
            kind: 'show-model-providers',
          });
        } else {
          const prefs = deps.state.chatRunPreferences[m.chatJid] || {};
          const override = prefs.provider || prefs.model;
          await deps.sendMessage(
            m.chatJid,
            override
              ? `Current model override: ${deps.getEffectiveModelLabel(m.chatJid)}`
              : `Current model: ${deps.getEffectiveModelLabel(m.chatJid)}\n(no override set; using env defaults)`,
          );
        }
        return true;
      }

      const lowered = argText.toLowerCase();
      if (['reset', 'default', 'clear', 'off'].includes(lowered)) {
        deps.updateChatRunPreferences(m.chatJid, (prefs) => {
          delete prefs.provider;
          delete prefs.model;
          return prefs;
        });
        deps.logTelegramCommandAudit(m.chatJid, cmd, true, 'reset');
        await deps.sendMessage(
          m.chatJid,
          `Model override cleared. Active model: ${deps.getEffectiveModelLabel(m.chatJid)}`,
        );
        return true;
      }

      let nextProvider: string | undefined;
      let nextModel: string | undefined;
      if (argText.includes('/')) {
        const slash = argText.indexOf('/');
        const provider = argText.slice(0, slash).trim();
        const model = argText.slice(slash + 1).trim();
        if (!provider || !model) {
          deps.logTelegramCommandAudit(
            m.chatJid,
            cmd,
            false,
            'invalid model ref',
          );
          await deps.sendMessage(
            m.chatJid,
            'Usage: /model <provider/model> or /model reset',
          );
          return true;
        }
        nextProvider = provider;
        nextModel = model;
      } else {
        nextModel = argText;
      }

      deps.updateChatRunPreferences(m.chatJid, (prefs) => {
        if (nextProvider) prefs.provider = nextProvider;
        else delete prefs.provider;
        if (nextModel) prefs.model = nextModel;
        return prefs;
      });
      deps.logTelegramCommandAudit(m.chatJid, cmd, true, 'set');
      await deps.sendMessage(
        m.chatJid,
        `Model set for this chat: ${deps.getEffectiveModelLabel(m.chatJid)}`,
      );
      return true;
    }

    if (cmd === '/think' || cmd === '/thinking' || cmd === '/t') {
      const argText = rest.join(' ').trim();
      if (!argText) {
        const current =
          deps.state.chatRunPreferences[m.chatJid]?.thinkLevel || 'off';
        deps.logTelegramCommandAudit(m.chatJid, cmd, true, 'show');
        if (deps.state.telegramBot) {
          await deps.sendTelegramSettingsPanel(m.chatJid, {
            kind: 'show-think',
          });
        } else {
          await deps.sendMessage(
            m.chatJid,
            `Current thinking level: ${current}`,
          );
        }
        return true;
      }

      const normalized = deps.normalizeThinkLevel(argText);
      if (!normalized) {
        deps.logTelegramCommandAudit(
          m.chatJid,
          cmd,
          false,
          'invalid think level',
        );
        await deps.sendMessage(
          m.chatJid,
          'Unrecognized thinking level. Valid: off, minimal, low, medium, high, xhigh',
        );
        return true;
      }

      deps.updateChatRunPreferences(m.chatJid, (prefs) => {
        if (normalized === 'off') delete prefs.thinkLevel;
        else prefs.thinkLevel = normalized;
        return prefs;
      });
      deps.logTelegramCommandAudit(m.chatJid, cmd, true, 'set');
      await deps.sendMessage(
        m.chatJid,
        normalized === 'off'
          ? 'Thinking disabled for this chat.'
          : `Thinking level set to ${normalized}.`,
      );
      return true;
    }

    if (cmd === '/reasoning' || cmd === '/reason') {
      const argText = rest.join(' ').trim();
      if (!argText) {
        const current =
          deps.state.chatRunPreferences[m.chatJid]?.reasoningLevel || 'off';
        deps.logTelegramCommandAudit(m.chatJid, cmd, true, 'show');
        if (deps.state.telegramBot) {
          await deps.sendTelegramSettingsPanel(m.chatJid, {
            kind: 'show-reasoning',
          });
        } else {
          await deps.sendMessage(
            m.chatJid,
            `Current reasoning level: ${current}`,
          );
        }
        return true;
      }

      const normalized = deps.normalizeReasoningLevel(argText);
      if (!normalized) {
        deps.logTelegramCommandAudit(
          m.chatJid,
          cmd,
          false,
          'invalid reasoning level',
        );
        await deps.sendMessage(
          m.chatJid,
          'Unrecognized reasoning level. Valid: off, on, stream',
        );
        return true;
      }

      deps.updateChatRunPreferences(m.chatJid, (prefs) => {
        if (normalized === 'off') {
          delete prefs.reasoningLevel;
          delete prefs.showReasoning;
        } else {
          prefs.reasoningLevel = normalized;
          prefs.showReasoning = normalized === 'stream';
        }
        return prefs;
      });
      deps.logTelegramCommandAudit(m.chatJid, cmd, true, 'set');
      await deps.sendMessage(
        m.chatJid,
        normalized === 'off'
          ? 'Reasoning visibility disabled.'
          : normalized === 'stream'
            ? 'Reasoning stream enabled for this chat.'
            : 'Reasoning visibility enabled for this chat.',
      );
      return true;
    }

    if (cmd === '/delivery' || cmd === '/text_delivery') {
      const argText = rest.join(' ').trim();
      const current =
        deps.state.chatRunPreferences[m.chatJid]?.telegramDeliveryMode ||
        'partial';
      if (!argText) {
        deps.logTelegramCommandAudit(m.chatJid, cmd, true, 'show');
        if (deps.state.telegramBot) {
          await deps.sendTelegramSettingsPanel(m.chatJid, {
            kind: 'show-delivery',
          });
        } else {
          await deps.sendMessage(
            m.chatJid,
            [
              `Current Telegram delivery mode: ${current}`,
              'Valid modes: off, partial, block, draft, persistent',
            ].join('\n'),
          );
        }
        return true;
      }

      const normalized = deps.normalizeTelegramDeliveryMode(argText);
      if (!normalized) {
        deps.logTelegramCommandAudit(
          m.chatJid,
          cmd,
          false,
          'invalid delivery mode',
        );
        await deps.sendMessage(
          m.chatJid,
          'Unrecognized delivery mode. Valid: off, partial, block, draft, persistent',
        );
        return true;
      }

      deps.updateChatRunPreferences(m.chatJid, (prefs) => {
        prefs.telegramDeliveryMode = normalized;
        return prefs;
      });
      deps.logTelegramCommandAudit(m.chatJid, cmd, true, 'set');
      await deps.sendMessage(
        m.chatJid,
        `Delivery mode set to ${normalized} for this chat.`,
      );
      return true;
    }

    if (cmd === '/verbose' || cmd === '/v') {
      const parsed = deps.parseVerboseDirective(m.content);
      if (parsed.kind === 'invalid' || parsed.kind === 'none') {
        deps.logTelegramCommandAudit(
          m.chatJid,
          cmd,
          false,
          'invalid verbose mode',
        );
        await deps.sendMessage(
          m.chatJid,
          'Unrecognized tool progress mode. Valid: off, new, all, verbose. `/verbose` cycles modes.',
        );
        return true;
      }

      if (parsed.kind === 'cycle') {
        deps.logTelegramCommandAudit(m.chatJid, cmd, true, 'show');
        if (deps.state.telegramBot) {
          await deps.sendTelegramSettingsPanel(m.chatJid, {
            kind: 'show-verbose',
          });
        } else {
          await deps.sendMessage(
            m.chatJid,
            `Current tool progress mode: ${deps.getEffectiveVerboseMode(
              deps.state.chatRunPreferences[m.chatJid]?.verboseMode,
            )}`,
          );
        }
        return true;
      }

      const normalized = (parsed as { mode: string }).mode;
      deps.updateChatRunPreferences(m.chatJid, (prefs) => {
        if (normalized === 'off') delete prefs.verboseMode;
        else prefs.verboseMode = normalized;
        return prefs;
      });
      deps.logTelegramCommandAudit(m.chatJid, cmd, true, 'set');
      await deps.sendMessage(m.chatJid, deps.describeVerboseMode(normalized));
      return true;
    }

    if (cmd === '/new' || cmd === '/reset') {
      deps.updateChatRunPreferences(m.chatJid, (prefs) => {
        prefs.nextRunNoContinue = true;
        return prefs;
      });
      deps.logTelegramCommandAudit(m.chatJid, cmd, true, 'ok');
      await deps.sendMessage(
        m.chatJid,
        'New session requested. The next model run will start fresh (no /continue).',
      );
      return true;
    }

    if (cmd === '/stop') {
      const activeRun = deps.activeChatRuns.get(m.chatJid);
      if (!activeRun) {
        deps.logTelegramCommandAudit(m.chatJid, cmd, true, 'no active run');
        await deps.sendMessage(m.chatJid, 'No active run to stop.');
        return true;
      }
      activeRun.abortController.abort(new Error('Stopped by user via /stop'));
      deps.logTelegramCommandAudit(m.chatJid, cmd, true, 'aborted');
      await deps.sendMessage(m.chatJid, 'Stopping current run...');
      return true;
    }

    if (cmd === '/usage') {
      const arg = rest.join(' ').trim().toLowerCase();
      if (arg === 'reset' || arg === 'clear') {
        delete deps.state.chatUsageStats[m.chatJid];
        deps.saveState?.();
        deps.logTelegramCommandAudit(m.chatJid, cmd, true, 'reset');
        await deps.sendMessage(
          m.chatJid,
          'Usage counters reset for this chat.',
        );
        return true;
      }
      if (arg === 'all') {
        deps.logTelegramCommandAudit(m.chatJid, cmd, true, 'all');
        await deps.sendMessage(
          m.chatJid,
          deps.formatUsageText(m.chatJid, 'all'),
        );
        return true;
      }
      deps.logTelegramCommandAudit(m.chatJid, cmd, true, 'show');
      await deps.sendMessage(
        m.chatJid,
        deps.formatUsageText(m.chatJid, 'chat'),
      );
      return true;
    }

    if (cmd === '/queue') {
      const argText = rest.join(' ').trim();
      if (!argText) {
        const prefs = deps.state.chatRunPreferences[m.chatJid] || {};
        deps.logTelegramCommandAudit(m.chatJid, cmd, true, 'show');
        if (deps.state.telegramBot) {
          await deps.sendTelegramSettingsPanel(m.chatJid, {
            kind: 'show-queue',
          });
        } else {
          await deps.sendMessage(
            m.chatJid,
            [
              'Queue settings (this chat):',
              `- mode: ${prefs.queueMode || 'collect'}`,
              `- debounce_ms: ${prefs.queueDebounceMs || 0}`,
              `- cap: ${prefs.queueCap || 0}`,
              `- drop: ${prefs.queueDrop || 'old'}`,
              '',
              'Usage: /queue mode=<collect|interrupt|followup|steer|steer-backlog> debounce=<500ms|2s|1m> cap=<n> drop=<old|new|summarize>',
            ].join('\n'),
          );
        }
        return true;
      }

      const parsed = deps.parseQueueArgs(argText);
      if (parsed.reset) {
        deps.updateChatRunPreferences(m.chatJid, (prefs) => {
          delete prefs.queueMode;
          delete prefs.queueDebounceMs;
          delete prefs.queueCap;
          delete prefs.queueDrop;
          return prefs;
        });
        deps.logTelegramCommandAudit(m.chatJid, cmd, true, 'reset');
        await deps.sendMessage(m.chatJid, 'Queue settings reset to defaults.');
        return true;
      }

      if (
        parsed.mode === undefined &&
        parsed.debounceMs === undefined &&
        parsed.cap === undefined &&
        parsed.drop === undefined
      ) {
        deps.logTelegramCommandAudit(m.chatJid, cmd, false, 'invalid args');
        await deps.sendMessage(
          m.chatJid,
          'Invalid /queue args. Example: /queue mode=followup debounce=2s cap=20 drop=old',
        );
        return true;
      }

      deps.updateChatRunPreferences(m.chatJid, (prefs) => {
        if (parsed.mode) prefs.queueMode = parsed.mode;
        if (typeof parsed.debounceMs === 'number')
          prefs.queueDebounceMs = parsed.debounceMs;
        if (typeof parsed.cap === 'number') prefs.queueCap = parsed.cap;
        if (parsed.drop) prefs.queueDrop = parsed.drop;
        return prefs;
      });
      const prefs = deps.state.chatRunPreferences[m.chatJid] || {};
      deps.logTelegramCommandAudit(m.chatJid, cmd, true, 'set');
      await deps.sendMessage(
        m.chatJid,
        [
          'Queue settings updated:',
          `- mode: ${prefs.queueMode || 'collect'}`,
          `- debounce_ms: ${prefs.queueDebounceMs || 0}`,
          `- cap: ${prefs.queueCap || 0}`,
          `- drop: ${prefs.queueDrop || 'old'}`,
        ].join('\n'),
      );
      return true;
    }

    if (cmd === '/compact') {
      const instructions = rest.join(' ').trim();
      deps.logTelegramCommandAudit(m.chatJid, cmd, true, 'run');
      const response = await deps.runCompactionForChat(m.chatJid, instructions);
      await deps.sendMessage(m.chatJid, response);
      return true;
    }

    if (
      cmd === '/coder' ||
      cmd === '/coding' ||
      cmd === '/coder-plan' ||
      cmd === '/coder_plan'
    ) {
      if (!isMainGroup) {
        deps.logTelegramCommandAudit(m.chatJid, cmd, false, 'non-main chat');
        await deps.sendMessage(
          m.chatJid,
          `${deps.constants.assistantName}: coder delegation is only available in the main/admin chat for safety.`,
        );
        return true;
      }
      if (deps.resolveMainOnboardingGate(m.chatJid).active) {
        deps.logTelegramCommandAudit(
          m.chatJid,
          cmd,
          false,
          'blocked by onboarding gate',
        );
        await deps.sendMessage(m.chatJid, deps.onboardingCommandBlockedText());
        return true;
      }
      deps.logTelegramCommandAudit(m.chatJid, cmd, true, 'pass-through');
      return false;
    }

    if (cmd === '/main') {
      const chatId = deps.parseTelegramChatId(m.chatJid);
      if (!chatId) {
        deps.logTelegramCommandAudit(m.chatJid, cmd, false, 'invalid chat id');
        await deps.sendMessage(
          m.chatJid,
          'Could not parse chat id for this chat.',
        );
        return true;
      }
      const isDirectTelegramDm = !chatId.startsWith('-');
      const existingMain = deps.hasMainGroup();
      const alreadyMain =
        deps.state.registeredGroups[m.chatJid]?.folder ===
        deps.constants.mainGroupFolder;
      if (existingMain && !alreadyMain) {
        deps.logTelegramCommandAudit(
          m.chatJid,
          cmd,
          false,
          'main already configured',
        );
        await deps.sendMessage(
          m.chatJid,
          'Main chat is already set. If you want to change it, edit data/registered_groups.json (or delete it to re-bootstrap).',
        );
        return true;
      }
      if (
        !existingMain &&
        isDirectTelegramDm &&
        !deps.constants.telegramAdminSecret
      ) {
        deps.promoteChatToMain(
          m.chatJid,
          m.chatName || `${deps.constants.assistantName} (main)`,
        );
        await deps.refreshTelegramCommandMenus();
        deps.logTelegramCommandAudit(
          m.chatJid,
          cmd,
          true,
          'first-claim without secret',
        );
        await deps.sendMessage(
          m.chatJid,
          [
            'This chat is now the main/admin channel.',
            'Note: TELEGRAM_ADMIN_SECRET is not set yet; set it in .env and restart to lock future re-claim actions.',
          ].join('\n'),
        );
        return true;
      }
      if (!deps.constants.telegramAdminSecret) {
        deps.logTelegramCommandAudit(
          m.chatJid,
          cmd,
          false,
          'missing TELEGRAM_ADMIN_SECRET',
        );
        await deps.sendMessage(
          m.chatJid,
          'TELEGRAM_ADMIN_SECRET is not set on the host. Set it, restart, then run: /main <secret>',
        );
        return true;
      }
      const provided = rest.join(' ');
      if (!provided || provided !== deps.constants.telegramAdminSecret) {
        deps.logTelegramCommandAudit(
          m.chatJid,
          cmd,
          false,
          'invalid admin secret',
        );
        await deps.sendMessage(
          m.chatJid,
          'Unauthorized. Usage: /main <secret>',
        );
        return true;
      }
      deps.promoteChatToMain(
        m.chatJid,
        m.chatName || `${deps.constants.assistantName} (main)`,
      );
      await deps.refreshTelegramCommandMenus();
      deps.logTelegramCommandAudit(m.chatJid, cmd, true, 'ok');
      await deps.sendMessage(
        m.chatJid,
        'This chat is now the main/admin channel.',
      );
      return true;
    }

    if (!isMainGroup) {
      deps.logTelegramCommandAudit(m.chatJid, cmd, false, 'non-main chat');
      await deps.sendMessage(
        m.chatJid,
        `${deps.constants.assistantName}: this command is only available in the main/admin chat.`,
      );
      return true;
    }

    if (cmd === '/restart') {
      deps.logTelegramCommandAudit(m.chatJid, cmd, true, 'restart requested');
      await deps.sendMessage(
        m.chatJid,
        'Restarting gateway service. Expect a brief disconnect while the host restarts.',
      );
      const result = deps.runGatewayServiceCommand('restart');
      if (!result.ok) {
        await deps.sendMessage(
          m.chatJid,
          `Gateway restart failed:\n${result.text}`,
        );
      }
      return true;
    }

    if (cmd === '/gateway') {
      const actionRaw = (rest[0] || 'status').trim().toLowerCase();
      const action =
        actionRaw === 'restart'
          ? 'restart'
          : actionRaw === 'status'
            ? 'status'
            : actionRaw === 'doctor'
              ? 'doctor'
              : null;
      if (!action) {
        deps.logTelegramCommandAudit(m.chatJid, cmd, false, 'invalid action');
        await deps.sendMessage(
          m.chatJid,
          'Usage: /gateway <status|restart|doctor>',
        );
        return true;
      }
      if (action === 'restart') {
        deps.logTelegramCommandAudit(m.chatJid, cmd, true, 'restart requested');
        await deps.sendMessage(
          m.chatJid,
          'Restarting gateway service. Expect a brief disconnect while the host restarts.',
        );
        const result = deps.runGatewayServiceCommand(action);
        if (!result.ok) {
          await deps.sendMessage(
            m.chatJid,
            `Gateway restart failed:\n${result.text}`,
          );
        }
        return true;
      }
      const result = deps.runGatewayServiceCommand(action);
      deps.logTelegramCommandAudit(
        m.chatJid,
        cmd,
        result.ok,
        result.ok ? action : `${action} failed`,
      );
      await deps.sendMessage(
        m.chatJid,
        result.ok
          ? `Gateway ${action}:\n${result.text}`
          : `Gateway ${action} failed:\n${result.text}`,
      );
      return true;
    }

    if (cmd === '/setup') {
      const arg = rest.join(' ').trim().toLowerCase();
      if (arg === 'cancel') {
        deps.clearTelegramSetupInputState(m.chatJid);
        deps.logTelegramCommandAudit(m.chatJid, cmd, true, 'cancel');
        await deps.sendMessage(m.chatJid, 'Setup prompt cancelled.');
        return true;
      }
      deps.logTelegramCommandAudit(m.chatJid, cmd, true, 'panel');
      await deps.sendTelegramSettingsPanel(m.chatJid, {
        kind: 'show-setup-home',
      });
      return true;
    }

    if (cmd === '/freechat') {
      const action = (rest[0] || '').toLowerCase();
      if (!action || action === 'help') {
        deps.logTelegramCommandAudit(m.chatJid, cmd, true, 'help');
        await deps.sendMessage(
          m.chatJid,
          [
            'Free chat admin (main only):',
            '- /freechat list',
            '- /freechat add <chatId|telegram:<chatId>>',
            '- /freechat remove <chatId|telegram:<chatId>>',
          ].join('\n'),
        );
        return true;
      }
      if (action === 'list') {
        const entries = Object.entries(deps.state.chatRunPreferences)
          .filter(([, prefs]) => prefs.freeChat === true)
          .map(([jid]) => {
            const group = deps.state.registeredGroups[jid];
            const name = group?.name || '(unregistered)';
            const mainTag =
              group?.folder === deps.constants.mainGroupFolder ? ' (main)' : '';
            return `- ${jid} -> ${name}${mainTag}`;
          })
          .sort();
        deps.logTelegramCommandAudit(m.chatJid, cmd, true, 'list');
        await deps.sendMessage(
          m.chatJid,
          entries.length > 0
            ? ['Free chat enabled for:', ...entries].join('\n')
            : 'No chats currently have free chat enabled.',
        );
        return true;
      }
      if (action !== 'add' && action !== 'remove') {
        deps.logTelegramCommandAudit(m.chatJid, cmd, false, 'invalid action');
        await deps.sendMessage(
          m.chatJid,
          'Usage: /freechat add <chatId> | /freechat remove <chatId> | /freechat list',
        );
        return true;
      }
      const targetJid = deps.parseTelegramTargetJid(rest[1] || '');
      if (!targetJid) {
        deps.logTelegramCommandAudit(m.chatJid, cmd, false, 'invalid chat id');
        await deps.sendMessage(
          m.chatJid,
          'Invalid chat id. Use /id in that chat, then pass the numeric id (or telegram:<id>).',
        );
        return true;
      }
      const targetGroup = deps.state.registeredGroups[targetJid];
      if (targetGroup?.folder === deps.constants.mainGroupFolder) {
        deps.logTelegramCommandAudit(m.chatJid, cmd, false, 'target is main');
        await deps.sendMessage(
          m.chatJid,
          'Main chat already runs without trigger prefix; free chat setting is unnecessary there.',
        );
        return true;
      }
      if (action === 'add') {
        deps.updateChatRunPreferences(targetJid, (prefs) => {
          prefs.freeChat = true;
          return prefs;
        });
        deps.logTelegramCommandAudit(m.chatJid, cmd, true, 'add');
        await deps.sendMessage(
          m.chatJid,
          `Free chat enabled for ${targetJid}${targetGroup ? ` (${targetGroup.name})` : ''}.`,
        );
        return true;
      }
      deps.updateChatRunPreferences(targetJid, (prefs) => {
        delete prefs.freeChat;
        return prefs;
      });
      deps.logTelegramCommandAudit(m.chatJid, cmd, true, 'remove');
      await deps.sendMessage(
        m.chatJid,
        `Free chat disabled for ${targetJid}${targetGroup ? ` (${targetGroup.name})` : ''}.`,
      );
      return true;
    }

    if (cmd === '/tasks') {
      deps.logTelegramCommandAudit(m.chatJid, cmd, true, 'ok');
      const sub = (rest[0] || '').toLowerCase();
      if (!sub || sub === 'list') {
        await deps.sendMessage(m.chatJid, deps.formatTasksText('list'));
        return true;
      }
      if (sub === 'due') {
        await deps.sendMessage(m.chatJid, deps.formatTasksText('due'));
        return true;
      }
      if (sub === 'detail') {
        const taskId = rest[1];
        if (!taskId) {
          await deps.sendMessage(m.chatJid, 'Usage: /tasks detail <taskId>');
          return true;
        }
        await deps.sendMessage(m.chatJid, deps.summarizeTask(taskId));
        return true;
      }
      if (sub === 'runs') {
        const taskId = rest[1];
        if (!taskId) {
          await deps.sendMessage(
            m.chatJid,
            'Usage: /tasks runs <taskId> [limit]',
          );
          return true;
        }
        const limitRaw = Number.parseInt(rest[2] || '10', 10);
        await deps.sendMessage(
          m.chatJid,
          deps.formatTaskRunsText(
            taskId,
            Number.isFinite(limitRaw) ? limitRaw : 10,
          ),
        );
        return true;
      }
      await deps.sendMessage(
        m.chatJid,
        'Usage: /tasks [list|due|detail <taskId>|runs <taskId> [limit]]',
      );
      return true;
    }

    if (
      cmd === '/task_pause' ||
      cmd === '/task_resume' ||
      cmd === '/task_cancel'
    ) {
      const taskId = rest[0];
      if (!taskId) {
        deps.logTelegramCommandAudit(m.chatJid, cmd, false, 'missing task id');
        await deps.sendMessage(m.chatJid, `Usage: ${cmd} <taskId>`);
        return true;
      }
      if (!deps.getTaskById(taskId)) {
        deps.logTelegramCommandAudit(m.chatJid, cmd, false, 'task not found');
        await deps.sendMessage(m.chatJid, `Task not found: ${taskId}`);
        return true;
      }
      if (cmd === '/task_pause') {
        deps.updateTask(taskId, { status: 'paused' });
        deps.logTelegramCommandAudit(m.chatJid, cmd, true, 'ok');
        await deps.sendMessage(m.chatJid, `Paused task: ${taskId}`);
        return true;
      }
      if (cmd === '/task_resume') {
        deps.updateTask(taskId, { status: 'active' });
        deps.logTelegramCommandAudit(m.chatJid, cmd, true, 'ok');
        await deps.sendMessage(m.chatJid, `Resumed task: ${taskId}`);
        return true;
      }
      deps.deleteTask(taskId);
      deps.logTelegramCommandAudit(m.chatJid, cmd, true, 'ok');
      await deps.sendMessage(m.chatJid, `Canceled task: ${taskId}`);
      return true;
    }

    if (cmd === '/groups') {
      deps.logTelegramCommandAudit(m.chatJid, cmd, true, 'ok');
      await deps.sendMessage(m.chatJid, deps.formatGroupsText());
      return true;
    }

    if (cmd === '/reload') {
      deps.logTelegramCommandAudit(m.chatJid, cmd, true, 'ok');
      if (deps.whatsappEnabled && deps.hasWhatsAppSocket?.()) {
        await deps.syncGroupMetadata?.(true);
      }
      await deps.refreshTelegramCommandMenus();
      await deps.sendMessage(
        m.chatJid,
        'Command menus and metadata refreshed.',
      );
      return true;
    }

    if (cmd === '/panel') {
      deps.logTelegramCommandAudit(m.chatJid, cmd, true, 'ok');
      if (!deps.state.telegramBot?.sendMessageWithKeyboard) return true;
      await deps.state.telegramBot.sendMessageWithKeyboard(
        m.chatJid,
        'Admin panel:',
        deps.buildAdminPanelKeyboard(),
      );
      return true;
    }

    if (cmd === '/subagents') {
      const action = (rest[0] || 'list').toLowerCase();
      if (!rest[0] && deps.state.telegramBot) {
        deps.logTelegramCommandAudit(m.chatJid, cmd, true, 'panel');
        await deps.sendTelegramSettingsPanel(m.chatJid, {
          kind: 'show-subagents',
        });
        return true;
      }
      if (action === 'list') {
        deps.logTelegramCommandAudit(m.chatJid, cmd, true, 'list');
        await deps.sendMessage(m.chatJid, deps.formatActiveSubagentsText());
        return true;
      }
      if (action === 'stop') {
        const target = (rest[1] || 'current').toLowerCase();
        if (target === 'all') {
          for (const run of deps.activeCoderRuns.values()) {
            run.abortController?.abort(
              new Error('Stopped via /subagents stop all'),
            );
          }
          deps.logTelegramCommandAudit(m.chatJid, cmd, true, 'stop all');
          await deps.sendMessage(
            m.chatJid,
            'Stopping all active subagent runs...',
          );
          return true;
        }
        if (target === 'current') {
          const run = Array.from(deps.activeCoderRuns.values())
            .filter((entry) => entry.chatJid === m.chatJid)
            .sort((a, b) => b.startedAt - a.startedAt)[0];
          if (!run) {
            await deps.sendMessage(m.chatJid, 'No active run in this chat.');
            return true;
          }
          run.abortController?.abort(
            new Error('Stopped via /subagents stop current'),
          );
          deps.logTelegramCommandAudit(m.chatJid, cmd, true, 'stop current');
          await deps.sendMessage(m.chatJid, 'Stopping current chat run...');
          return true;
        }
        const matched = deps.activeCoderRuns.get(target);
        if (!matched) {
          await deps.sendMessage(
            m.chatJid,
            `No active subagent run found for: ${target}`,
          );
          return true;
        }
        matched.abortController?.abort(
          new Error('Stopped via /subagents stop <id>'),
        );
        deps.logTelegramCommandAudit(m.chatJid, cmd, true, 'stop id');
        await deps.sendMessage(m.chatJid, `Stopping run ${target}...`);
        return true;
      }
      if (action === 'spawn' || action === 'run' || action === 'start') {
        const task = rest.slice(1).join(' ').trim();
        if (!task) {
          await deps.sendMessage(m.chatJid, 'Usage: /subagents spawn <task>');
          return true;
        }
        const group = deps.state.registeredGroups[m.chatJid];
        if (!group) {
          await deps.sendMessage(m.chatJid, 'Chat is not registered.');
          return true;
        }
        const existingRun = deps.activeChatRuns.get(m.chatJid);
        if (existingRun) {
          deps.logTelegramCommandAudit(
            m.chatJid,
            cmd,
            false,
            'spawn blocked: active run',
          );
          await deps.sendMessage(
            m.chatJid,
            `Cannot spawn while another run is active (${existingRun.requestId || 'unknown'}). Use /stop first.`,
          );
          return true;
        }
        const requestId = `subagent-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const abortController = new AbortController();
        const activeRun = {
          chatJid: m.chatJid,
          startedAt: Date.now(),
          requestId,
          abortController,
        };
        deps.activeChatRuns.set(m.chatJid, activeRun);
        deps.activeChatRunsById?.set(requestId, activeRun);
        deps.emitTuiChatEvent({
          runId: requestId,
          sessionKey: deps.getSessionKeyForChat(m.chatJid),
          state: 'message',
          message: {
            role: 'system',
            content: `Starting subagent run (${requestId})...`,
          },
        });
        deps.emitTuiAgentEvent({
          runId: requestId,
          sessionKey: deps.getSessionKeyForChat(m.chatJid),
          phase: 'start',
          detail: 'running',
        });
        await deps.sendMessage(
          m.chatJid,
          `Starting subagent run (${requestId})...`,
        );
        await deps.setTyping(m.chatJid, true);
        try {
          const run = deps.runCodingTask
            ? await deps.runCodingTask({
                requestId,
                mode: 'execute',
                route: 'subagent_execute',
                originChatJid: m.chatJid,
                originGroupFolder: group.folder,
                taskText: task,
                workspaceMode: 'ephemeral_worktree',
                timeoutSeconds: 1800,
                allowFanout: false,
                sessionContext: `[SUBAGENT EXECUTE REQUEST]\n${task}`,
                assistantName: deps.constants.assistantName,
                sessionKey: deps.getSessionKeyForChat(m.chatJid),
                group,
                runtimePrefs: deps.state.chatRunPreferences[m.chatJid] || {},
                abortController,
              })
            : await deps.runAgent(
                group,
                `[SUBAGENT EXECUTE REQUEST]\n${task}`,
                m.chatJid,
                'force_delegate_execute',
                requestId,
                deps.state.chatRunPreferences[m.chatJid] || {},
                {},
                abortController.signal,
              );
          deps.updateChatUsage(m.chatJid, run.usage);
          if (!run.ok) {
            deps.emitTuiChatEvent({
              runId: requestId,
              sessionKey: deps.getSessionKeyForChat(m.chatJid),
              state: 'error',
              errorMessage: 'Subagent run failed',
            });
            deps.emitTuiAgentEvent({
              runId: requestId,
              sessionKey: deps.getSessionKeyForChat(m.chatJid),
              phase: 'error',
              detail: 'subagent run failed',
            });
          } else if (run.result) {
            deps.persistAssistantHistory(m.chatJid, run.result, requestId);
            if (!run.streamed) {
              await deps.sendAgentResultMessage(m.chatJid, run.result);
            }
            deps.emitTuiChatEvent({
              runId: requestId,
              sessionKey: deps.getSessionKeyForChat(m.chatJid),
              state: 'final',
              message: { role: 'assistant', content: run.result },
              usage: run.usage,
            });
            deps.emitTuiAgentEvent({
              runId: requestId,
              sessionKey: deps.getSessionKeyForChat(m.chatJid),
              phase: 'end',
              detail: run.streamed ? 'streamed' : 'complete',
            });
          } else {
            deps.emitTuiAgentEvent({
              runId: requestId,
              sessionKey: deps.getSessionKeyForChat(m.chatJid),
              phase: 'end',
              detail: run.streamed ? 'streamed' : 'complete',
            });
          }
        } finally {
          if (deps.activeChatRuns.get(m.chatJid) === activeRun) {
            deps.activeChatRuns.delete(m.chatJid);
          }
          deps.activeChatRunsById?.delete(requestId);
          await deps.setTyping(m.chatJid, false);
        }
        return true;
      }
      await deps.sendMessage(
        m.chatJid,
        'Usage: /subagents list | /subagents stop <current|all|requestId> | /subagents spawn <task>',
      );
      return true;
    }

    return false;
  }

  return {
    handleTelegramCallbackQuery,
    handleTelegramSetupInput,
    handleTelegramCommand,
  };
}
