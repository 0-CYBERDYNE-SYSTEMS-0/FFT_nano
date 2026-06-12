export interface TelegramCommandMessage {
  chatJid: string;
  chatName: string;
  content: string;
}

export interface TelegramSetupInputMessage {
  chatJid: string;
  content: string;
  messageId?: number;
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
  suppressUserDelivery?: boolean;
  controlPlaneStatus?: 'verification_failed';
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

type MaintenanceRunProgressPhase =
  | 'spawn'
  | 'thinking'
  | 'finalizing'
  | 'completed'
  | 'failed'
  | 'aborted';

type SetupState = {
  kind:
    | 'provider'
    | 'model'
    | 'endpoint'
    | 'api-key'
    | 'add-model-for-provider';
  startedAt?: number;
  provider?: string;
};

export interface TelegramCommandDeps {
  state: {
    telegramBot?: any | null;
    chatRunPreferences: Record<string, Record<string, any>>;
    registeredGroups: Record<string, any>;
    chatUsageStats: Record<string, unknown>;
    learningPaused: boolean;
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
  sendMessage: (chatJid: string, text: string) => Promise<boolean>;
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
  setTelegramSetupInputProvider: (chatJid: string, provider: string) => void;
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
  formatLearningDigest: () => string;
  formatHelpText: (isMainChat: boolean) => string;
  formatUsageText: (chatJid: string, scope?: 'chat' | 'all') => string;
  formatActiveSubagentsText: () => string;
  summarizeTask: (taskId: string) => string;
  formatTaskRunsText: (taskId: string, limit: number) => string;
  formatPendingTasksText: (deps: {
    registerToken: (
      taskId: string,
      groupFolder: string,
      action: 'approve' | 'reject',
    ) => string;
  }) => {
    text: string;
    keyboard: Array<Array<{ text: string; callbackData: string }>>;
  };
  handleKnowledgeCommand?: (params: {
    action: string;
    input: string;
    chatJid: string;
  }) => Promise<string> | string;
  handleSkillManagerCommand?: (params: {
    action: string;
    input: string;
    chatJid: string;
  }) => Promise<string> | string;
  handleLibrarianCommand?: (params: {
    action: string;
    input: string;
    chatJid: string;
  }) => Promise<string> | string;
  runPiListModels: (searchText: string) => { ok: boolean; text: string };
  loadPiModels: (
    forceRefresh?: boolean,
  ) =>
    | {
        ok: true;
        entries: Array<{ provider: string; model: string }>;
        warnings?: string[];
      }
    | { ok: false; text: string };
  validateProviderModelRef: (
    provider: string,
    model: string,
  ) => { ok: true; warning?: string } | { ok: false; text: string };
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
  handleLongRunCommand?: (chatJid: string, content: string) => Promise<boolean>;
  parseTelegramChatId: (chatJid: string) => string | null;
  parseTelegramTargetJid: (value: string) => string | null;
  normalizeTelegramCommandToken: (token: string) => string | null;
  promoteChatToMain: (chatJid: string, chatName: string) => void;
  refreshTelegramCommandMenus: () => Promise<void>;
  hasMainGroup: () => boolean;
  approveTelegramGroup: (
    chatJid: string,
  ) => Promise<{ ok: boolean; text: string }>;
  ignoreTelegramGroup: (
    chatJid: string,
  ) => Promise<{ ok: boolean; text: string }>;
  unignoreTelegramGroup: (
    chatJid: string,
  ) => Promise<{ ok: boolean; text: string }>;
  runGatewayServiceCommand: (action: 'status' | 'restart' | 'doctor') => {
    ok: boolean;
    text: string;
  };
  runUpdateCommand: () => {
    ok: boolean;
    text: string;
  };
  startUpdateCommand: (chatJid: string) => {
    ok: boolean;
    text: string;
    reportId?: string;
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
  registerPendingTaskToken: (
    taskId: string,
    groupFolder: string,
    action: 'approve' | 'reject',
  ) => string;
  buildAdminPanelKeyboard: () => Array<
    Array<{ text: string; callbackData: string }>
  >;
  getTaskById: (taskId: string) => unknown;
  updateTask: (taskId: string, patch: Record<string, unknown>) => void;
  deleteTask: (taskId: string) => void;
  getPendingTaskToken: (token: string) => {
    taskId: string;
    groupFolder: string;
    action: 'approve' | 'reject';
  } | null;
  recordTaskAuditEvent: (
    groupFolder: string,
    event: {
      taskId: string;
      kind: string;
      operatorJid?: string;
      attemptedByJid?: string;
      priorStatus?: string;
      newStatus?: string | null;
      promptPreview?: string;
      scheduleType?: string;
      scheduleValue?: string;
      deliveryTo?: string | null;
      deliveryMode?: string | null;
      deleteAfterRun?: boolean;
      createdBy?: 'operator' | 'agent';
      senderRole?: 'operator' | 'member' | 'unknown';
    },
  ) => void;
  emitTuiChatEvent: (payload: any) => void;
  emitTuiAgentEvent: (payload: any) => void;
  emitRunProgress: (payload: {
    chatJid: string;
    requestId: string;
    phase: MaintenanceRunProgressPhase;
    text: string;
    detail?: string;
  }) => void;
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
    config: {
      toolMode: 'read_only' | 'full';
      isSubagent: boolean;
      workspaceMode: 'ephemeral_worktree' | 'read_only';
    };
    originChatJid: string;
    originGroupFolder: string;
    taskText: string;
    timeoutSeconds: number;
    allowFanout: boolean;
    sessionContext: string;
    assistantName: string;
    sessionKey: string;
    group: any;
    workspaceRoot?: string;
    runtimePrefs?: Record<string, any>;
    abortController?: AbortController;
  }) => Promise<CodingRunResult>;
  prepareCoderTarget?: (params: {
    chatJid: string;
    mode: 'plan' | 'execute';
    taskText: string;
    requestId: string;
  }) => Promise<
    | {
        status: 'ready';
        workspaceRoot: string;
        taskText: string;
        projectLabel: string;
      }
    | { status: 'handled' }
  >;
  createCoderProject?: (params: { slug: string }) => Promise<{
    workspaceRoot: string;
    projectLabel: string;
    isGitRepo: boolean;
  }>;
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
  ) => Promise<boolean>;
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
  resumeDirectSessionTurn?: (
    chatJid: string,
    text: string,
    deliver: boolean,
  ) => Promise<{
    runId: string;
    status: 'started' | 'queued' | 'already_running';
  }>;
}

export function createTelegramCommandHandlers(deps: TelegramCommandDeps): {
  handleTelegramCallbackQuery: (
    q: TelegramCommandCallbackQuery,
  ) => Promise<void>;
  handleTelegramSetupInput: (m: TelegramSetupInputMessage) => Promise<boolean>;
  handleTelegramCommand: (m: TelegramCommandMessage) => Promise<boolean>;
} {
  function parseProviderFromModelLabel(label: string): string | null {
    const slash = label.indexOf('/');
    if (slash <= 0) return null;
    const provider = label.slice(0, slash).trim();
    return provider || null;
  }

  function resolveEffectiveProvider(chatJid: string): string | null {
    return parseProviderFromModelLabel(deps.getEffectiveModelLabel(chatJid));
  }

  function formatMaintenanceLabel(
    label: 'librarian' | 'skill-manager' | 'reflect',
  ): string {
    if (label === 'skill-manager') return 'Skill manager';
    if (label === 'reflect') return 'Reflection';
    return 'Librarian';
  }

  function formatElapsedSeconds(startedAt: number): string {
    return `${Math.max(0, Math.round((Date.now() - startedAt) / 1000))}s`;
  }

  function emitMaintenanceProgress(params: {
    chatJid: string;
    requestId: string;
    label: 'librarian' | 'skill-manager' | 'reflect';
    phase: MaintenanceRunProgressPhase;
    text: string;
    detail?: string;
  }): void {
    deps.emitRunProgress({
      chatJid: params.chatJid,
      requestId: params.requestId,
      phase: params.phase,
      text: `${formatMaintenanceLabel(params.label)} status: ${params.text}`,
      ...(params.detail ? { detail: params.detail } : {}),
    });
  }

  async function validateModelSelection(params: {
    chatJid: string;
    provider: string;
    model: string;
  }): Promise<{ ok: true } | { ok: false }> {
    const validation = deps.validateProviderModelRef(
      params.provider,
      params.model,
    );
    if (validation.ok) {
      if (validation.warning) {
        await deps.sendMessage(params.chatJid, validation.warning);
      }
      return validation;
    }
    await deps.sendMessage(params.chatJid, validation.text);
    return { ok: false };
  }

  async function sendRunTerminalMessage(params: {
    chatJid: string;
    requestId: string;
    kind: 'coder' | 'subagent';
    status: 'failed' | 'completed' | 'aborted';
    detail?: string | null;
  }): Promise<void> {
    const noun = params.kind === 'coder' ? 'Coder' : 'Subagent';
    const normalizedDetail = params.detail?.trim();
    let message = `${noun} run completed (${params.requestId}).`;
    if (params.status === 'failed') {
      message = `${noun} run failed (${params.requestId}).`;
    } else if (params.status === 'aborted') {
      message = `${noun} run aborted (${params.requestId}).`;
    }
    if (normalizedDetail) {
      message += `\n\n${normalizedDetail}`;
    }
    const sent = await deps.sendAgentResultMessage(params.chatJid, message);
    if (!sent) {
      await deps.sendMessage(params.chatJid, message);
    }
  }

  function buildLibrarianAgentPrompt(
    action: 'run' | 'dry-run',
    input: string,
  ): string {
    const dryRun = action === 'dry-run';
    return [
      dryRun
        ? 'Manual knowledge librarian dry-run. Inspect the knowledge wiki and explain exactly what you would change, but do not write files.'
        : 'Manual knowledge librarian run. Perform the knowledge curation work now.',
      '',
      'Scope:',
      '1. Read knowledge/schema/qualia-schema.md and knowledge/wiki/index.md.',
      '2. Review new captures in knowledge/raw/.',
      '3. Curate important facts, decisions, procedures, and open questions into knowledge/wiki/*.md.',
      '4. Update knowledge/wiki/progress.md with a concise summary and next action.',
      '5. Append one short entry to knowledge/wiki/log.md.',
      dryRun
        ? '6. Do not write a report file in dry-run mode; return the proposed report in chat.'
        : '6. Write a manual run report at knowledge/reports/librarian-<timestamp>.md.',
      '',
      'Rules:',
      '- Do not answer with usage text.',
      '- Keep changes concise and schema-aligned.',
      '- Preserve raw captures unless you have a clear reason to move or annotate them.',
      '- Send concise run_progress IPC updates after major phases or after roughly 30 seconds of work: {"type":"run_progress","chatJid":"<current chat jid>","requestId":"<current request_id>","text":"Librarian status: ...","phase":"thinking|tool_running|stale","detail":"..."}',
      '- Progress phases to report: schema/index loaded; raw captures reviewed; wiki updates planned/applied; report/progress/log prepared.',
      '- Final answer must include files inspected, files changed, and report path when a report is written.',
      input ? ['', 'Operator focus:', input] : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  function buildSkillManagerAgentPrompt(
    action: 'run' | 'dry-run',
    input: string,
  ): string {
    const dryRun = action === 'dry-run';
    return [
      dryRun
        ? 'Manual skill manager dry-run. Inspect the skill library and explain exactly what you would change, but do not mutate skills.'
        : 'Manual skill manager run. Perform a bounded skill library review now.',
      '',
      'Scope:',
      '1. Use skill_status first.',
      '2. Use skill_view to inspect candidate skills before judging them.',
      '3. Keep skills lean, valid, reusable, and organized for operators.',
      '4. Clean frontmatter issues for agent-created skills when running live.',
      '5. Consolidate near-duplicate agent-created skills only when clearly useful.',
      '6. Archive only agent-created skills that are stale, duplicate, or fully absorbed.',
      '',
      'Rules:',
      '- Do not answer with usage text.',
      '- Do not mutate source-owned project skills or personal override skills; report issues instead.',
      '- Send concise run_progress IPC updates after major phases or after roughly 30 seconds of work: {"type":"run_progress","chatJid":"<current chat jid>","requestId":"<current request_id>","text":"Skill manager status: ...","phase":"thinking|tool_running|stale","detail":"..."}',
      '- Progress phases to report: skill list loaded; candidate skills inspected; mutations planned/applied; report/final summary prepared.',
      dryRun
        ? '- Dry-run mode: do not call mutating skill actions such as skill_patch, skill_archive, skill_restore, skill_pin, or skill_unpin.'
        : '- Live mode: use skill actions for any skill changes and summarize each mutation.',
      '- Final answer must include skills inspected, changes made or proposed, and residual risks.',
      input ? ['', 'Operator focus:', input] : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  function buildReflectionAgentPrompt(
    action: 'run' | 'dry-run',
    input: string,
  ): string {
    const dryRun = action === 'dry-run';
    return [
      dryRun
        ? 'Operator-triggered self-reflection (dry-run). Review the recent conversation in this chat and report what — if anything — you would save as durable learning, but do not write memory or mutate any skill.'
        : 'Operator-triggered self-reflection. Review the recent conversation in this chat and save only genuinely durable, reusable learning.',
      '',
      'Being asked to reflect is permission to look — it is NOT evidence that there is anything to save. Be exactly as selective as an automatic post-turn review. If there is no durable, reusable lesson, say so plainly and change nothing; a clean no-op is the correct and expected outcome.',
      '',
      'How to classify what you find:',
      '- Durable facts, preferences, environment details, project/farm state → write to memory (MEMORY.md / memory files).',
      '- Reusable procedures, pitfalls with a reusable recovery, command sequences, troubleshooting recipes, or task-class behavior → create or patch an agent-owned runtime skill via skill_action.',
      '- Prefer patching an existing relevant agent-created skill over creating a near-duplicate. Create broad class-level skills, not narrow one-offs.',
      '- A user correction that changes how future work should be done is durable — capture it as procedural guidance.',
      '',
      'Do NOT save:',
      '- One-off task narratives, raw transcripts, or "remember that this happened" notes.',
      '- Transient or environment outages without a reusable recovery path.',
      '- Speculation or anything you are not confident is reusable.',
      '',
      'Safety:',
      '- All skill writes go through skill_action. Never edit skill files directly.',
      '- Never mutate source-owned project skills or personal override skills; report those gaps in your summary instead.',
      dryRun
        ? '- Dry-run: do not call mutating skill actions (skill_patch/skill_archive/skill_restore/skill_pin/skill_unpin) and do not write memory; describe what you would save and why.'
        : '- Live: use memory writes and skill_action for anything genuinely durable, and summarize each write with its rationale.',
      '',
      'Final answer: a concise summary of what you saved and why, or an explicit "nothing durable to save" with a one-line reason.',
      input ? ['', 'Operator focus:', input] : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  async function startMaintenanceAgentRun(params: {
    chatJid: string;
    command: string;
    label: 'librarian' | 'skill-manager' | 'reflect';
    action: 'run' | 'dry-run';
    prompt: string;
  }): Promise<void> {
    const group = deps.state.registeredGroups[params.chatJid];
    if (!group) {
      await deps.sendMessage(params.chatJid, 'Chat is not registered.');
      return;
    }
    const existingRun = deps.activeChatRuns.get(params.chatJid);
    if (existingRun) {
      deps.logTelegramCommandAudit(
        params.chatJid,
        params.command,
        false,
        `${params.label} blocked: active run`,
      );
      await deps.sendMessage(
        params.chatJid,
        `Cannot start ${params.label} while another run is active (${existingRun.requestId || 'unknown'}). Use /stop first.`,
      );
      return;
    }

    const requestId = `${params.label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const abortController = new AbortController();
    const activeRun = {
      chatJid: params.chatJid,
      startedAt: Date.now(),
      requestId,
      abortController,
    };
    deps.activeChatRuns.set(params.chatJid, activeRun);
    deps.activeChatRunsById?.set(requestId, activeRun);
    deps.emitTuiChatEvent({
      runId: requestId,
      sessionKey: deps.getSessionKeyForChat(params.chatJid),
      state: 'message',
      message: {
        role: 'system',
        content: `Starting ${params.label} ${params.action} (${requestId})...`,
      },
    });
    deps.emitTuiAgentEvent({
      runId: requestId,
      sessionKey: deps.getSessionKeyForChat(params.chatJid),
      phase: 'start',
      detail: `${params.label} ${params.action}`,
    });
    emitMaintenanceProgress({
      chatJid: params.chatJid,
      requestId,
      label: params.label,
      phase: 'spawn',
      text:
        params.label === 'skill-manager'
          ? 'Starting library review...'
          : params.label === 'reflect'
            ? 'Starting reflection on recent work...'
            : 'Starting wiki review...',
      detail: `${params.action} ${requestId}`,
    });
    await deps.setTyping(params.chatJid, true);
    try {
      emitMaintenanceProgress({
        chatJid: params.chatJid,
        requestId,
        label: params.label,
        phase: 'thinking',
        text:
          params.label === 'skill-manager'
            ? 'Agent is inspecting skills content...'
            : params.label === 'reflect'
              ? 'Agent is reviewing the recent conversation...'
              : 'Agent is inspecting wiki content...',
      });
      const run = await deps.runAgent(
        group,
        params.prompt,
        params.chatJid,
        'none',
        requestId,
        deps.state.chatRunPreferences[params.chatJid] || {},
        { dryRun: params.action === 'dry-run' },
        abortController.signal,
      );
      deps.updateChatUsage(params.chatJid, run.usage);
      const runWasAborted = !run.result && abortController.signal.aborted;
      emitMaintenanceProgress({
        chatJid: params.chatJid,
        requestId,
        label: params.label,
        phase: 'finalizing',
        text: 'Finalizing summary...',
      });
      if (!run.ok) {
        const elapsed = formatElapsedSeconds(activeRun.startedAt);
        deps.emitTuiChatEvent({
          runId: requestId,
          sessionKey: deps.getSessionKeyForChat(params.chatJid),
          state: 'error',
          errorMessage: `${params.label} run failed`,
        });
        deps.emitTuiAgentEvent({
          runId: requestId,
          sessionKey: deps.getSessionKeyForChat(params.chatJid),
          phase: 'error',
          detail: `${params.label} run failed`,
        });
        emitMaintenanceProgress({
          chatJid: params.chatJid,
          requestId,
          label: params.label,
          phase: 'failed',
          text: `${params.action} failed (${requestId}, ${elapsed}).`,
          ...(run.result ? { detail: run.result } : {}),
        });
        await deps.sendAgentResultMessage(
          params.chatJid,
          `${formatMaintenanceLabel(params.label)} ${params.action} failed (${requestId}, ${elapsed}).${run.result ? `\n\n${run.result}` : ''}`,
        );
      } else if (runWasAborted) {
        const elapsed = formatElapsedSeconds(activeRun.startedAt);
        deps.emitTuiChatEvent({
          runId: requestId,
          sessionKey: deps.getSessionKeyForChat(params.chatJid),
          state: 'aborted',
        });
        deps.emitTuiAgentEvent({
          runId: requestId,
          sessionKey: deps.getSessionKeyForChat(params.chatJid),
          phase: 'end',
          detail: 'aborted',
        });
        emitMaintenanceProgress({
          chatJid: params.chatJid,
          requestId,
          label: params.label,
          phase: 'aborted',
          text: `${params.action} aborted (${requestId}, ${elapsed}).`,
        });
        await deps.sendAgentResultMessage(
          params.chatJid,
          `${formatMaintenanceLabel(params.label)} ${params.action} aborted (${requestId}, ${elapsed}).`,
        );
      } else if (run.suppressUserDelivery) {
        emitMaintenanceProgress({
          chatJid: params.chatJid,
          requestId,
          label: params.label,
          phase: 'completed',
          text: `${params.action} complete (${requestId}, ${formatElapsedSeconds(activeRun.startedAt)}).`,
        });
        deps.emitTuiAgentEvent({
          runId: requestId,
          sessionKey: deps.getSessionKeyForChat(params.chatJid),
          phase: 'end',
          detail: 'complete',
        });
      } else if (run.result) {
        deps.persistAssistantHistory(params.chatJid, run.result, requestId);
        if (!run.streamed) {
          await deps.sendAgentResultMessage(
            params.chatJid,
            `${formatMaintenanceLabel(params.label)} ${params.action} complete (${requestId}, ${formatElapsedSeconds(activeRun.startedAt)}).\n\n${run.result}`,
          );
        } else {
          await deps.sendAgentResultMessage(
            params.chatJid,
            `${formatMaintenanceLabel(params.label)} ${params.action} complete (${requestId}, ${formatElapsedSeconds(activeRun.startedAt)}).`,
          );
        }
        emitMaintenanceProgress({
          chatJid: params.chatJid,
          requestId,
          label: params.label,
          phase: 'completed',
          text: `${params.action} complete (${requestId}, ${formatElapsedSeconds(activeRun.startedAt)}).`,
        });
        deps.emitTuiChatEvent({
          runId: requestId,
          sessionKey: deps.getSessionKeyForChat(params.chatJid),
          state: 'final',
          message: { role: 'assistant', content: run.result },
          usage: run.usage,
        });
        deps.emitTuiAgentEvent({
          runId: requestId,
          sessionKey: deps.getSessionKeyForChat(params.chatJid),
          phase: 'end',
          detail: run.streamed ? 'streamed' : 'complete',
        });
      } else {
        emitMaintenanceProgress({
          chatJid: params.chatJid,
          requestId,
          label: params.label,
          phase: 'completed',
          text: `${params.action} complete (${requestId}, ${formatElapsedSeconds(activeRun.startedAt)}).`,
        });
        await deps.sendAgentResultMessage(
          params.chatJid,
          `${formatMaintenanceLabel(params.label)} ${params.action} complete (${requestId}, ${formatElapsedSeconds(activeRun.startedAt)}) with no final text.`,
        );
      }
    } catch (err) {
      const elapsed = formatElapsedSeconds(activeRun.startedAt);
      const diagnostic = err instanceof Error ? err.message : String(err);
      emitMaintenanceProgress({
        chatJid: params.chatJid,
        requestId,
        label: params.label,
        phase: 'failed',
        text: `${params.action} failed (${requestId}, ${elapsed}).`,
        detail: diagnostic,
      });
      deps.emitTuiChatEvent({
        runId: requestId,
        sessionKey: deps.getSessionKeyForChat(params.chatJid),
        state: 'error',
        errorMessage: `${params.label} run failed`,
      });
      deps.emitTuiAgentEvent({
        runId: requestId,
        sessionKey: deps.getSessionKeyForChat(params.chatJid),
        phase: 'error',
        detail: diagnostic,
      });
      await deps.sendAgentResultMessage(
        params.chatJid,
        `${formatMaintenanceLabel(params.label)} ${params.action} failed (${requestId}, ${elapsed}).\n\n${diagnostic}`,
      );
    } finally {
      if (deps.activeChatRuns.get(params.chatJid) === activeRun) {
        deps.activeChatRuns.delete(params.chatJid);
      }
      deps.activeChatRunsById?.delete(requestId);
      await deps.setTyping(params.chatJid, false);
    }
  }

  async function startCoderRun(params: {
    chatJid: string;
    requestId: string;
    mode: 'plan' | 'execute';
    config: {
      toolMode: 'read_only' | 'full';
      isSubagent: boolean;
      workspaceMode: 'ephemeral_worktree' | 'read_only';
    };
    taskText: string;
    workspaceRoot: string;
    projectLabel: string;
  }): Promise<void> {
    const group = deps.state.registeredGroups[params.chatJid];
    if (!group) {
      await deps.sendMessage(params.chatJid, 'Chat is not registered.');
      return;
    }

    const existingRun = deps.activeChatRuns.get(params.chatJid);
    if (existingRun) {
      await deps.sendMessage(
        params.chatJid,
        `Cannot start coder while another run is active (${existingRun.requestId || 'unknown'}). Use /stop first.`,
      );
      return;
    }

    const abortController = new AbortController();
    const activeRun = {
      chatJid: params.chatJid,
      startedAt: Date.now(),
      requestId: params.requestId,
      abortController,
    };
    deps.activeChatRuns.set(params.chatJid, activeRun);
    deps.activeChatRunsById?.set(params.requestId, activeRun);
    deps.emitTuiChatEvent({
      runId: params.requestId,
      sessionKey: deps.getSessionKeyForChat(params.chatJid),
      state: 'message',
      message: {
        role: 'system',
        content: `Starting ${params.mode === 'plan' ? 'coder plan' : 'coder'} run (${params.requestId}) for ${params.projectLabel}...`,
      },
    });
    deps.emitTuiAgentEvent({
      runId: params.requestId,
      sessionKey: deps.getSessionKeyForChat(params.chatJid),
      phase: 'start',
      detail: 'running',
    });
    await deps.sendMessage(
      params.chatJid,
      params.mode === 'plan'
        ? `Starting coder plan run (${params.requestId}) for ${params.projectLabel}...`
        : `Starting coder run (${params.requestId}) for ${params.projectLabel}...`,
    );
    await deps.setTyping(params.chatJid, true);
    try {
      const run = deps.runCodingTask
        ? await deps.runCodingTask({
            requestId: params.requestId,
            mode: params.mode,
            config: params.config,
            originChatJid: params.chatJid,
            originGroupFolder: group.folder,
            taskText: params.taskText,
            timeoutSeconds: 1800,
            allowFanout: params.mode === 'execute',
            sessionContext: `[APPROVED CODER ${params.mode.toUpperCase()} REQUEST]\n${params.taskText}`,
            assistantName: deps.constants.assistantName,
            sessionKey: deps.getSessionKeyForChat(params.chatJid),
            group,
            workspaceRoot: params.workspaceRoot,
            runtimePrefs: deps.state.chatRunPreferences[params.chatJid] || {},
            abortController,
          })
        : await deps.runAgent(
            group,
            `[APPROVED CODER ${params.mode.toUpperCase()} REQUEST]\n${params.taskText}`,
            params.chatJid,
            params.mode === 'plan'
              ? 'force_delegate_plan'
              : 'force_delegate_execute',
            params.requestId,
            deps.state.chatRunPreferences[params.chatJid] || {},
            {},
            abortController.signal,
          );
      deps.updateChatUsage(params.chatJid, run.usage);
      const runWasAborted = !run.result && abortController.signal.aborted;
      if (!run.ok) {
        deps.emitTuiChatEvent({
          runId: params.requestId,
          sessionKey: deps.getSessionKeyForChat(params.chatJid),
          state: 'error',
          errorMessage: 'Coder run failed',
        });
        deps.emitTuiAgentEvent({
          runId: params.requestId,
          sessionKey: deps.getSessionKeyForChat(params.chatJid),
          phase: 'error',
          detail: 'coder run failed',
        });
        await sendRunTerminalMessage({
          chatJid: params.chatJid,
          requestId: params.requestId,
          kind: 'coder',
          status: 'failed',
          detail: run.result,
        });
      } else if (runWasAborted) {
        deps.emitTuiChatEvent({
          runId: params.requestId,
          sessionKey: deps.getSessionKeyForChat(params.chatJid),
          state: 'aborted',
        });
        deps.emitTuiAgentEvent({
          runId: params.requestId,
          sessionKey: deps.getSessionKeyForChat(params.chatJid),
          phase: 'end',
          detail: 'aborted',
        });
        await sendRunTerminalMessage({
          chatJid: params.chatJid,
          requestId: params.requestId,
          kind: 'coder',
          status: 'aborted',
        });
      } else if (run.suppressUserDelivery) {
        deps.emitTuiAgentEvent({
          runId: params.requestId,
          sessionKey: deps.getSessionKeyForChat(params.chatJid),
          phase: 'end',
          detail: 'complete',
        });
      } else if (run.result) {
        deps.persistAssistantHistory(
          params.chatJid,
          run.result,
          params.requestId,
        );
        if (!run.streamed) {
          await deps.sendAgentResultMessage(params.chatJid, run.result);
        }
        deps.emitTuiChatEvent({
          runId: params.requestId,
          sessionKey: deps.getSessionKeyForChat(params.chatJid),
          state: 'final',
          message: { role: 'assistant', content: run.result },
          usage: run.usage,
        });
        deps.emitTuiAgentEvent({
          runId: params.requestId,
          sessionKey: deps.getSessionKeyForChat(params.chatJid),
          phase: 'end',
          detail: run.streamed ? 'streamed' : 'complete',
        });
      } else {
        await sendRunTerminalMessage({
          chatJid: params.chatJid,
          requestId: params.requestId,
          kind: 'coder',
          status: 'completed',
        });
        deps.emitTuiAgentEvent({
          runId: params.requestId,
          sessionKey: deps.getSessionKeyForChat(params.chatJid),
          phase: 'end',
          detail: run.streamed ? 'streamed' : 'complete',
        });
      }
    } finally {
      if (deps.activeChatRuns.get(params.chatJid) === activeRun) {
        deps.activeChatRuns.delete(params.chatJid);
      }
      deps.activeChatRunsById?.delete(params.requestId);
      await deps.setTyping(params.chatJid, false);
    }
  }

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
        case 'coder-approve-plan':
        case 'coder-approve-execute': {
          const prepared = deps.prepareCoderTarget
            ? await deps.prepareCoderTarget({
                chatJid: q.chatJid,
                mode:
                  settingsAction.kind === 'coder-approve-plan'
                    ? 'plan'
                    : 'execute',
                taskText: settingsAction.taskText,
                requestId: `coder-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              })
            : null;
          if (prepared?.status === 'handled') return;
          if (prepared?.status !== 'ready') {
            await deps.sendMessage(
              q.chatJid,
              'Could not prepare a coding target for that request.',
            );
            return;
          }
          await startCoderRun({
            chatJid: q.chatJid,
            requestId: `coder-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            mode:
              settingsAction.kind === 'coder-approve-plan' ? 'plan' : 'execute',
            config: {
              toolMode:
                settingsAction.kind === 'coder-approve-plan'
                  ? 'read_only'
                  : 'full',
              isSubagent: false,
              workspaceMode:
                settingsAction.kind === 'coder-approve-plan'
                  ? 'read_only'
                  : 'ephemeral_worktree',
            },
            taskText: prepared.taskText,
            workspaceRoot: prepared.workspaceRoot,
            projectLabel: prepared.projectLabel,
          });
          return;
        }
        case 'coder-select-project':
          if (settingsAction.mode === 'execute' && !settingsAction.isGitRepo) {
            if (deps.state.telegramBot?.sendMessageWithKeyboard) {
              await deps.state.telegramBot.sendMessageWithKeyboard(
                q.chatJid,
                `${settingsAction.projectLabel} is not a git-backed project, so execute mode cannot create an isolated worktree there.`,
                [
                  [
                    {
                      text: 'Start Plan Instead',
                      callbackData: deps.registerTelegramSettingsPanelAction(
                        q.chatJid,
                        {
                          kind: 'coder-select-project',
                          mode: 'plan',
                          taskText: settingsAction.taskText,
                          projectPath: settingsAction.projectPath,
                          projectLabel: settingsAction.projectLabel,
                          isGitRepo: settingsAction.isGitRepo,
                        },
                      ),
                    },
                    {
                      text: 'Cancel',
                      callbackData: deps.registerTelegramSettingsPanelAction(
                        q.chatJid,
                        { kind: 'coder-cancel' },
                      ),
                    },
                  ],
                ],
              );
            } else {
              await deps.sendMessage(
                q.chatJid,
                `${settingsAction.projectLabel} is not a git-backed project, so execute mode cannot create an isolated worktree there. Use /coder-plan instead.`,
              );
            }
            return;
          }
          await startCoderRun({
            chatJid: q.chatJid,
            requestId: `coder-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            mode: settingsAction.mode,
            config: {
              toolMode: settingsAction.mode === 'plan' ? 'read_only' : 'full',
              isSubagent: false,
              workspaceMode:
                settingsAction.mode === 'plan'
                  ? 'read_only'
                  : 'ephemeral_worktree',
            },
            taskText: settingsAction.taskText,
            workspaceRoot: settingsAction.projectPath,
            projectLabel: settingsAction.projectLabel,
          });
          return;
        case 'coder-create-project': {
          if (!deps.createCoderProject) {
            await deps.sendMessage(
              q.chatJid,
              'Project creation is not available in this runtime.',
            );
            return;
          }
          const created = await deps.createCoderProject({
            slug: settingsAction.slug,
          });
          if (settingsAction.mode === 'execute') {
            await deps.sendMessage(
              q.chatJid,
              `Created ${created.projectLabel}. It is not git-backed yet, so execute mode cannot start there. Starting a coder plan instead.`,
            );
            await startCoderRun({
              chatJid: q.chatJid,
              requestId: `coder-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              mode: 'plan',
              config: {
                toolMode: 'read_only',
                isSubagent: false,
                workspaceMode: 'read_only',
              },
              taskText: settingsAction.taskText,
              workspaceRoot: created.workspaceRoot,
              projectLabel: created.projectLabel,
            });
            return;
          }
          await startCoderRun({
            chatJid: q.chatJid,
            requestId: `coder-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            mode: 'plan',
            config: {
              toolMode: 'read_only',
              isSubagent: false,
              workspaceMode: 'read_only',
            },
            taskText: settingsAction.taskText,
            workspaceRoot: created.workspaceRoot,
            projectLabel: created.projectLabel,
          });
          return;
        }
        case 'coder-cancel-resume':
          await deps.sendMessage(
            q.chatJid,
            'Coder request canceled. Continuing in the main chat flow.',
          );
          if (deps.resumeDirectSessionTurn && settingsAction.taskText) {
            deps
              .resumeDirectSessionTurn(q.chatJid, settingsAction.taskText, true)
              .catch(() => {
                // Contained - don't propagate to polling loop
              });
          }
          return;
        case 'coder-cancel':
          await deps.sendMessage(q.chatJid, 'Coder request canceled.');
          return;
        case 'show-home':
        case 'show-model-providers':
        case 'show-models-for-provider':
        case 'show-think':
        case 'show-reasoning':
        case 'show-delivery':
        case 'show-verbose':
        case 'show-queue':
        case 'show-groups':
        case 'show-subagents':
        case 'show-setup-home':
        case 'show-setup-providers':
        case 'show-setup-models':
        case 'show-setup-endpoint':
        case 'show-setup-api-key':
        case 'show-add-model-for-provider':
          await deps.editTelegramSettingsPanel(
            q.chatJid,
            q.messageId,
            settingsAction,
          );
          return;
        case 'approve-telegram-group':
        case 'ignore-telegram-group':
        case 'unignore-telegram-group': {
          if (!deps.isMainChat(q.chatJid)) {
            await deps.sendMessage(
              q.chatJid,
              `${deps.constants.assistantName}: group approval actions are only available in the main/admin chat.`,
            );
            return;
          }
          const result =
            settingsAction.kind === 'approve-telegram-group'
              ? await deps.approveTelegramGroup(settingsAction.chatJid)
              : settingsAction.kind === 'ignore-telegram-group'
                ? await deps.ignoreTelegramGroup(settingsAction.chatJid)
                : await deps.unignoreTelegramGroup(settingsAction.chatJid);
          await deps.editTelegramSettingsPanel(q.chatJid, q.messageId, {
            kind: 'show-groups',
          });
          if (!result.ok) {
            await deps.sendMessage(q.chatJid, result.text);
          }
          return;
        }
        case 'prompt-add-model-for-provider':
          await deps.editTelegramSettingsPanel(q.chatJid, q.messageId, {
            kind: 'show-add-model-for-provider',
            provider: settingsAction.provider,
          });
          await deps.promptTelegramSetupInput(
            q.chatJid,
            'add-model-for-provider',
            `Type a model name for ${settingsAction.provider}.\nExample: gpt-4.1-mini`,
          );
          deps.setTelegramSetupInputProvider(
            q.chatJid,
            settingsAction.provider,
          );
          return;
        case 'set-model':
          if (
            !(
              await validateModelSelection({
                chatJid: q.chatJid,
                provider: settingsAction.provider,
                model: settingsAction.model,
              })
            ).ok
          ) {
            await deps.editTelegramSettingsPanel(q.chatJid, q.messageId, {
              kind: 'show-model-providers',
            });
            return;
          }
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
            delete prefs.sessionTitle;
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

    // WS2.3: Handle pending task approve/reject callbacks
    // These must be checked before the generic "not panel:" return
    if (
      q.data.startsWith('task:approve:') ||
      q.data.startsWith('task:reject:')
    ) {
      // isMainChat guard - these are operator-only actions
      if (!deps.isMainChat(q.chatJid)) {
        deps.logTelegramCommandAudit(q.chatJid, q.data, false, 'non-main chat');
        await deps.sendMessage(
          q.chatJid,
          `${deps.constants.assistantName}: task approval actions are only available in the main/admin chat.`,
        );
        return;
      }

      const colonIdx = q.data.indexOf(':');
      const action = colonIdx >= 0 ? q.data.slice(0, colonIdx) : null; // 'task' or empty
      const rest = colonIdx >= 0 ? q.data.slice(colonIdx + 1) : q.data;
      const actionPartIdx = rest.indexOf(':');
      if (actionPartIdx < 0) {
        await deps.sendMessage(q.chatJid, 'Invalid task callback.');
        return;
      }
      const taskAction = rest.slice(0, actionPartIdx); // 'approve' or 'reject'
      const token = rest.slice(actionPartIdx + 1);

      if (taskAction !== 'approve' && taskAction !== 'reject') {
        await deps.sendMessage(q.chatJid, 'Invalid task callback action.');
        return;
      }

      // Look up the token to get taskId and groupFolder
      const tokenEntry = deps.getPendingTaskToken(token);
      if (!tokenEntry) {
        deps.logTelegramCommandAudit(
          q.chatJid,
          q.data,
          false,
          'token not found or expired',
        );
        await deps.sendMessage(
          q.chatJid,
          'This task approval button has expired. Run /tasks to refresh the pending list.',
        );
        return;
      }

      // Perform the action
      if (taskAction === 'approve') {
        // Flip status to 'active'
        deps.updateTask(tokenEntry.taskId, { status: 'active' });
        // Write audit line
        deps.recordTaskAuditEvent(tokenEntry.groupFolder, {
          taskId: tokenEntry.taskId,
          kind: 'approve',
          operatorJid: q.chatJid,
          priorStatus: 'pending_approval',
          newStatus: 'active',
        });
        deps.logTelegramCommandAudit(q.chatJid, q.data, true, 'task approved');
        await deps.sendMessage(
          q.chatJid,
          `Task ${tokenEntry.taskId} approved. It will run on its next scheduled time.`,
        );
      } else {
        // Reject: delete the row
        deps.deleteTask(tokenEntry.taskId);
        // Write audit line
        deps.recordTaskAuditEvent(tokenEntry.groupFolder, {
          taskId: tokenEntry.taskId,
          kind: 'reject',
          operatorJid: q.chatJid,
          priorStatus: 'pending_approval',
          newStatus: null,
        });
        deps.logTelegramCommandAudit(q.chatJid, q.data, true, 'task rejected');
        await deps.sendMessage(
          q.chatJid,
          `Task ${tokenEntry.taskId} rejected and deleted.`,
        );
      }
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
        await deps.editTelegramSettingsPanel(q.chatJid, q.messageId, {
          kind: 'show-groups',
        });
        return;
      case 'panel:pending-tasks': {
        deps.logTelegramCommandAudit(q.chatJid, q.data, true, 'ok');
        const pending = deps.formatPendingTasksText({
          registerToken: (taskId, groupFolder, action) =>
            deps.registerPendingTaskToken(taskId, groupFolder, action),
        });
        if (deps.state.telegramBot?.sendMessageWithKeyboard) {
          await deps.state.telegramBot.sendMessageWithKeyboard(
            q.chatJid,
            pending.text,
            pending.keyboard,
          );
        } else {
          await deps.sendMessage(q.chatJid, pending.text);
        }
        return;
      }
      case 'panel:health':
        deps.logTelegramCommandAudit(q.chatJid, q.data, true, 'ok');
        const healthResponse = deps.formatStatusText(q.chatJid);
        deps.emitTuiChatEvent({
          runId: `panel-health-${Date.now()}`,
          sessionKey: deps.getSessionKeyForChat(q.chatJid),
          state: 'final',
          message: { role: 'assistant', content: healthResponse },
        });
        await deps.sendMessage(q.chatJid, healthResponse);
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
        if (m.messageId && deps.state.telegramBot?.deleteMessage) {
          try {
            await deps.state.telegramBot.deleteMessage(m.chatJid, m.messageId);
          } catch {
            // Best-effort cleanup; Telegram may reject deletion by age/rights.
          }
        }
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
          `Saved API key in ${snapshot.apiKeyEnv}. The key message was removed when Telegram permissions allowed it.`,
        );
        return true;
      }
      case 'add-model-for-provider': {
        if (!pending.provider) {
          deps.clearTelegramSetupInputState(m.chatJid);
          await deps.sendMessage(
            m.chatJid,
            'Session expired. Please try again from /model.',
          );
          return true;
        }
        const provider = pending.provider;
        const modelName = content.trim();
        if (!modelName) {
          deps.clearTelegramSetupInputState(m.chatJid);
          return false;
        }
        if (
          !(
            await validateModelSelection({
              chatJid: m.chatJid,
              provider,
              model: modelName,
            })
          ).ok
        ) {
          return true;
        }
        deps.updateChatRunPreferences(m.chatJid, (prefs) => {
          prefs.provider = provider;
          prefs.model = modelName;
          return prefs;
        });
        deps.clearTelegramSetupInputState(m.chatJid);
        await deps.sendTelegramSettingsPanel(m.chatJid, {
          kind: 'show-models-for-provider',
          provider,
          page: 0,
        });
        await deps.sendMessage(
          m.chatJid,
          `Model set for this chat: ${deps.getEffectiveModelLabel(m.chatJid)}`,
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
      const responseText = chatId
        ? `Chat id: ${chatId}`
        : 'Could not parse chat id for this chat.';
      deps.emitTuiChatEvent({
        runId: `cmd-${cmd.slice(1)}-${Date.now()}`,
        sessionKey: deps.getSessionKeyForChat(m.chatJid),
        state: 'final',
        message: { role: 'assistant', content: responseText },
      });
      await deps.sendMessage(m.chatJid, responseText);
      return true;
    }

    if (cmd === '/help') {
      deps.logTelegramCommandAudit(m.chatJid, cmd, true, 'ok');
      const responseText = deps.formatHelpText(isMainGroup);
      deps.emitTuiChatEvent({
        runId: `cmd-${cmd.slice(1)}-${Date.now()}`,
        sessionKey: deps.getSessionKeyForChat(m.chatJid),
        state: 'final',
        message: { role: 'assistant', content: responseText },
      });
      await deps.sendMessage(m.chatJid, responseText);
      return true;
    }

    if (cmd === '/status') {
      deps.logTelegramCommandAudit(m.chatJid, cmd, true, 'ok');
      const responseText = deps.formatStatusText(m.chatJid);
      deps.emitTuiChatEvent({
        runId: `cmd-${cmd.slice(1)}-${Date.now()}`,
        sessionKey: deps.getSessionKeyForChat(m.chatJid),
        state: 'final',
        message: { role: 'assistant', content: responseText },
      });
      await deps.sendMessage(m.chatJid, responseText);
      return true;
    }

    if (cmd === '/title') {
      const argText = rest.join(' ').trim();
      const currentTitle = (
        deps.state.chatRunPreferences[m.chatJid]?.sessionTitle || ''
      ).trim();
      if (!argText) {
        deps.logTelegramCommandAudit(m.chatJid, cmd, true, 'show');
        await deps.sendMessage(
          m.chatJid,
          currentTitle
            ? `Session title: ${currentTitle}`
            : 'Session title is not set for this chat.',
        );
        return true;
      }

      const lowered = argText.toLowerCase();
      if (['reset', 'clear', 'default', 'off'].includes(lowered)) {
        deps.updateChatRunPreferences(m.chatJid, (prefs) => {
          delete prefs.sessionTitle;
          return prefs;
        });
        deps.logTelegramCommandAudit(m.chatJid, cmd, true, 'reset');
        await deps.sendMessage(m.chatJid, 'Session title cleared.');
        return true;
      }

      const normalized = argText.replace(/\s+/g, ' ').trim();
      const maxSessionTitleLength = 120;
      const truncationSuffix = '...';
      const bounded =
        normalized.length > maxSessionTitleLength
          ? `${normalized
              .slice(0, maxSessionTitleLength - truncationSuffix.length)
              .trimEnd()}${truncationSuffix}`
          : normalized;
      deps.updateChatRunPreferences(m.chatJid, (prefs) => {
        prefs.sessionTitle = bounded;
        return prefs;
      });
      deps.logTelegramCommandAudit(m.chatJid, cmd, true, 'set');
      await deps.sendMessage(m.chatJid, `Session title set: ${bounded}`);
      return true;
    }

    if (cmd === '/models') {
      deps.logTelegramCommandAudit(m.chatJid, cmd, true, 'ok');
      const searchText = rest.join(' ');

      if (!searchText && deps.state.telegramBot) {
        await deps.sendTelegramSettingsPanel(m.chatJid, {
          kind: 'show-model-providers',
        });
        return true;
      }

      const listed = deps.runPiListModels(searchText);
      deps.emitTuiChatEvent({
        runId: `cmd-${cmd.slice(1)}-${Date.now()}`,
        sessionKey: deps.getSessionKeyForChat(m.chatJid),
        state: 'final',
        message: { role: 'assistant', content: listed.text },
      });
      await deps.sendMessage(m.chatJid, listed.text);
      return true;
    }

    if (cmd === '/refresh-models' || cmd === '/refresh_models') {
      if (!isMainGroup) {
        deps.logTelegramCommandAudit(m.chatJid, cmd, false, 'not main');
        await deps.sendMessage(m.chatJid, 'Admin-only command.');
        return true;
      }
      deps.logTelegramCommandAudit(m.chatJid, cmd, true, 'ok');
      await deps.sendMessage(m.chatJid, 'Refreshing model list from providers...');
      const refreshed = deps.loadPiModels(true);
      if (!refreshed.ok) {
        const text = `Refresh failed: ${refreshed.text}`;
        deps.emitTuiChatEvent({
          runId: `cmd-${cmd.slice(1)}-${Date.now()}`,
          sessionKey: deps.getSessionKeyForChat(m.chatJid),
          state: 'final',
          message: { role: 'assistant', content: text },
        });
        await deps.sendMessage(m.chatJid, text);
        return true;
      }
      const total = refreshed.entries.length;
      const providerCounts = new Map<string, number>();
      for (const entry of refreshed.entries) {
        providerCounts.set(entry.provider, (providerCounts.get(entry.provider) || 0) + 1);
      }
      const providerSummary = Array.from(providerCounts.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([p, c]) => `${p}: ${c}`)
        .join(', ');
      const warningText = refreshed.warnings?.length
        ? `\nWarnings:\n${refreshed.warnings.map((w) => `- ${w}`).join('\n')}`
        : '';
      const text = `Model list refreshed. ${total} models across ${providerCounts.size} providers.\n${providerSummary}${warningText}`;
      deps.emitTuiChatEvent({
        runId: `cmd-${cmd.slice(1)}-${Date.now()}`,
        sessionKey: deps.getSessionKeyForChat(m.chatJid),
        state: 'final',
        message: { role: 'assistant', content: text },
      });
      await deps.sendMessage(m.chatJid, text);
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

      const resolvedProvider =
        nextProvider || resolveEffectiveProvider(m.chatJid);
      if (!resolvedProvider || resolvedProvider.startsWith('(')) {
        deps.logTelegramCommandAudit(
          m.chatJid,
          cmd,
          false,
          'missing provider context',
        );
        await deps.sendMessage(
          m.chatJid,
          'Please specify provider/model explicitly. Usage: /model <provider/model> or /model reset',
        );
        return true;
      }
      if (
        !(
          await validateModelSelection({
            chatJid: m.chatJid,
            provider: resolvedProvider,
            model: nextModel || '',
          })
        ).ok
      ) {
        deps.logTelegramCommandAudit(
          m.chatJid,
          cmd,
          false,
          'invalid model override',
        );
        return true;
      }
      nextProvider = resolvedProvider;

      deps.updateChatRunPreferences(m.chatJid, (prefs) => {
        if (nextProvider) prefs.provider = nextProvider;
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
        'stream';
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
              'Valid modes: stream, append, off, draft',
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
          'Unrecognized delivery mode. Valid: stream, append, off, draft',
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
        delete prefs.sessionTitle;
        return prefs;
      });
      deps.logTelegramCommandAudit(m.chatJid, cmd, true, 'ok');
      await deps.sendMessage(
        m.chatJid,
        'New session requested. The next model run will start fresh (no /continue). Session title was cleared for this chat.',
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
      cmd === '/run' ||
      cmd === '/runs' ||
      cmd === '/run-status' ||
      cmd === '/run_status' ||
      cmd === '/cancel-run' ||
      cmd === '/cancel_run'
    ) {
      const handled = await deps.handleLongRunCommand?.(m.chatJid, content);
      deps.logTelegramCommandAudit(
        m.chatJid,
        cmd,
        handled === true,
        handled ? 'long-run' : 'not configured',
      );
      if (!handled) {
        await deps.sendMessage(m.chatJid, 'Long runs are not configured.');
      }
      return true;
    }

    if (
      cmd === '/coder' ||
      cmd === '/coding' ||
      cmd === '/coder-plan' ||
      cmd === '/coder_plan' ||
      cmd === '/coder-create-project' ||
      cmd === '/coder_create_project'
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
          'Secret mismatch. Usage: /main <admin-secret>  (check TELEGRAM_ADMIN_SECRET in .env)',
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

    // WS6.2: /learning digest command - single operator surface for pause state,
    // evaluator stats, recent skips, and pending task approvals.
    if (cmd === '/learning') {
      const sub = (rest[0] || '').toLowerCase();
      // Main-chat only for all /learning commands (VAL-WS6-008)
      if (!isMainGroup) {
        deps.logTelegramCommandAudit(m.chatJid, cmd, false, 'not main/admin');
        await deps.sendMessage(
          m.chatJid,
          `${deps.constants.assistantName}: /learning is only available in the main/admin chat.`,
        );
        return true;
      }
      if (sub === 'pause' || sub === 'resume') {
        const newState = sub === 'pause';
        if (deps.state.learningPaused === newState) {
          deps.logTelegramCommandAudit(
            m.chatJid,
            cmd,
            true,
            `already ${sub}ed`,
          );
          await deps.sendMessage(
            m.chatJid,
            `Learning is already ${newState ? 'paused' : 'active'}.`,
          );
          return true;
        }
        deps.state.learningPaused = newState;
        deps.saveState?.();
        deps.logTelegramCommandAudit(m.chatJid, cmd, true, sub);
        await deps.sendMessage(
          m.chatJid,
          newState
            ? 'Learning paused. All autonomous loops will short-circuit.'
            : 'Learning resumed.',
        );
        return true;
      }
      // Digest view
      deps.logTelegramCommandAudit(m.chatJid, cmd, true, 'digest');
      await deps.sendMessage(m.chatJid, deps.formatLearningDigest());
      return true;
    }

    if (cmd === '/settings') {
      deps.logTelegramCommandAudit(m.chatJid, cmd, true, 'ok');
      await deps.sendTelegramSettingsPanel(m.chatJid, { kind: 'show-home' });
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

    if (cmd === '/reflect') {
      const first = (rest[0] || '').trim().toLowerCase();
      if (first === 'help') {
        deps.logTelegramCommandAudit(m.chatJid, cmd, true, 'help');
        await deps.sendMessage(
          m.chatJid,
          [
            'Usage: /reflect [dry-run] [focus]',
            '',
            'Runs a deliberate self-reflection on the recent conversation and saves only genuinely durable learning (memory or an agent-owned skill). It stays just as selective as an automatic review and no-ops when there is nothing reusable.',
            '- /reflect                 — reflect on recent work and save anything durable',
            '- /reflect <focus>         — focus the reflection on a topic',
            '- /reflect dry-run [focus] — report what it would save, without writing',
          ].join('\n'),
        );
        return true;
      }
      const isDryRun = first === 'dry-run' || first === 'dry';
      const action: 'run' | 'dry-run' = isDryRun ? 'dry-run' : 'run';
      if (action === 'run' && deps.state.learningPaused) {
        deps.logTelegramCommandAudit(
          m.chatJid,
          cmd,
          false,
          'blocked: learning paused',
        );
        await deps.sendMessage(
          m.chatJid,
          'Learning is paused — run /learning resume first, or use /reflect dry-run.',
        );
        return true;
      }
      const focus = (isDryRun ? rest.slice(1) : rest).join(' ').trim();
      deps.logTelegramCommandAudit(
        m.chatJid,
        cmd,
        true,
        focus ? `${action}: ${focus}` : action,
      );
      await startMaintenanceAgentRun({
        chatJid: m.chatJid,
        command: cmd,
        label: 'reflect',
        action,
        prompt: buildReflectionAgentPrompt(action, focus),
      });
      return true;
    }

    const knowledgeLibrarianAction =
      cmd === '/knowledge' &&
      ['run', 'dry-run', 'log', 'progress', 'capture'].includes(
        (rest[0] || '').trim().toLowerCase(),
      );
    if (
      cmd === '/skill-manager' ||
      cmd === '/skill_manager' ||
      cmd === '/librarian' ||
      cmd === '/curator' ||
      knowledgeLibrarianAction
    ) {
      const isSkillManager =
        cmd === '/skill-manager' || cmd === '/skill_manager';
      const isLibrarian = cmd === '/librarian' || knowledgeLibrarianAction;
      const isDeprecatedCurator = cmd === '/curator';

      if (!isMainGroup) {
        deps.logTelegramCommandAudit(m.chatJid, cmd, false, 'not main/admin');
        await deps.sendMessage(
          m.chatJid,
          `${deps.constants.assistantName}: ${isLibrarian ? 'librarian' : 'skill-manager'} controls are only available in the main/admin chat.`,
        );
        return true;
      }

      const action = (rest[0] || 'status').trim().toLowerCase();
      const input = rest.slice(1).join(' ').trim();
      const auditAction = isDeprecatedCurator
        ? `${action} (deprecated /curator)`
        : action;
      deps.logTelegramCommandAudit(m.chatJid, cmd, true, auditAction);

      if (isDeprecatedCurator) {
        await deps.sendMessage(
          m.chatJid,
          '⚠️ /curator is deprecated. Please use /skill-manager instead.',
        );
      }

      if (
        (isSkillManager || isLibrarian) &&
        (action === 'run' || action === 'dry-run')
      ) {
        await startMaintenanceAgentRun({
          chatJid: m.chatJid,
          command: cmd,
          label: isLibrarian ? 'librarian' : 'skill-manager',
          action,
          prompt: isLibrarian
            ? buildLibrarianAgentPrompt(action, input)
            : buildSkillManagerAgentPrompt(action, input),
        });
        return true;
      }

      const handler = isSkillManager
        ? deps.handleSkillManagerCommand
        : isLibrarian
          ? deps.handleLibrarianCommand
          : deps.handleSkillManagerCommand; // curator routes to skill-manager

      if (!handler) {
        deps.logTelegramCommandAudit(m.chatJid, cmd, false, 'unavailable');
        await deps.sendMessage(
          m.chatJid,
          `${isLibrarian ? 'Librarian' : 'Skill Manager'} controls are not available in this runtime.`,
        );
        return true;
      }

      const text = await handler({
        action,
        input,
        chatJid: m.chatJid,
      });
      await deps.sendMessage(m.chatJid, text);
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
      if (sub === 'pause' || sub === 'resume' || sub === 'cancel') {
        const taskId = rest[1];
        if (!taskId) {
          await deps.sendMessage(m.chatJid, `Usage: /tasks ${sub} <taskId>`);
          return true;
        }
        if (!deps.getTaskById(taskId)) {
          await deps.sendMessage(m.chatJid, `Task not found: ${taskId}`);
          return true;
        }
        if (sub === 'pause') {
          deps.updateTask(taskId, { status: 'paused' });
          await deps.sendMessage(m.chatJid, `Paused task: ${taskId}`);
        } else if (sub === 'resume') {
          deps.updateTask(taskId, { status: 'active' });
          await deps.sendMessage(m.chatJid, `Resumed task: ${taskId}`);
        } else {
          deps.deleteTask(taskId);
          await deps.sendMessage(m.chatJid, `Canceled task: ${taskId}`);
        }
        return true;
      }
      await deps.sendMessage(
        m.chatJid,
        'Usage: /tasks [list|due|detail <taskId>|runs <taskId> [limit]|pause <taskId>|resume <taskId>|cancel <taskId>]',
      );
      return true;
    }

    if (cmd === '/knowledge') {
      if (!deps.handleKnowledgeCommand) {
        deps.logTelegramCommandAudit(
          m.chatJid,
          cmd,
          false,
          'handler unavailable',
        );
        await deps.sendMessage(
          m.chatJid,
          'Knowledge wiki subsystem is unavailable in this runtime.',
        );
        return true;
      }
      const action = (rest[0] || 'status').toLowerCase();
      const input = rest.slice(1).join(' ').trim();
      const response = await deps.handleKnowledgeCommand({
        action,
        input,
        chatJid: m.chatJid,
      });
      deps.logTelegramCommandAudit(m.chatJid, cmd, true, action);
      await deps.sendMessage(m.chatJid, response);
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
      if (!deps.isMainChat(m.chatJid)) {
        deps.logTelegramCommandAudit(m.chatJid, cmd, false, 'non-main chat');
        await deps.sendMessage(
          m.chatJid,
          `${deps.constants.assistantName}: group management is only available in the main/admin chat.`,
        );
        return true;
      }
      deps.logTelegramCommandAudit(m.chatJid, cmd, true, 'ok');
      await deps.sendTelegramSettingsPanel(m.chatJid, { kind: 'show-groups' });
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
      await deps.sendTelegramSettingsPanel(m.chatJid, { kind: 'show-home' });
      return true;
    }

    if (cmd === '/update') {
      deps.logTelegramCommandAudit(m.chatJid, cmd, true, 'update started');
      const result = deps.startUpdateCommand(m.chatJid);
      if (!result.ok) {
        deps.logTelegramCommandAudit(
          m.chatJid,
          cmd,
          false,
          'update start failed',
        );
        await deps.sendMessage(
          m.chatJid,
          `Update failed to start:\n${result.text}`,
        );
        return true;
      }
      deps.logTelegramCommandAudit(
        m.chatJid,
        cmd,
        true,
        result.reportId
          ? `update worker started ${result.reportId}`
          : 'update worker started',
      );
      await deps.sendMessage(
        m.chatJid,
        [
          'Update started.',
          'I am pulling, reinstalling dependencies, rebuilding, and restarting in the background.',
          'I will send the final result after the service comes back up.',
          result.reportId ? `Report id: ${result.reportId}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
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
                config: {
                  toolMode: 'full',
                  isSubagent: true,
                  workspaceMode: 'ephemeral_worktree',
                },
                originChatJid: m.chatJid,
                originGroupFolder: group.folder,
                taskText: task,
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
          const runWasAborted = !run.result && abortController.signal.aborted;
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
            await sendRunTerminalMessage({
              chatJid: m.chatJid,
              requestId,
              kind: 'subagent',
              status: 'failed',
              detail: run.result,
            });
          } else if (runWasAborted) {
            deps.emitTuiChatEvent({
              runId: requestId,
              sessionKey: deps.getSessionKeyForChat(m.chatJid),
              state: 'aborted',
            });
            deps.emitTuiAgentEvent({
              runId: requestId,
              sessionKey: deps.getSessionKeyForChat(m.chatJid),
              phase: 'end',
              detail: 'aborted',
            });
            await sendRunTerminalMessage({
              chatJid: m.chatJid,
              requestId,
              kind: 'subagent',
              status: 'aborted',
            });
          } else if (run.suppressUserDelivery) {
            deps.emitTuiAgentEvent({
              runId: requestId,
              sessionKey: deps.getSessionKeyForChat(m.chatJid),
              phase: 'end',
              detail: 'complete',
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
            await sendRunTerminalMessage({
              chatJid: m.chatJid,
              requestId,
              kind: 'subagent',
              status: 'completed',
            });
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
