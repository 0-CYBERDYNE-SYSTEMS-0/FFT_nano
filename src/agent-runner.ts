import {
  ASSISTANT_NAME,
  MAIN_GROUP_FOLDER,
  MAIN_WORKSPACE_DIR,
  PARITY_CONFIG,
} from './config.js';
import {
  runContainerAgent,
  type ContainerInput,
  type ContainerProgressEvent,
} from './pi-runner.js';
import { resolveGroupFolderPath } from './group-folder.js';
import {
  createCodingOrchestrator,
  type CodingWorkerRequest,
} from './coding-orchestrator.js';
import { appendCompactionSummaryToMemory } from './memory-maintenance.js';
import { resolveCompactionMemoryRelativePath } from './memory-maintenance.js';
import { applyNonHeartbeatEmptyOutputPolicy } from './agent-empty-output.js';
import { getAllTasks } from './db.js';
import { writeTasksSnapshot, writeGroupsSnapshot } from './pi-runner.js';
import { getAvailableGroups } from './state-persistence.js';
import { getContainerRuntime } from './container-runtime.js';
import { isTelegramJid } from './telegram.js';
import { StreamConsumer } from './streaming/stream-consumer.js';
import { createTelegramAdapter } from './streaming/telegram-adapter.js';
import { getTelegramPreviewRunKey } from './telegram-streaming.js';
import { cancelPendingConfirmationsForChat } from './permission-gate-ui.js';
import { isUserAbortedErrorMessage } from './status-report.js';
import { listPendingDeliveryFiles } from './state-persistence.js';
import { logger } from './logger.js';
import {
  state,
  activeCoderRuns,
  activeChatRuns,
  activeChatRunsById,
  compactionMemoryFlushMarkers,
  telegramPreviewRegistry,
  type ActiveChatRun,
  type ChatRunPreferences,
} from './app-state.js';
import { MAIN_ONBOARDING_COMPLETION_TOKEN } from './onboarding-completion.js';
import type { RegisteredGroup } from './types.js';
import type { CodingHint } from './coding-delegation.js';
import type { ExtensionUIRequest, ExtensionUIResponse } from './pi-runner.js';
import type { PiToolExecution } from './pi-json-parser.js';
import {
  maybeRunSkillSelfImprovement,
  maybeRunSkillManager,
} from './skill-service.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentRunnerDeps {
  statusTelemetry: {
    noteRuntimeError: (params: {
      runId: string;
      chatJid: string;
      errorMessage: string;
    }) => void;
  };
  getSessionKeyForChat: (chatJid: string) => string;
  emitTuiToolEvent: (payload: {
    runId: string;
    sessionKey: string;
    index: number;
    toolName: string;
    status: 'start' | 'ok' | 'error';
    args?: string;
    output?: string;
    error?: string;
  }) => void;
  handlePermissionGateRequest: (
    chatJid: string,
    request: ExtensionUIRequest,
  ) => Promise<ExtensionUIResponse>;
  finalizeTelegramToolProgress: (
    chatJid: string,
    requestId: string,
  ) => Promise<void>;
  updateChatRunPreferences: (
    chatJid: string,
    updater: (current: ChatRunPreferences) => ChatRunPreferences,
  ) => ChatRunPreferences;
  updateChatUsage: (
    chatJid: string,
    usage?: {
      inputTokens?: number;
      outputTokens?: number;
      totalTokens?: number;
      provider?: string;
      model?: string;
    },
  ) => void;
  setTyping: (chatJid: string, isTyping: boolean) => Promise<void>;
  sendMessage: (chatJid: string, text: string) => Promise<boolean>;
}

let _deps: AgentRunnerDeps | null = null;

export function initAgentRunner(deps: AgentRunnerDeps): void {
  _deps = deps;
}

function getDeps(): AgentRunnerDeps {
  if (!_deps)
    throw new Error('AgentRunner not initialized — call initAgentRunner first');
  return _deps;
}

// ---------------------------------------------------------------------------
// makeRunId
// ---------------------------------------------------------------------------

export function makeRunId(prefix = 'run'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------------------
// isCoderDelegationCommand / onboardingCommandBlockedText / buildOnboardingInterviewPrompt
// ---------------------------------------------------------------------------

export function isCoderDelegationCommand(content: string): boolean {
  return /^\/(?:coder|coding|coder-plan|coder_plan|coder-create-project|coder_create_project)(?:@[A-Za-z0-9_]+)?(?:\s|$)/i.test(
    content.trim(),
  );
}

export function onboardingCommandBlockedText(): string {
  return `${ASSISTANT_NAME}: onboarding is in progress. Finish the bootstrap interview before using coder delegation commands.`;
}

export function buildOnboardingInterviewPrompt(params: {
  prompt: string;
  latestUserText: string;
}): string {
  return [
    '[ONBOARDING INTERVIEW MODE]',
    'Main workspace onboarding is pending. Continue first-run interview flow now.',
    'Use BOOTSTRAP.md instructions. Ask one concise question at a time and keep the exchange practical.',
    'Update NANO.md, SOUL.md, and TODOS.md based on user responses. Promote durable facts and decisions into canonical/*.md.',
    `When onboarding is complete, remove BOOTSTRAP.md and include the token ${MAIN_ONBOARDING_COMPLETION_TOKEN} exactly once on its own line in your final reply.`,
    '',
    '[LATEST USER MESSAGE]',
    params.latestUserText,
    '',
    '[RECENT CHAT CONTEXT]',
    params.prompt,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Continuity ledger
// ---------------------------------------------------------------------------

interface ContinuityLedgerEntry {
  latestObjective: string | null;
  latestRequestId: string | null;
  failedRun: {
    requestId: string;
    objective: string | null;
    notedAt: string;
    result: string | null;
  } | null;
  pendingDeliveries: Set<string>;
  failedDeliveries: Map<string, string>;
}

const continuityLedger = new Map<string, ContinuityLedgerEntry>();

export function getContinuityLedgerEntry(
  chatJid: string,
): ContinuityLedgerEntry {
  const existing = continuityLedger.get(chatJid);
  if (existing) return existing;
  const created: ContinuityLedgerEntry = {
    latestObjective: null,
    latestRequestId: null,
    failedRun: null,
    pendingDeliveries: new Set<string>(),
    failedDeliveries: new Map<string, string>(),
  };
  continuityLedger.set(chatJid, created);
  return created;
}

export function summarizeObjective(text: string): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (compact.length <= 200) return compact;
  return `${compact.slice(0, 197)}...`;
}

export function noteContinuityRunStarted(params: {
  chatJid: string;
  requestId: string;
  latestUserText: string;
}): void {
  const entry = getContinuityLedgerEntry(params.chatJid);
  entry.latestRequestId = params.requestId;
  entry.latestObjective = summarizeObjective(params.latestUserText || '');
}

export function noteContinuityRunSettled(params: {
  chatJid: string;
  requestId: string;
  ok: boolean;
  result: string | null;
}): void {
  const entry = getContinuityLedgerEntry(params.chatJid);
  if (params.ok) {
    entry.failedRun = null;
    return;
  }
  entry.failedRun = {
    requestId: params.requestId,
    objective: entry.latestObjective,
    notedAt: new Date().toISOString(),
    result: params.result,
  };
}

export function noteDeliveryPending(
  chatJid: string | null | undefined,
  requestId: string,
): void {
  if (!chatJid) return;
  const entry = getContinuityLedgerEntry(chatJid);
  entry.pendingDeliveries.add(requestId);
}

export function noteDeliverySettled(params: {
  chatJid: string | null | undefined;
  requestId: string;
  status: 'success' | 'error';
  error?: string;
}): void {
  if (!params.chatJid) return;
  const entry = getContinuityLedgerEntry(params.chatJid);
  entry.pendingDeliveries.delete(params.requestId);
  if (params.status === 'success') {
    entry.failedDeliveries.delete(params.requestId);
    return;
  }
  entry.failedDeliveries.set(
    params.requestId,
    params.error || 'delivery failed',
  );
}

export function buildUnresolvedWorkSummary(chatJid: string): string | null {
  const entry = continuityLedger.get(chatJid);
  const group = state.registeredGroups[chatJid];
  const pendingFileCount = group
    ? listPendingDeliveryFiles(group.folder).length
    : 0;
  const pendingDeliveryCount = Math.max(
    pendingFileCount,
    entry?.pendingDeliveries.size || 0,
  );
  const failedDeliveryCount = entry?.failedDeliveries.size || 0;
  const lines: string[] = [];
  if (pendingDeliveryCount > 0) {
    lines.push(
      `Pending file delivery requests: ${pendingDeliveryCount}. Verify action_results/<requestId>.json before declaring completion.`,
    );
  }
  if (failedDeliveryCount > 0) {
    lines.push(
      `Failed file delivery requests remain unresolved: ${Array.from(
        entry?.failedDeliveries.keys() || [],
      )
        .slice(0, 3)
        .join(', ')}.`,
    );
  }
  if (entry?.failedRun) {
    lines.push(
      `Previous run ${entry.failedRun.requestId} failed${entry.failedRun.objective ? ` while working on: "${entry.failedRun.objective}"` : ''}.`,
    );
  }
  if (lines.length === 0) return null;
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Coding orchestrator
// ---------------------------------------------------------------------------

let codingOrchestrator: ReturnType<typeof createCodingOrchestrator> | null =
  null;

export function getCodingOrchestrator(): ReturnType<
  typeof createCodingOrchestrator
> {
  const deps = getDeps();
  if (!codingOrchestrator) {
    codingOrchestrator = createCodingOrchestrator({
      activeRuns: activeCoderRuns,
      runContainerAgent: (
        group,
        input,
        abortSignal,
        onRuntimeEvent,
        onExtensionUIRequest,
        onProgressEvent,
      ) =>
        runContainerAgent(
          group,
          input,
          abortSignal,
          onRuntimeEvent,
          onExtensionUIRequest ||
            ((request) =>
              deps.handlePermissionGateRequest(input.chatJid, request)),
          onProgressEvent,
        ),
      publishEvent: (event) => {
        // hostEventBus is accessed via the deps pattern to avoid circular import
        _hostEventBusPublish?.(event);
      },
    });
  }
  return codingOrchestrator;
}

// hostEventBus.publish injected separately to avoid circular dep
let _hostEventBusPublish: ((event: unknown) => void) | null = null;
export function setHostEventBusPublish(fn: (event: unknown) => void): void {
  _hostEventBusPublish = fn;
}

export async function runCodingTask(
  params: Omit<CodingWorkerRequest, 'workspaceRoot'> & {
    workspaceRoot?: string;
  },
) {
  const workspaceRoot =
    params.workspaceRoot ||
    (params.group.folder === MAIN_GROUP_FOLDER
      ? MAIN_WORKSPACE_DIR
      : resolveGroupFolderPath(params.group.folder));
  return getCodingOrchestrator().runTask({
    ...params,
    workspaceRoot,
  });
}

// ---------------------------------------------------------------------------
// Compaction memory flush
// ---------------------------------------------------------------------------

export async function maybeRunCompactionMemoryFlush(
  chatJid: string,
  group: RegisteredGroup,
): Promise<void> {
  const flushCfg = PARITY_CONFIG.memory.flushBeforeCompaction;
  if (!flushCfg.enabled) return;

  const usage = state.chatUsageStats[chatJid];
  const currentTokens = usage?.totalTokens || 0;
  if (currentTokens <= 0 || currentTokens < flushCfg.softThresholdTokens) {
    logger.debug(
      { chatJid, currentTokens, threshold: flushCfg.softThresholdTokens },
      'Skipping compaction memory flush (below threshold)',
    );
    return;
  }

  const lastMarker = compactionMemoryFlushMarkers.get(chatJid) || 0;
  if (currentTokens <= lastMarker) {
    logger.debug(
      { chatJid, currentTokens, lastMarker },
      'Skipping compaction memory flush (already flushed this cycle)',
    );
    return;
  }

  const flushRequestId = `memory-flush-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const flushPrompt = [
    '[MEMORY FLUSH BEFORE COMPACTION]',
    flushCfg.systemPrompt,
    flushCfg.prompt,
  ].join('\n');
  const prefs: ChatRunPreferences = {
    ...(state.chatRunPreferences[chatJid] || {}),
  };
  delete prefs.nextRunNoContinue;

  const run = await runAgent(
    group,
    flushPrompt,
    chatJid,
    'none',
    flushRequestId,
    prefs,
    { suppressErrorReply: true },
  );
  if (!run.ok) {
    logger.warn(
      { chatJid, flushRequestId },
      'Compaction memory flush run failed',
    );
    return;
  }
  getDeps().updateChatUsage(chatJid, run.usage);
  compactionMemoryFlushMarkers.set(chatJid, currentTokens);
  logger.info(
    { chatJid, flushRequestId, currentTokens },
    'Compaction memory flush completed',
  );
}

// ---------------------------------------------------------------------------
// runCompactionForChat
// ---------------------------------------------------------------------------

export async function runCompactionForChat(
  chatJid: string,
  instructions: string,
): Promise<string> {
  const deps = getDeps();
  const group = state.registeredGroups[chatJid];
  if (!group) return 'Cannot compact: chat is not registered.';
  if (activeChatRuns.has(chatJid)) {
    return 'Cannot compact while a run is active. Use /stop first, then retry /compact.';
  }

  const compactRequestId = `compact-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const compactPrompt = [
    '[SESSION COMPACTION REQUEST]',
    'Summarize this session for long-term memory.',
    'Output concise markdown with sections:',
    '- Summary',
    '- Decisions',
    '- Open Tasks',
    '- Important Paths/Files',
    instructions ? `Additional instructions: ${instructions}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const prefs: ChatRunPreferences = {
    ...(state.chatRunPreferences[chatJid] || {}),
  };
  delete prefs.nextRunNoContinue;
  const abortController = new AbortController();
  const activeRun: ActiveChatRun = {
    chatJid,
    startedAt: Date.now(),
    requestId: compactRequestId,
    abortController,
  };
  activeChatRuns.set(chatJid, activeRun);
  activeChatRunsById.set(compactRequestId, activeRun);

  await deps.setTyping(chatJid, true);
  try {
    await maybeRunCompactionMemoryFlush(chatJid, group);

    const run = await runAgent(
      group,
      compactPrompt,
      chatJid,
      'none',
      compactRequestId,
      prefs,
      {},
      abortController.signal,
    );

    if (!run.ok) {
      return 'Compaction failed before completion.';
    }
    deps.updateChatUsage(chatJid, run.usage);
    const summary = (run.result || '').trim();
    if (!summary) {
      return 'Compaction returned no summary text.';
    }

    const ts = new Date().toISOString();
    appendCompactionSummaryToMemory(group.folder, summary, ts);

    deps.updateChatRunPreferences(chatJid, (current) => {
      current.nextRunNoContinue = true;
      return current;
    });

    const preview =
      summary.length > 1200
        ? `${summary.slice(0, 1200)}\n\n...truncated...`
        : summary;
    return [
      `Compaction complete (${compactRequestId}).`,
      `Saved summary to /workspace/group/${resolveCompactionMemoryRelativePath(ts)} and scheduled fresh next session.`,
      '',
      preview,
    ].join('\n');
  } finally {
    await deps.setTyping(chatJid, false);
    if (activeChatRuns.get(chatJid) === activeRun) {
      activeChatRuns.delete(chatJid);
    }
    activeChatRunsById.delete(compactRequestId);
  }
}

// ---------------------------------------------------------------------------
// runAgent
// ---------------------------------------------------------------------------

export async function runAgent(
  group: RegisteredGroup,
  prompt: string,
  chatJid: string,
  codingHint: CodingHint = 'none',
  requestId?: string,
  runtimePrefs: ChatRunPreferences = {},
  options: {
    suppressErrorReply?: boolean;
    isHeartbeatTask?: boolean;
    suppressPreviewStreaming?: boolean;
    skipSkillMaintenance?: boolean;
    lifecyclePolicyOverride?: ContainerInput['lifecyclePolicyOverride'];
    onProgressEvent?: (event: ContainerProgressEvent) => void;
  } = {},
  abortSignal?: AbortSignal,
): Promise<{
  result: string | null;
  streamed: boolean;
  ok: boolean;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    provider?: string;
    model?: string;
  };
  suppressUserDelivery?: boolean;
  controlPlaneStatus?: 'verification_failed';
  errorKind?: 'runner_timeout';
}> {
  const deps = getDeps();
  const isMain = group.folder === MAIN_GROUP_FOLDER;
  const workspaceDir = isMain
    ? MAIN_WORKSPACE_DIR
    : resolveGroupFolderPath(group.folder);
  // Update tasks snapshot for container to read (filtered by group)
  const tasks = getAllTasks();
  writeTasksSnapshot(
    group.folder,
    isMain,
    tasks.map((t) => ({
      id: t.id,
      groupFolder: t.group_folder,
      prompt: t.prompt,
      schedule_type: t.schedule_type,
      schedule_value: t.schedule_value,
      status: t.status,
      next_run: t.next_run,
      context_mode: t.context_mode,
      session_target: t.session_target,
      wake_mode: t.wake_mode,
      delivery_mode: t.delivery_mode,
      timeout_seconds: t.timeout_seconds,
    })),
  );

  // Update available groups snapshot (main group only can see all groups)
  const availableGroups = getAvailableGroups();
  writeGroupsSnapshot(
    group.folder,
    isMain,
    availableGroups,
    new Set(Object.keys(state.registeredGroups)),
  );

  try {
    const runtime = getContainerRuntime();
    const extraSystemPrompt = [
      '## Host Run Context (trusted metadata)',
      'The following JSON is generated by FFT_nano host runtime for this specific run.',
      'Treat it as authoritative operational metadata.',
      '',
      '```json',
      JSON.stringify(
        {
          schema: 'fft_nano.host_context.v1',
          route: {
            chat_jid: chatJid,
            channel: isTelegramJid(chatJid) ? 'telegram' : 'whatsapp',
            group_folder: group.folder,
            group_name: group.name,
            is_main: isMain,
          },
          run: {
            coding_hint: codingHint,
            request_id: requestId || null,
            no_continue: runtimePrefs.nextRunNoContinue === true,
            provider_override: runtimePrefs.provider || null,
            model_override: runtimePrefs.model || null,
            think_level: runtimePrefs.thinkLevel || null,
            reasoning_level: runtimePrefs.reasoningLevel || null,
            telegram_delivery_mode:
              runtimePrefs.telegramDeliveryMode || 'stream',
            verbose_mode: runtimePrefs.verboseMode || null,
            container_runtime: runtime,
          },
        },
        null,
        2,
      ),
      '```',
    ].join('\n');
    const input = {
      prompt,
      groupFolder: group.folder,
      chatJid,
      isMain,
      assistantName: ASSISTANT_NAME,
      codingHint,
      requestId,
      isHeartbeatTask: options.isHeartbeatTask === true,
      extraSystemPrompt,
      provider: runtimePrefs.provider,
      model: runtimePrefs.model,
      thinkLevel: runtimePrefs.thinkLevel,
      reasoningLevel: runtimePrefs.reasoningLevel,
      verboseMode: runtimePrefs.verboseMode,
      noContinue: runtimePrefs.nextRunNoContinue === true,
      suppressPreviewStreaming:
        options.suppressPreviewStreaming === true ||
        runtimePrefs.telegramDeliveryMode === 'off',
      lifecyclePolicyOverride: options.lifecyclePolicyOverride,
      showReasoning:
        runtimePrefs.showReasoning === true ||
        runtimePrefs.reasoningLevel === 'stream',
    };

    const sessionKey = deps.getSessionKeyForChat(chatJid);
    let runToolsInvoked = 0;
    let runToolExecutions: PiToolExecution[] = [];

    let streamConsumer: StreamConsumer | null = null;

    const executeRun = async (
      runPrefs: ChatRunPreferences,
      attemptRequestId = requestId,
      suppressPreviewStreaming = false,
      promptOverride?: string,
    ): Promise<{
      status: 'success' | 'error';
      result: string | null;
      error?: string;
      streamed?: boolean;
      hadToolSideEffects?: boolean;
      usage?: {
        inputTokens?: number;
        outputTokens?: number;
        totalTokens?: number;
        provider?: string;
        model?: string;
      };
    }> => {
      let hadToolSideEffects = false;
      if (
        state.telegramBot &&
        isTelegramJid(chatJid) &&
        !suppressPreviewStreaming &&
        (runPrefs.telegramDeliveryMode || 'stream') !== 'off'
      ) {
        streamConsumer = new StreamConsumer({
          chatId: chatJid,
          runId: attemptRequestId || `run-${Date.now()}`,
          adapter: createTelegramAdapter(state.telegramBot),
          label: 'Agent',
          heartbeatMs: 0,
          deliveryMode: runPrefs.telegramDeliveryMode || 'stream',
          verboseMode: runPrefs.verboseMode || 'off',
        });
      } else {
        streamConsumer = null;
      }
      const output = await runContainerAgent(
        group,
        {
          ...input,
          prompt: promptOverride || input.prompt,
          requestId: attemptRequestId,
          verboseMode: runPrefs.verboseMode,
          noContinue: runPrefs.nextRunNoContinue === true,
          suppressPreviewStreaming:
            suppressPreviewStreaming || input.suppressPreviewStreaming,
        },
        abortSignal,
        (event) => {
          if (event.kind !== 'tool' || !attemptRequestId) return;
          hadToolSideEffects = true;
          if (streamConsumer) {
            streamConsumer.onToolEvent({
              toolName: event.toolName,
              status: event.status,
              ...(event.args ? { args: event.args } : {}),
              ...(event.output ? { output: event.output } : {}),
              ...(event.error ? { error: event.error } : {}),
            });
          }
          deps.emitTuiToolEvent({
            runId: attemptRequestId,
            sessionKey,
            index: event.index,
            toolName: event.toolName,
            status: event.status,
            ...(event.args ? { args: event.args } : {}),
            ...(event.output ? { output: event.output } : {}),
            ...(event.error ? { error: event.error } : {}),
          });
        },
        (request) => deps.handlePermissionGateRequest(chatJid, request),
        (event) => {
          if (streamConsumer) streamConsumer.handleProgress(event);
          options.onProgressEvent?.(event);
        },
      );
      cancelPendingConfirmationsForChat(chatJid);
      runToolsInvoked = output.toolExecutions?.length ?? 0;
      runToolExecutions = output.toolExecutions ?? [];

      // Bridge: write StreamConsumer preview state into the registry
      if (streamConsumer && isTelegramJid(chatJid)) {
        if (attemptRequestId) {
          const preview = streamConsumer.getPreviewState();
          if (preview) {
            const streamKey = getTelegramPreviewRunKey(
              chatJid,
              attemptRequestId,
            );
            telegramPreviewRegistry.setPreviewState(streamKey, {
              messageId: Number(preview.messageId),
              lastText: preview.lastText,
              updatedAt: Date.now(),
            });
          }
        }
        // Collapse the ephemeral Activity bubble to a one-line receipt so the
        // run's status churn never lingers as stale text. No-op when no activity
        // bubble was spawned (quick turns). Non-destructive: never deletes.
        const receipt =
          output.status === 'error'
            ? '⚠️ Stopped'
            : runToolsInvoked > 0
              ? `✓ Done · ${runToolsInvoked} tool${runToolsInvoked === 1 ? '' : 's'}`
              : '✓ Done';
        await streamConsumer.collapseActivity(receipt);
        streamConsumer.stop();
      }

      return {
        ...output,
        hadToolSideEffects,
      };
    };

    let output = await executeRun(runtimePrefs);

    if (output.status === 'error') {
      if (
        requestId &&
        typeof output.error === 'string' &&
        output.error.trim() &&
        !isUserAbortedErrorMessage(output.error)
      ) {
        deps.statusTelemetry.noteRuntimeError({
          runId: requestId,
          chatJid,
          errorMessage: output.error,
        });
      }
      if (isUserAbortedErrorMessage(output.error)) {
        return { result: null, streamed: false, ok: true };
      }
      if (
        typeof output.error === 'string' &&
        /^Pi runner timed out after \d+ms\b/.test(output.error.trim())
      ) {
        logger.warn(
          { group: group.name, error: output.error },
          'Container agent timed out',
        );
        return {
          result: output.error,
          streamed: !!output.streamed,
          ok: false,
          usage: output.usage,
          errorKind: 'runner_timeout',
        };
      }
      if (options.suppressErrorReply) {
        logger.warn(
          { group: group.name, error: output.error },
          'Container agent error (suppressed user reply)',
        );
        return { result: null, streamed: false, ok: false };
      }
      logger.error(
        { group: group.name, error: output.error },
        'Container agent error',
      );
      const msg = output.error
        ? `LLM error: ${output.error}`
        : 'LLM error: agent runner failed (no details).';
      return { result: msg, streamed: false, ok: true };
    }

    const isHeartbeatRun = requestId?.startsWith('heartbeat-') === true;
    const emptyOutputPolicy = await applyNonHeartbeatEmptyOutputPolicy({
      isHeartbeatRun,
      firstRun: {
        result: output.result,
        streamed: !!output.streamed,
        ok: true,
        hadToolSideEffects: output.hadToolSideEffects,
        usage: output.usage,
      },
      retryRun: async () => {
        const retryRequestId = requestId ? `${requestId}:retry` : requestId;
        const retryOutput = await executeRun(
          {
            ...runtimePrefs,
            nextRunNoContinue: true,
          },
          retryRequestId,
          true,
        );
        if (retryOutput.status === 'error') {
          if (
            requestId &&
            typeof retryOutput.error === 'string' &&
            retryOutput.error.trim() &&
            !isUserAbortedErrorMessage(retryOutput.error)
          ) {
            deps.statusTelemetry.noteRuntimeError({
              runId: requestId,
              chatJid,
              errorMessage: retryOutput.error,
            });
          }
          if (isUserAbortedErrorMessage(retryOutput.error)) {
            return { result: null, streamed: false, ok: true };
          }
          logger.error(
            { group: group.name, error: retryOutput.error },
            'Container agent retry error after empty output',
          );
          return {
            result: retryOutput.error
              ? `LLM error: ${retryOutput.error}`
              : 'LLM error: agent runner failed (no details).',
            streamed: false,
            ok: true,
            hadToolSideEffects: retryOutput.hadToolSideEffects,
          };
        }
        return {
          result: retryOutput.result,
          streamed: !!retryOutput.streamed,
          ok: true,
          hadToolSideEffects: retryOutput.hadToolSideEffects,
          usage: retryOutput.usage,
        };
      },
      isAborted: () => abortSignal?.aborted === true,
    });

    const finalResult = emptyOutputPolicy.finalRun;

    if (
      finalResult.ok &&
      finalResult.result &&
      !options.isHeartbeatTask &&
      !options.skipSkillMaintenance &&
      abortSignal?.aborted !== true
    ) {
      maybeRunSkillSelfImprovement({
        group,
        chatJid,
        originalTask: prompt,
        agentOutput: finalResult.result,
        toolsInvoked: runToolsInvoked,
        toolExecutions: runToolExecutions,
        runtimePrefs,
        requestId,
      });
      maybeRunSkillManager({
        group,
        chatJid,
        runtimePrefs,
        requestId,
      });
    }

    return {
      result: finalResult.result,
      streamed: finalResult.streamed,
      ok: finalResult.ok,
      usage: finalResult.usage,
      suppressUserDelivery: finalResult.suppressUserDelivery,
      controlPlaneStatus: finalResult.controlPlaneStatus,
    };
  } catch (err) {
    logger.error({ group: group.name, err }, 'Agent error');
    if (requestId) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      if (!isUserAbortedErrorMessage(errorMessage)) {
        deps.statusTelemetry.noteRuntimeError({
          runId: requestId,
          chatJid,
          errorMessage,
        });
      }
    }
    return { result: null, streamed: false, ok: false };
  } finally {
    if (requestId && isTelegramJid(chatJid)) {
      await deps.finalizeTelegramToolProgress(chatJid, requestId);
    }
  }
}
