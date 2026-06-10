import { PARITY_CONFIG } from '../config.js';
import { logger } from '../logger.js';
import { sanitizeUserFacingVerdictLeak } from '../runtime/boundary-ipc.js';
import type { TelegramMessagePreviewState } from '../telegram-streaming.js';
import type { NewMessage } from '../types.js';
import type { CodingWorkerResult } from '../coding-orchestrator.js';

export interface FinalizeCompletedRunParams {
  chatJid: string;
  runId: string;
  sessionKey: string;
  result: string | null;
  streamed: boolean;
  usage?:
    | {
        inputTokens?: number;
        outputTokens?: number;
        totalTokens?: number;
        provider?: string;
        model?: string;
      }
    | undefined;
  abortSignal: AbortSignal;
  deliverToChat?: boolean;
  externallyCompleted: boolean;
  telegramPreviewState: TelegramMessagePreviewState | null;
  timestampToPersist?: string;
  suppressUserDelivery?: boolean;
  controlPlaneStatus?: 'verification_failed';
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
  persistLastAgentTimestamp?: (chatJid: string, timestamp: string) => void;
  persistAssistantHistory: (
    chatJid: string,
    text: string,
    runId?: string,
  ) => string | void;
  deleteTelegramPreviewMessage: (
    chatJid: string,
    messageId: number,
    messageIds?: number[],
  ) => Promise<void>;
  finalizeTelegramPreviewMessage: (
    chatJid: string,
    messageId: number,
    text: string,
    messageIds?: number[],
  ) => Promise<boolean>;
  sendAgentResultMessage: (
    chatJid: string,
    text: string,
    opts?: { prefixWhatsApp?: boolean },
  ) => Promise<boolean>;
  emitTuiChatEvent: (payload: {
    runId: string;
    sessionKey: string;
    state: 'final' | 'aborted';
    message?: { role: 'assistant'; content: string };
    usage?: {
      inputTokens?: number;
      outputTokens?: number;
      totalTokens?: number;
      provider?: string;
      model?: string;
    };
  }) => void;
  emitTuiAgentEvent: (payload: {
    runId: string;
    sessionKey: string;
    phase: 'end';
    detail: 'aborted' | 'streamed' | 'complete';
  }) => void;
}

type RunUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  provider?: string;
  model?: string;
};

type CodingRunResult = {
  ok: boolean;
  result: string | null;
  streamed: boolean;
  usage?: RunUsage;
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

export type InboundOrigin = 'user' | 'assistant' | 'tui' | 'system';

interface ClassifiedInboundMessage {
  group: any;
  content: string;
  origin: InboundOrigin;
  isMainGroup: boolean;
  queuePrefs: Record<string, any>;
}

interface DispatchRequest {
  group: any;
  content: string;
  onboardingGate: { active: boolean };
  requestId: string;
  sessionKey: string;
  latestUserText: string;
  finalPrompt: string;
  codingHint: any;
  codingRoute: 'coder_execute' | 'coder_plan' | 'auto_execute' | null;
  delegationInstruction: string | null;
  shouldUseCodingWorker: boolean;
  runPreferences: Record<string, any>;
  timestampToPersist?: string;
  workspaceRoot?: string;
}

export type RunRoute = 'agent' | 'coding_worker';

interface RunCompletion {
  ok: boolean;
  result: string | null;
  streamed: boolean;
  usage?: RunUsage;
  suppressUserDelivery?: boolean;
  controlPlaneStatus?: 'verification_failed';
  errorKind?: 'runner_timeout';
}

export interface PromptInputLogEntry {
  groupFolder: string;
  requestId: string;
  chatJid: string;
  queueMode: string;
  selectedMessageCount: number;
  recentContextCount: number;
  noContinue: boolean;
  latestUserText: string;
  finalPrompt: string;
  createdAt: string;
}

export interface MessageDispatcherDeps {
  state: {
    registeredGroups: Record<string, any>;
    chatRunPreferences: Record<string, Record<string, any>>;
    lastAgentTimestamp?: Record<string, string>;
    lastInboundAt?: number;
  };
  constants: {
    assistantName: string;
    mainGroupFolder: string;
    triggerPattern: RegExp;
    tuiSenderName: string;
    mainWorkspaceDir?: string;
    coderGateMode?: 'explicit' | 'autosuggest';
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
  activeChatRunsById: Map<
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
  tuiMessageQueue: Map<
    string,
    Array<{ text: string; runId: string; deliver: boolean }>
  >;
  sendMessage: (chatJid: string, text: string) => Promise<boolean>;
  setTyping: (chatJid: string, typing: boolean) => Promise<void>;
  getMessagesSince: (
    chatJid: string,
    sinceTimestamp: string,
    assistantName: string,
  ) => NewMessage[];
  getRecentConversation?: (chatJid: string, limit: number) => NewMessage[];
  getSessionKeyForChat: (chatJid: string) => string;
  resolveMainOnboardingGate: (chatJid: string) => { active: boolean };
  buildOnboardingInterviewPrompt: (params: {
    prompt: string;
    latestUserText: string;
  }) => string;
  extractOnboardingCompletion: (text: string | null) => {
    text: string | null;
    completed: boolean;
  };
  completeMainWorkspaceOnboarding: (params: any) => void;
  rememberHeartbeatTarget: (chatJid: string) => void;
  runAgent: (
    group: any,
    prompt: string,
    chatJid: string,
    codingHint: any,
    requestId: any,
    runtimePrefs: Record<string, any>,
    options: Record<string, unknown>,
    abortSignal: AbortSignal,
  ) => Promise<{
    result: string | null;
    streamed: boolean;
    ok: boolean;
    usage?: RunUsage;
    suppressUserDelivery?: boolean;
    controlPlaneStatus?: 'verification_failed';
  }>;
  handleLongRunCommand?: (chatJid: string, content: string) => Promise<boolean>;
  startLongRun?: (
    chatJid: string,
    prompt: string,
    options?: {
      continuationPreamble?: string;
      sourceRequestId?: string;
      source?: string;
    },
  ) => Promise<{ id: string }>;
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
  consumeNextRunNoContinue: (chatJid: string) => boolean;
  updateChatUsage: (chatJid: string, usage?: RunUsage) => void;
  persistAssistantHistory: (
    chatJid: string,
    text: string,
    runId?: string,
  ) => string | void;
  deleteTelegramPreviewMessage: (
    chatJid: string,
    messageId: number,
    messageIds?: number[],
  ) => Promise<void>;
  finalizeTelegramPreviewMessage: (
    chatJid: string,
    messageId: number,
    text: string,
    messageIds?: number[],
  ) => Promise<boolean>;
  sendAgentResultMessage: (
    chatJid: string,
    text: string,
    opts?: { prefixWhatsApp?: boolean },
  ) => Promise<boolean>;
  emitTuiChatEvent: (payload: any) => void;
  emitTuiAgentEvent: (payload: any) => void;
  isTelegramJid: (chatJid: string) => boolean;
  prepareTelegramCompletionState?: (params: {
    chatJid: string;
    runId: string;
    result: string | null;
  }) => Promise<{
    externallyCompleted: boolean;
    previewState: TelegramMessagePreviewState | null;
  }>;
  consumeTelegramHostCompletedRun: (chatJid: string, runId: string) => boolean;
  consumeTelegramHostStreamState: (
    chatJid: string,
    runId: string,
  ) => TelegramMessagePreviewState | null;
  resolveTelegramStreamCompletionState: (params: {
    externallyCompleted: boolean;
    previewState: TelegramMessagePreviewState | null;
  }) => {
    effectiveStreamed: boolean;
    messagePreviewState: TelegramMessagePreviewState | null;
  };
  finalizeCompletedRun: (params: FinalizeCompletedRunParams) => Promise<void>;
  parseDelegationTrigger?: (text: string) => {
    hint: string;
    trigger?: string;
    instruction: string | null;
    projectSlug?: string | null;
  };
  isSubstantialCodingTask?: (text: string) => boolean;
  shouldSuggestCodingEscalation?: (text: string) => boolean;
  presentCoderSuggestion?: (params: {
    chatJid: string;
    taskText: string;
    requestId: string;
  }) => Promise<void>;
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
  isCoderDelegationCommand?: (content: string) => boolean;
  onboardingCommandBlockedText?: () => string;
  makeRunId?: (prefix: string) => string;
  logger?: {
    info?: (payload: unknown, message?: string) => void;
    error?: (payload: unknown, message?: string) => void;
    warn?: (payload: unknown, message?: string) => void;
  };
  recordCoderLearning?: (params: {
    workerResult: NonNullable<CodingRunResult['workerResult']>;
    taskText: string;
    groupFolder: string;
  }) => Promise<void> | void;
  sanitizeRunPreferences?: (
    chatJid: string,
    runPreferences: Record<string, any>,
  ) => { runPreferences: Record<string, any>; noticeText?: string };
  persistTuiUserHistory?: (
    chatJid: string,
    text: string,
    runId: string,
  ) => void;
  writePromptInputLog?: (payload: PromptInputLogEntry) => void;
  getUnresolvedWorkSummary?: (chatJid: string) => string | null;
  noteRunStarted?: (params: {
    chatJid: string;
    requestId: string;
    latestUserText: string;
  }) => void;
  noteRunSettled?: (params: {
    chatJid: string;
    requestId: string;
    ok: boolean;
    result: string | null;
  }) => void;
}

function formatPromptLine(
  message: Pick<NewMessage, 'timestamp' | 'sender_name' | 'content'>,
): string {
  return `[${message.timestamp}] ${message.sender_name}: ${message.content}`;
}

function clampPromptMessageToChars(
  message: NewMessage,
  maxChars: number,
): NewMessage {
  const prefix = `[${message.timestamp}] ${message.sender_name}: `;
  if (prefix.length >= maxChars) {
    return {
      ...message,
      content: '',
    };
  }
  const available = maxChars - prefix.length;
  if (message.content.length <= available) return message;
  if (available <= 3) {
    return {
      ...message,
      content: message.content.slice(0, available),
    };
  }
  return {
    ...message,
    content: `${message.content.slice(0, available - 3)}...`,
  };
}

function selectRecentConversationMessages(params: {
  messages: NewMessage[];
  excludedIds: Set<string>;
  maxMessages: number;
  maxChars: number;
  includeMessage?: (message: NewMessage) => boolean;
}): NewMessage[] {
  const filtered = params.messages.filter(
    (message) =>
      !params.excludedIds.has(message.id) &&
      message.content.trim().length > 0 &&
      (params.includeMessage ? params.includeMessage(message) : true),
  );
  if (filtered.length === 0) return [];

  const lastAssistant = [...filtered]
    .reverse()
    .find((message) => message.is_from_me === 1);

  let selected = filtered.slice(-params.maxMessages);
  if (
    lastAssistant &&
    !selected.some((message) => message.id === lastAssistant.id)
  ) {
    const selectedIds = new Set(selected.map((message) => message.id));
    selectedIds.add(lastAssistant.id);
    selected = filtered.filter((message) => selectedIds.has(message.id));
    while (selected.length > params.maxMessages) {
      const dropIndex = selected.findIndex(
        (message) => message.id !== lastAssistant.id,
      );
      if (dropIndex === -1) break;
      selected.splice(dropIndex, 1);
    }
  }

  const protectedId = lastAssistant?.id;
  const totalChars = () =>
    selected.reduce((sum, message, index) => {
      return sum + formatPromptLine(message).length + (index > 0 ? 1 : 0);
    }, 0);

  while (selected.length > 1 && totalChars() > params.maxChars) {
    const dropIndex = selected.findIndex(
      (message) => message.id !== protectedId,
    );
    if (dropIndex === -1) break;
    selected.splice(dropIndex, 1);
  }

  if (selected.length === 1) {
    const line = formatPromptLine(selected[0]);
    if (line.length > params.maxChars) {
      selected = [clampPromptMessageToChars(selected[0], params.maxChars)];
    }
  }

  return selected;
}

function isInternalAssistantHistoryMessage(message: NewMessage): boolean {
  if (message.is_from_me !== 1) return false;
  const text = message.content.replace(/^[^:\n]{1,80}:\s*/, '').trim();
  if (!text) return false;
  return (
    /^HEARTBEAT_OK$/i.test(text) ||
    /^heartbeat\s+(?:ok|okay)[\s.!?]*$/i.test(text) ||
    /^Quality check flagged/i.test(text) ||
    /Quality check flagged potential issues/i.test(text) ||
    /^LLM produced no user-visible final response/i.test(text) ||
    /^Evaluator flagged issues/i.test(text) ||
    /^I could not verify that this task is complete/i.test(text) ||
    /Approve the exact cleanup\/repair action before I continue/i.test(text)
  );
}

function buildInteractivePrompt(params: {
  recentConversation: NewMessage[];
  newInboundMessages: NewMessage[];
  queueMode: string;
  queueDrop: string;
  droppedCount: number;
  queueDebounceMs: number;
}): string {
  const recentLines =
    params.recentConversation.length > 0
      ? params.recentConversation.map(formatPromptLine)
      : ['(none)'];
  const inboundLines =
    params.newInboundMessages.length > 0
      ? params.newInboundMessages.map(formatPromptLine)
      : ['(none)'];

  let finalPrompt = [
    '[RECENT CONVERSATION]',
    ...recentLines,
    '',
    '[NEW INBOUND MESSAGES]',
    ...inboundLines,
  ].join('\n');

  if (params.queueMode === 'interrupt') {
    finalPrompt =
      `${finalPrompt}\n\n[QUEUE MODE: interrupt]\n` +
      'Prioritize the latest user intent, but do not drop unresolved work unless it is completed or explicitly cancelled by the user.';
  } else if (params.queueMode === 'steer') {
    finalPrompt =
      `${finalPrompt}\n\n[QUEUE MODE: steer]\n` +
      'Respect full context, but prioritize the user’s newest intent and provide concise steering updates.';
  } else if (params.queueMode === 'steer-backlog') {
    finalPrompt =
      `${finalPrompt}\n\n[QUEUE MODE: steer-backlog]\n` +
      'Process backlog context and prioritize the newest request first.';
  }
  if (params.queueDrop === 'summarize' && params.droppedCount > 0) {
    finalPrompt =
      `${finalPrompt}\n\n[QUEUE NOTE]\n` +
      `Older backlog truncated by queue cap (${params.droppedCount} message(s) dropped); summarize assumptions before acting.`;
  }
  if (params.queueDebounceMs > 0) {
    finalPrompt =
      `${finalPrompt}\n\n[QUEUE NOTE]\n` +
      `Debounce preference is ${params.queueDebounceMs}ms; keep responses concise and account for rapid bursts.`;
  }

  return finalPrompt;
}

function prepareInteractivePrompt(params: {
  chatJid: string;
  selectedMessages: NewMessage[];
  queueMode: string;
  queueDrop: string;
  droppedCount: number;
  queueDebounceMs: number;
  getRecentConversation?: (chatJid: string, limit: number) => NewMessage[];
  includeRecentConversation?: boolean;
  includeTuiMessagesInRecentConversation?: boolean;
}): { finalPrompt: string; recentConversationCount: number } {
  if (params.includeRecentConversation === false) {
    return {
      finalPrompt: buildInteractivePrompt({
        recentConversation: [],
        newInboundMessages: params.selectedMessages,
        queueMode: params.queueMode,
        queueDrop: params.queueDrop,
        droppedCount: params.droppedCount,
        queueDebounceMs: params.queueDebounceMs,
      }),
      recentConversationCount: 0,
    };
  }

  const recentConversationLimit =
    PARITY_CONFIG.prompt.recentConversationMaxMessages;
  const recentConversationChars =
    PARITY_CONFIG.prompt.recentConversationMaxChars;
  const fetchLimit = Math.max(
    recentConversationLimit * 3,
    recentConversationLimit + params.selectedMessages.length + 4,
  );
  const recentConversation = selectRecentConversationMessages({
    messages: params.getRecentConversation
      ? params.getRecentConversation(params.chatJid, fetchLimit)
      : [],
    excludedIds: new Set(params.selectedMessages.map((message) => message.id)),
    maxMessages: recentConversationLimit,
    maxChars: recentConversationChars,
    includeMessage: params.includeTuiMessagesInRecentConversation
      ? undefined
      : (message) =>
          message.sender !== '__fft_tui__' &&
          !isInternalAssistantHistoryMessage(message),
  });

  return {
    finalPrompt: buildInteractivePrompt({
      recentConversation,
      newInboundMessages: params.selectedMessages,
      queueMode: params.queueMode,
      queueDrop: params.queueDrop,
      droppedCount: params.droppedCount,
      queueDebounceMs: params.queueDebounceMs,
    }),
    recentConversationCount: recentConversation.length,
  };
}

function resolveInboundOrigin(
  msg: NewMessage,
  assistantName: string,
): InboundOrigin {
  if (msg.sender === '__fft_tui__') return 'tui';
  if (!msg.sender && !msg.sender_name) return 'system';
  if (msg.sender === assistantName && msg.is_from_me === 1) return 'assistant';
  return 'user';
}

function classifyInboundMessage(
  msg: NewMessage,
  deps: MessageDispatcherDeps,
): ClassifiedInboundMessage | null {
  const group = deps.state.registeredGroups[msg.chat_jid];
  if (!group) return null;

  const content = msg.content.trim();
  if (!content) return null;

  const queuePrefs = deps.state.chatRunPreferences[msg.chat_jid] || {};
  return {
    group,
    content,
    origin: resolveInboundOrigin(msg, deps.constants.assistantName),
    isMainGroup: group.folder === deps.constants.mainGroupFolder,
    queuePrefs,
  };
}

function selectRunRoute(
  request: Pick<DispatchRequest, 'shouldUseCodingWorker'>,
  deps: MessageDispatcherDeps,
): RunRoute {
  return request.shouldUseCodingWorker && deps.runCodingTask
    ? 'coding_worker'
    : 'agent';
}

function injectUnresolvedWorkPreamble(
  finalPrompt: string,
  unresolvedSummary: string | null | undefined,
): string {
  const summary = unresolvedSummary?.trim();
  if (!summary) return finalPrompt;
  return [
    '[UNRESOLVED CONTINUITY CHECK]',
    summary,
    '',
    '[CONTINUITY RULE]',
    'Carry unresolved work forward before marking the task complete.',
    '',
    finalPrompt,
  ].join('\n');
}

function isRunnerTimeoutFinalText(text: string): boolean {
  return /^LLM error:\s+Pi runner timed out after \d+ms\b/.test(text);
}

function isRunnerTimeoutText(text: string | null | undefined): boolean {
  if (!text) return false;
  return /^(?:LLM error:\s+)?Pi runner timed out after \d+ms\b/.test(
    text.trim(),
  );
}

function shouldAutoRouteLongRun(params: {
  isMainGroup: boolean;
  onboardingActive: boolean;
  content: string;
  latestUserText: string;
  shouldUseCodingWorker: boolean;
  deps: MessageDispatcherDeps;
}): boolean {
  if (!params.isMainGroup || params.onboardingActive) return false;
  if (!params.deps.startLongRun) return false;
  const text = `${params.content}\n${params.latestUserText}`.toLowerCase();
  if (
    /^\s*\/(run|runs|run-status|run_status|cancel-run|cancel_run)\b/.test(text)
  ) {
    return false;
  }
  if (params.shouldUseCodingWorker) return true;
  if (params.deps.isSubstantialCodingTask?.(params.latestUserText) === true) {
    return true;
  }
  return [
    /\b(video|render|rendering|tts|text[- ]to[- ]speech|voiceover|audio|media|animation|transcode)\b/,
    /\b(end[- ]to[- ]end|tonight|deliverable|production[- ]ready|full implementation|ship it)\b/,
    /\b(long[- ]running|long running|long[- ]horizon|take a while|keep working)\b/,
    /\b(research|investigate|deep dive|compare sources|write a report)\b/,
    /\b(multi[- ]step|several steps|from start to finish)\b/,
  ].some((pattern) => pattern.test(text));
}

export async function finalizeCompletedRun(
  params: FinalizeCompletedRunParams,
): Promise<void> {
  params.updateChatUsage(params.chatJid, params.usage);
  if (params.timestampToPersist) {
    params.persistLastAgentTimestamp?.(
      params.chatJid,
      params.timestampToPersist,
    );
  }

  if (params.abortSignal.aborted) {
    if (params.telegramPreviewState) {
      await params.deleteTelegramPreviewMessage(
        params.chatJid,
        params.telegramPreviewState.messageId,
        params.telegramPreviewState.messageIds,
      );
    }
    params.emitTuiChatEvent({
      runId: params.runId,
      sessionKey: params.sessionKey,
      state: 'aborted',
    });
    params.emitTuiAgentEvent({
      runId: params.runId,
      sessionKey: params.sessionKey,
      phase: 'end',
      detail: 'aborted',
    });
    return;
  }

  if (params.suppressUserDelivery) {
    if (params.telegramPreviewState) {
      await params.deleteTelegramPreviewMessage(
        params.chatJid,
        params.telegramPreviewState.messageId,
        params.telegramPreviewState.messageIds,
      );
    }
    params.emitTuiAgentEvent({
      runId: params.runId,
      sessionKey: params.sessionKey,
      phase: 'end',
      detail: 'complete',
    });
    return;
  }

  const shouldSanitizeVerdictLeak =
    params.controlPlaneStatus === 'verification_failed';
  const finalText =
    typeof params.result === 'string'
      ? shouldSanitizeVerdictLeak
        ? sanitizeUserFacingVerdictLeak(params.result.trim())
        : params.result.trim()
      : '';
  const hasVisibleFinalText = finalText.length > 0;

  if (!hasVisibleFinalText) {
    const rawStreamedText = params.telegramPreviewState?.lastText?.trim() || '';
    const streamedText = shouldSanitizeVerdictLeak
      ? sanitizeUserFacingVerdictLeak(rawStreamedText)
      : rawStreamedText;
    if (streamedText) {
      const assistantTimestamp = params.persistAssistantHistory(
        params.chatJid,
        streamedText,
        params.runId,
      );
      if (assistantTimestamp) {
        params.persistLastAgentTimestamp?.(params.chatJid, assistantTimestamp);
      }
      const finalizedPreview = await params.finalizeTelegramPreviewMessage(
        params.chatJid,
        params.telegramPreviewState!.messageId,
        streamedText,
        params.telegramPreviewState!.messageIds,
      );
      if (!finalizedPreview && params.deliverToChat !== false) {
        await params.sendAgentResultMessage(params.chatJid, streamedText, {
          prefixWhatsApp: true,
        });
      }
      params.emitTuiChatEvent({
        runId: params.runId,
        sessionKey: params.sessionKey,
        state: 'final',
        message: { role: 'assistant', content: streamedText },
        usage: params.usage,
      });
      params.emitTuiAgentEvent({
        runId: params.runId,
        sessionKey: params.sessionKey,
        phase: 'end',
        detail: 'streamed',
      });
      return;
    }
    const parts = [
      'LLM produced no user-visible final response',
      `run=${params.runId}`,
    ];
    if (params.usage?.provider) parts.push(`provider=${params.usage.provider}`);
    if (params.usage?.model) parts.push(`model=${params.usage.model}`);
    if (params.externallyCompleted) parts.push('external_delivery=yes');
    const diagnostic = parts.join(' | ');
    params.persistAssistantHistory(params.chatJid, diagnostic, params.runId);
    await params.sendAgentResultMessage(params.chatJid, diagnostic);
    params.emitTuiAgentEvent({
      runId: params.runId,
      sessionKey: params.sessionKey,
      phase: 'end',
      detail: 'complete',
    });
    return;
  }

  const effectiveResult = sanitizeUserFacingVerdictLeak(finalText);
  if (effectiveResult) {
    if (isRunnerTimeoutText(effectiveResult)) {
      const streamedText = params.telegramPreviewState?.lastText?.trim() || '';
      if (streamedText) {
        const assistantTimestamp = params.persistAssistantHistory(
          params.chatJid,
          streamedText,
          params.runId,
        );
        if (assistantTimestamp) {
          params.persistLastAgentTimestamp?.(
            params.chatJid,
            assistantTimestamp,
          );
        }
        const finalizedPreview =
          params.telegramPreviewState && !params.externallyCompleted
            ? await params.finalizeTelegramPreviewMessage(
                params.chatJid,
                params.telegramPreviewState.messageId,
                streamedText,
                params.telegramPreviewState.messageIds,
              )
            : false;
        if (
          !finalizedPreview &&
          params.deliverToChat !== false &&
          !params.externallyCompleted
        ) {
          await params.sendAgentResultMessage(params.chatJid, streamedText, {
            prefixWhatsApp: true,
          });
        }
        params.emitTuiChatEvent({
          runId: params.runId,
          sessionKey: params.sessionKey,
          state: 'final',
          message: { role: 'assistant', content: streamedText },
          usage: params.usage,
        });
      } else if (params.telegramPreviewState && !params.externallyCompleted) {
        await params.deleteTelegramPreviewMessage(
          params.chatJid,
          params.telegramPreviewState.messageId,
          params.telegramPreviewState.messageIds,
        );
      }
      params.emitTuiAgentEvent({
        runId: params.runId,
        sessionKey: params.sessionKey,
        phase: 'end',
        detail: params.streamed ? 'streamed' : 'complete',
      });
      return;
    }
    const streamedText = params.telegramPreviewState?.lastText?.trim() || '';
    const shouldPreserveStreamedTimeoutPreview =
      streamedText.length > 0 && isRunnerTimeoutFinalText(effectiveResult);
    let sentSeparateTimeoutStatus = false;
    const assistantTimestamp = params.persistAssistantHistory(
      params.chatJid,
      shouldPreserveStreamedTimeoutPreview
        ? `${streamedText}\n\n${effectiveResult}`
        : effectiveResult,
      params.runId,
    );
    if (assistantTimestamp) {
      params.persistLastAgentTimestamp?.(params.chatJid, assistantTimestamp);
    }
    let finalizedPreview = false;
    if (!params.externallyCompleted && params.telegramPreviewState) {
      finalizedPreview = await params.finalizeTelegramPreviewMessage(
        params.chatJid,
        params.telegramPreviewState.messageId,
        shouldPreserveStreamedTimeoutPreview ? streamedText : effectiveResult,
        params.telegramPreviewState.messageIds,
      );
      if (
        finalizedPreview &&
        shouldPreserveStreamedTimeoutPreview &&
        params.deliverToChat !== false
      ) {
        sentSeparateTimeoutStatus = await params.sendAgentResultMessage(
          params.chatJid,
          effectiveResult,
          {
            prefixWhatsApp: true,
          },
        );
      }
    }
    // Send a fallback message if:
    // - delivery is enabled
    // - completion was NOT handled by the Telegram streaming layer
    // - either: (1) no streaming happened, OR
    //           (2) streaming happened with a preview that failed to finalize, OR
    //           (3) streaming happened but no preview state exists (drafts disabled
    //               mid-stream or preview state not captured on resume — Telegram
    //               streaming layer did not actually deliver anything)
    const shouldSend =
      params.deliverToChat !== false &&
      !params.externallyCompleted &&
      !sentSeparateTimeoutStatus &&
      (!params.streamed || !params.telegramPreviewState || !finalizedPreview);

    if (shouldSend) {
      const sent = await params.sendAgentResultMessage(
        params.chatJid,
        effectiveResult,
        {
          prefixWhatsApp: true,
        },
      );
      if (!sent) {
        logger.error(
          { chatJid: params.chatJid, runId: params.runId },
          'Agent result message delivery failed; user may not have received the response',
        );
      }
    }
    params.emitTuiChatEvent({
      runId: params.runId,
      sessionKey: params.sessionKey,
      state: 'final',
      message: { role: 'assistant', content: effectiveResult },
      usage: params.usage,
    });
    params.emitTuiAgentEvent({
      runId: params.runId,
      sessionKey: params.sessionKey,
      phase: 'end',
      detail: params.streamed ? 'streamed' : 'complete',
    });
    return;
  }

  if (params.telegramPreviewState) {
    await params.deleteTelegramPreviewMessage(
      params.chatJid,
      params.telegramPreviewState.messageId,
      params.telegramPreviewState.messageIds,
    );
  }
  params.emitTuiAgentEvent({
    runId: params.runId,
    sessionKey: params.sessionKey,
    phase: 'end',
    detail: params.streamed ? 'streamed' : 'complete',
  });
}

export function createMessageDispatcher(deps: MessageDispatcherDeps): {
  processMessage: (msg: NewMessage) => Promise<boolean>;
  runDirectSessionTurn: (params: {
    chatJid: string;
    text: string;
    runId: string;
    deliver: boolean;
  }) => Promise<{
    runId: string;
    status: 'started' | 'queued' | 'already_running';
  }>;
} {
  type ProcessMessageOutcome = 'ignored' | 'queued' | 'started';
  const inboundMessageQueue = new Map<string, NewMessage>();
  const timeoutContinuationRequestIds = new Set<string>();

  function enqueueInboundMessage(msg: NewMessage): void {
    // Keep only the latest pending inbound trigger per chat.
    // buildDispatchRequest() already rehydrates backlog via getMessagesSince().
    inboundMessageQueue.set(msg.chat_jid, msg);
  }

  function shiftQueuedInbound(chatJid: string): NewMessage | null {
    const next = inboundMessageQueue.get(chatJid) || null;
    if (next) inboundMessageQueue.delete(chatJid);
    return next;
  }

  function shiftQueuedTui(
    chatJid: string,
  ): { text: string; runId: string; deliver: boolean } | null {
    const queue = deps.tuiMessageQueue.get(chatJid);
    const next = queue?.shift() || null;
    if (queue && queue.length === 0) deps.tuiMessageQueue.delete(chatJid);
    return next;
  }

  function drainQueuedWork(chatJid: string): void {
    if (deps.activeChatRuns.has(chatJid)) return;
    const nextInbound = shiftQueuedInbound(chatJid);
    if (nextInbound) {
      void (async () => {
        const outcome = await processMessageWithOutcome(nextInbound);
        if (outcome !== 'started') {
          // The queued inbound item did not start a run (ignored/queued), so keep draining.
          drainQueuedWork(chatJid);
        }
      })().catch((err) => {
        deps.logger?.error?.(
          { chatJid, err },
          'Failed to drain queued inbound message',
        );
      });
      return;
    }
    const nextTuiMessage = shiftQueuedTui(chatJid);
    if (!nextTuiMessage) return;
    void runDirectSessionTurn({
      chatJid,
      text: nextTuiMessage.text,
      runId: nextTuiMessage.runId,
      deliver: nextTuiMessage.deliver,
    }).catch((err) => {
      deps.logger?.error?.(
        { chatJid, err },
        'Failed to drain queued TUI message',
      );
    });
  }

  function maybeInjectUnresolvedWork(
    chatJid: string,
    finalPrompt: string,
  ): string {
    return injectUnresolvedWorkPreamble(
      finalPrompt,
      deps.getUnresolvedWorkSummary?.(chatJid),
    );
  }

  async function startDurableLongRun(params: {
    chatJid: string;
    prompt: string;
    notice: string;
    continuationPreamble?: string;
    sourceRequestId?: string;
    source: string;
  }): Promise<{ id: string } | null> {
    if (!deps.startLongRun) return null;
    const run = await deps.startLongRun(params.chatJid, params.prompt, {
      continuationPreamble: params.continuationPreamble,
      sourceRequestId: params.sourceRequestId,
      source: params.source,
    });
    await deps.sendMessage(
      params.chatJid,
      params.notice.replace('<id>', run.id),
    );
    return run;
  }

  async function finalizeRun(params: {
    chatJid: string;
    runId: string;
    sessionKey: string;
    result: string | null;
    streamed: boolean;
    usage?: RunUsage;
    abortSignal: AbortSignal;
    timestampToPersist?: string;
    deliverToChat?: boolean;
    suppressUserDelivery?: boolean;
    controlPlaneStatus?: 'verification_failed';
  }): Promise<void> {
    const completionState =
      deps.isTelegramJid(params.chatJid) && deps.prepareTelegramCompletionState
        ? await deps.prepareTelegramCompletionState({
            chatJid: params.chatJid,
            runId: params.runId,
            result: params.result,
          })
        : {
            externallyCompleted: deps.isTelegramJid(params.chatJid)
              ? deps.consumeTelegramHostCompletedRun(
                  params.chatJid,
                  params.runId,
                )
              : false,
            previewState: deps.isTelegramJid(params.chatJid)
              ? deps.consumeTelegramHostStreamState(
                  params.chatJid,
                  params.runId,
                )
              : null,
          };
    const telegramCompletionState = deps.resolveTelegramStreamCompletionState({
      externallyCompleted: completionState.externallyCompleted,
      previewState: completionState.previewState,
    });

    await deps.finalizeCompletedRun({
      chatJid: params.chatJid,
      runId: params.runId,
      sessionKey: params.sessionKey,
      result: params.result,
      streamed: telegramCompletionState.effectiveStreamed,
      usage: params.usage,
      abortSignal: params.abortSignal,
      deliverToChat: params.deliverToChat,
      suppressUserDelivery: params.suppressUserDelivery,
      controlPlaneStatus: params.controlPlaneStatus,
      timestampToPersist: params.timestampToPersist,
      externallyCompleted: completionState.externallyCompleted,
      telegramPreviewState: telegramCompletionState.messagePreviewState,
      updateChatUsage: deps.updateChatUsage,
      persistLastAgentTimestamp: (chatJid, timestamp) => {
        deps.state.lastAgentTimestamp ||= {};
        deps.state.lastAgentTimestamp[chatJid] = timestamp;
      },
      persistAssistantHistory: deps.persistAssistantHistory,
      deleteTelegramPreviewMessage: deps.deleteTelegramPreviewMessage,
      finalizeTelegramPreviewMessage: deps.finalizeTelegramPreviewMessage,
      sendAgentResultMessage: deps.sendAgentResultMessage,
      emitTuiChatEvent: deps.emitTuiChatEvent as any,
      emitTuiAgentEvent: deps.emitTuiAgentEvent as any,
    });
  }

  async function executeDispatchRun(params: {
    chatJid: string;
    group: any;
    sessionKey: string;
    requestId: string;
    latestUserText: string;
    finalPrompt: string;
    codingHint: any;
    codingRoute: 'coder_execute' | 'coder_plan' | 'auto_execute' | null;
    delegationInstruction: string | null;
    runPreferences: Record<string, any>;
    onboardingGate: { active: boolean };
    route: RunRoute;
    timestampToPersist?: string;
    deliverToChat?: boolean;
    onSettled?: () => void;
    workspaceRoot?: string;
  }): Promise<void> {
    let result: string | null = null;
    let streamed = false;
    let ok = false;
    let usage: RunUsage | undefined;
    let suppressUserDelivery = false;
    let controlPlaneStatus: 'verification_failed' | undefined;
    let errorKind: RunCompletion['errorKind'] | undefined;
    const abortController = new AbortController();
    const activeRun = {
      chatJid: params.chatJid,
      startedAt: Date.now(),
      requestId: params.requestId,
      abortController,
    };

    deps.activeChatRuns.set(params.chatJid, activeRun);
    deps.activeChatRunsById.set(params.requestId, activeRun);
    deps.noteRunStarted?.({
      chatJid: params.chatJid,
      requestId: params.requestId,
      latestUserText: params.latestUserText,
    });
    deps.emitTuiChatEvent({
      runId: params.requestId,
      sessionKey: params.sessionKey,
      state: 'message',
      message: { role: 'user', content: params.latestUserText },
    });
    deps.emitTuiAgentEvent({
      runId: params.requestId,
      sessionKey: params.sessionKey,
      phase: 'start',
      detail: 'running',
    });
    await deps.setTyping(params.chatJid, true);
    deps.logger?.info?.(
      {
        group: params.group.name,
        promptLength: params.finalPrompt.length,
        route: params.route,
      },
      'Starting agent run',
    );

    // Capture reflection data immediately after run completes - this creates a stable closure
    // that won't be affected by subsequent calls to executeDispatchRun
    let capturedReflectionData:
      | {
          workerResult: CodingRunResult['workerResult'];
          taskText: string;
          groupFolder: string;
        }
      | undefined;

    try {
      try {
        const isPlan = params.codingHint === 'force_delegate_plan';
        const run: RunCompletion =
          params.route === 'coding_worker' && deps.runCodingTask
            ? await deps.runCodingTask({
                requestId: params.requestId,
                mode: isPlan ? 'plan' : 'execute',
                config: {
                  toolMode: isPlan ? 'read_only' : 'full',
                  isSubagent: false,
                  workspaceMode: isPlan ? 'read_only' : 'ephemeral_worktree',
                },
                originChatJid: params.chatJid,
                originGroupFolder: params.group.folder,
                taskText: params.delegationInstruction || params.latestUserText,
                timeoutSeconds: 1800,
                allowFanout:
                  params.codingRoute === 'coder_execute' ||
                  params.codingRoute === 'auto_execute',
                sessionContext: params.finalPrompt,
                assistantName: deps.constants.assistantName,
                sessionKey: params.sessionKey,
                group: params.group,
                workspaceRoot: params.workspaceRoot,
                runtimePrefs: params.runPreferences,
                abortController,
              })
            : await deps.runAgent(
                params.group,
                params.finalPrompt,
                params.chatJid,
                params.codingHint,
                params.requestId,
                params.runPreferences,
                {},
                abortController.signal,
              );

        deps.logger?.info?.(
          {
            group: params.group.name,
            ok: run.ok,
            hasResult: !!run.result,
            resultLength: run.result?.length,
            route: params.route,
          },
          'Agent run completed',
        );
        result = run.result;
        streamed = run.streamed;
        ok = run.ok;
        usage = run.usage;
        suppressUserDelivery = run.suppressUserDelivery === true;
        controlPlaneStatus = run.controlPlaneStatus;
        errorKind = run.errorKind;

        // Capture worker result for reflection (async MEMORY write after completion path)
        // Only for coding execute routes (exclude plan mode for coder-plan).
        if (
          params.route === 'coding_worker' &&
          params.codingHint !== 'force_delegate_plan'
        ) {
          const workerResult = (run as CodingRunResult).workerResult;
          if (workerResult) {
            capturedReflectionData = {
              workerResult,
              taskText:
                params.delegationInstruction || params.latestUserText || '',
              groupFolder: params.group.folder,
            };
          }
        }
      } finally {
        await deps.setTyping(params.chatJid, false);
        if (deps.activeChatRuns.get(params.chatJid) === activeRun) {
          deps.activeChatRuns.delete(params.chatJid);
        }
        deps.activeChatRunsById.delete(params.requestId);
        deps.noteRunSettled?.({
          chatJid: params.chatJid,
          requestId: params.requestId,
          ok,
          result,
        });
      }

      if (ok && params.onboardingGate.active) {
        const completion = deps.extractOnboardingCompletion(result);
        result = completion.text;
        if (completion.completed) {
          deps.completeMainWorkspaceOnboarding({
            workspaceDir: deps.constants.mainWorkspaceDir,
          });
          if (!result) result = 'Onboarding complete.';
          deps.logger?.info?.(
            { chatJid: params.chatJid, requestId: params.requestId },
            'Completed main workspace onboarding from gated run',
          );
        }
      }

      const triggerAsyncCoderReflection = () => {
        if (!capturedReflectionData) return;
        const { workerResult, taskText, groupFolder } = capturedReflectionData;

        if (deps.recordCoderLearning) {
          Promise.resolve(
            deps.recordCoderLearning({
              workerResult: workerResult as NonNullable<
                CodingRunResult['workerResult']
              >,
              taskText,
              groupFolder,
            }),
          ).catch((err) => {
            deps.logger?.error?.(
              { err, groupFolder, taskText },
              'Failed to record coder learning via injected hook — coder reflection skipped',
            );
          });
          return;
        }

        import('../coder-learnings.js')
          .then(({ reflectOnCoderRun, writeCoderLearningsToMemory }) => {
            reflectOnCoderRun(workerResult as CodingWorkerResult, taskText)
              .then((entry) => writeCoderLearningsToMemory(entry, groupFolder))
              .catch((err) => {
                deps.logger?.error?.(
                  { err, groupFolder },
                  'Failed to write coder learnings to MEMORY.md',
                );
              });
          })
          .catch((err) => {
            deps.logger?.error?.(
              { err, groupFolder },
              'Failed to import coder-learnings module for reflection',
            );
          });
      };

      if (ok) {
        await finalizeRun({
          chatJid: params.chatJid,
          runId: params.requestId,
          sessionKey: params.sessionKey,
          result,
          streamed,
          usage,
          abortSignal: abortController.signal,
          timestampToPersist: params.timestampToPersist,
          deliverToChat: params.deliverToChat,
          suppressUserDelivery,
          controlPlaneStatus,
        });

        // Fire-and-forget reflection after success completion.
        triggerAsyncCoderReflection();

        return;
      }

      if (
        params.route === 'agent' &&
        deps.startLongRun &&
        controlPlaneStatus === undefined &&
        (isRunnerTimeoutText(result) ||
          (result === null && errorKind === 'runner_timeout')) &&
        !timeoutContinuationRequestIds.has(params.requestId)
      ) {
        timeoutContinuationRequestIds.add(params.requestId);
        const longRun = await startDurableLongRun({
          chatJid: params.chatJid,
          prompt: params.finalPrompt,
          notice: 'Run timed out; continuing as long run <id>.',
          continuationPreamble: `Previous run ${params.requestId} timed out. Inspect existing artifacts, logs, and workspace state. Continue from the current state without restarting completed work.`,
          sourceRequestId: params.requestId,
          source: 'timeout-continuation',
        });
        if (longRun) {
          deps.emitTuiAgentEvent({
            runId: params.requestId,
            sessionKey: params.sessionKey,
            phase: 'end',
            detail: 'timeout continued',
          });
          return;
        }
      }

      deps.emitTuiChatEvent({
        runId: params.requestId,
        sessionKey: params.sessionKey,
        state: 'error',
        errorMessage: 'Run failed',
      });
      deps.emitTuiAgentEvent({
        runId: params.requestId,
        sessionKey: params.sessionKey,
        phase: 'error',
        detail: 'run failed',
      });

      if (deps.isTelegramJid(params.chatJid)) {
        deps.deleteTelegramPreviewMessage?.(params.chatJid, 0).catch(() => {});
        deps.consumeTelegramHostStreamState?.(params.chatJid, params.requestId);
        deps.consumeTelegramHostCompletedRun?.(
          params.chatJid,
          params.requestId,
        );

        const errorMsg =
          result || 'Sorry, there was an error processing your message.';
        const sent = await deps.sendAgentResultMessage(
          params.chatJid,
          errorMsg,
          {
            prefixWhatsApp: true,
          },
        );
        if (!sent) {
          logger.error(
            { chatJid: params.chatJid, runId: params.requestId },
            'Agent error message delivery failed; user may not have been notified of the run failure',
          );
        }
      }

      // Fire-and-forget reflection after failure completion.
      triggerAsyncCoderReflection();
    } finally {
      params.onSettled?.();
    }
  }

  async function buildDispatchRequest(
    msg: NewMessage,
    classified: ClassifiedInboundMessage,
  ): Promise<DispatchRequest | null> {
    if (classified.origin !== 'user') return null;

    const { group, content, isMainGroup, queuePrefs } = classified;
    const queueMode = queuePrefs.queueMode || 'collect';
    const queueDrop = queuePrefs.queueDrop || 'old';
    const queueCap =
      typeof queuePrefs.queueCap === 'number' && queuePrefs.queueCap > 0
        ? Math.floor(queuePrefs.queueCap)
        : undefined;
    const queueDebounceMs =
      typeof queuePrefs.queueDebounceMs === 'number' &&
      queuePrefs.queueDebounceMs > 0
        ? Math.floor(queuePrefs.queueDebounceMs)
        : 0;
    const freeChatEnabled = queuePrefs.freeChat === true;
    if (
      !isMainGroup &&
      !freeChatEnabled &&
      !deps.constants.triggerPattern.test(content)
    ) {
      return null;
    }

    const onboardingGate = deps.resolveMainOnboardingGate(msg.chat_jid);
    if (onboardingGate.active && deps.isCoderDelegationCommand?.(content)) {
      await deps.sendMessage(
        msg.chat_jid,
        deps.onboardingCommandBlockedText?.() || 'Blocked',
      );
      return null;
    }

    let codingHint: any = isMainGroup ? 'auto' : 'none';
    let codingRoute: DispatchRequest['codingRoute'] = null;
    let requestId = deps.makeRunId
      ? deps.makeRunId('chat')
      : `chat-${Date.now()}`;
    let delegationInstruction: string | null = null;
    let workspaceRoot: string | undefined;

    const stripped = content
      .replace(deps.constants.triggerPattern, '')
      .trimStart();
    const parsedTrigger =
      onboardingGate.active || !deps.parseDelegationTrigger
        ? { hint: 'none' as const, instruction: null }
        : deps.parseDelegationTrigger(stripped);
    const wantsDelegation = parsedTrigger.hint !== 'none';
    const wantsCreateProject =
      parsedTrigger.trigger === 'coder-create-project' ||
      parsedTrigger.trigger === 'coder_create_project';

    if (wantsDelegation && !isMainGroup) {
      await deps.sendMessage(
        msg.chat_jid,
        `${deps.constants.assistantName}: coder delegation is only available in the main/admin chat for safety.`,
      );
      return null;
    }

    if (wantsDelegation) {
      codingHint = wantsCreateProject
        ? 'force_delegate_plan'
        : parsedTrigger.hint;
      codingRoute = wantsCreateProject
        ? 'coder_plan'
        : codingHint === 'force_delegate_plan'
          ? 'coder_plan'
          : 'coder_execute';
      delegationInstruction = parsedTrigger.instruction;
      let projectLabel: string | undefined;
      if (wantsCreateProject) {
        if (!parsedTrigger.projectSlug || !deps.createCoderProject) {
          await deps.sendMessage(
            msg.chat_jid,
            'Could not create that project. Use `/coder-create-project <slug> <task>` from the main chat.',
          );
          return null;
        }
        if (!delegationInstruction) {
          await deps.sendMessage(
            msg.chat_jid,
            'Use `/coder-create-project <slug> <task>` so the new project starts with a concrete coder plan.',
          );
          return null;
        }
        const created = await deps.createCoderProject({
          slug: parsedTrigger.projectSlug,
        });
        workspaceRoot = created.workspaceRoot;
        projectLabel = created.projectLabel;
        await deps.sendMessage(
          msg.chat_jid,
          `Created ${created.projectLabel}. Starting a coder plan there.`,
        );
      } else {
        const preparedTarget = deps.prepareCoderTarget
          ? await deps.prepareCoderTarget({
              chatJid: msg.chat_jid,
              mode: codingHint === 'force_delegate_plan' ? 'plan' : 'execute',
              taskText: delegationInstruction || stripped,
              requestId,
            })
          : null;
        if (preparedTarget?.status === 'handled') return null;
        if (preparedTarget?.status === 'ready') {
          delegationInstruction = preparedTarget.taskText;
          workspaceRoot = preparedTarget.workspaceRoot;
          projectLabel = preparedTarget.projectLabel;
        }
      }
      requestId = `coder-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;
      const startMessageBody =
        codingHint === 'force_delegate_plan'
          ? `Starting coder plan run (${requestId})${projectLabel ? ` for ${projectLabel}` : ''}...`
          : `Starting coder run (${requestId})${projectLabel ? ` for ${projectLabel}` : ''}...`;
      await deps.sendMessage(msg.chat_jid, startMessageBody);
    }

    const sinceTimestamp = deps.state.lastAgentTimestamp?.[msg.chat_jid] || '';
    const missedMessages = deps.getMessagesSince(
      msg.chat_jid,
      sinceTimestamp,
      deps.constants.assistantName,
    );

    let selectedMessages =
      missedMessages.length > 0 ? [...missedMessages] : [msg];
    let droppedCount = 0;
    if (queueCap && selectedMessages.length > queueCap) {
      droppedCount = selectedMessages.length - queueCap;
      if (queueDrop === 'new') {
        selectedMessages = selectedMessages.slice(0, queueCap);
      } else {
        selectedMessages = selectedMessages.slice(-queueCap);
      }
    }
    if (queueMode === 'followup' || queueMode === 'interrupt') {
      selectedMessages = selectedMessages.length
        ? [selectedMessages[selectedMessages.length - 1] as NewMessage]
        : [];
    }
    let runPreferences: Record<string, any> = {
      ...(deps.state.chatRunPreferences[msg.chat_jid] || {}),
    };
    if (deps.consumeNextRunNoContinue(msg.chat_jid)) {
      runPreferences.nextRunNoContinue = true;
    }
    if (deps.sanitizeRunPreferences) {
      const sanitized = deps.sanitizeRunPreferences(
        msg.chat_jid,
        runPreferences,
      );
      runPreferences = sanitized.runPreferences;
      if (sanitized.noticeText) {
        await deps.sendMessage(msg.chat_jid, sanitized.noticeText);
      }
    }
    const preparedPrompt = prepareInteractivePrompt({
      chatJid: msg.chat_jid,
      selectedMessages,
      queueMode,
      queueDrop,
      droppedCount,
      queueDebounceMs,
      getRecentConversation: deps.getRecentConversation,
      includeRecentConversation: runPreferences.nextRunNoContinue !== true,
      includeTuiMessagesInRecentConversation: false,
    });
    if (!preparedPrompt.finalPrompt.trim()) return null;
    if (group.folder === deps.constants.mainGroupFolder) {
      deps.rememberHeartbeatTarget(msg.chat_jid);
    }

    const latestUserText =
      selectedMessages[selectedMessages.length - 1]?.content || content;
    const coderGateMode = deps.constants.coderGateMode || 'explicit';
    const shouldSuggestCoding =
      !wantsDelegation &&
      isMainGroup &&
      !onboardingGate.active &&
      coderGateMode === 'autosuggest' &&
      deps.isSubstantialCodingTask?.(latestUserText) === true &&
      deps.shouldSuggestCodingEscalation?.(latestUserText) === true;
    if (shouldSuggestCoding) {
      const suggestionRequestId = deps.makeRunId
        ? deps.makeRunId('coder-suggest')
        : `coder-suggest-${Date.now()}`;
      if (deps.presentCoderSuggestion) {
        await deps.presentCoderSuggestion({
          chatJid: msg.chat_jid,
          taskText: latestUserText,
          requestId: suggestionRequestId,
        });
      } else {
        await deps.sendMessage(
          msg.chat_jid,
          `${deps.constants.assistantName}: this sounds like coding work. Use /coder-plan to review it first, or /coder to execute it.`,
        );
      }
      return null;
    }
    const shouldUseCodingWorker = wantsDelegation;

    let finalPrompt = preparedPrompt.finalPrompt;
    if (onboardingGate.active) {
      codingHint = 'none';
      codingRoute = null;
      requestId = deps.makeRunId
        ? deps.makeRunId('onboarding')
        : `onboarding-${Date.now()}`;
      finalPrompt = deps.buildOnboardingInterviewPrompt({
        prompt: finalPrompt,
        latestUserText,
      });
    }
    finalPrompt = maybeInjectUnresolvedWork(msg.chat_jid, finalPrompt);

    deps.logger?.info?.(
      {
        group: group.name,
        messageCount: missedMessages.length,
        selectedMessageCount: selectedMessages.length,
        queueMode,
        queueCap: queueCap || 0,
        queueDrop,
        onboardingGate: onboardingGate.active,
      },
      'Processing message',
    );
    deps.writePromptInputLog?.({
      groupFolder: group.folder,
      requestId,
      chatJid: msg.chat_jid,
      queueMode,
      selectedMessageCount: selectedMessages.length,
      recentContextCount: preparedPrompt.recentConversationCount,
      noContinue: runPreferences.nextRunNoContinue === true,
      latestUserText,
      finalPrompt,
      createdAt: new Date().toISOString(),
    });

    return {
      group,
      content,
      onboardingGate,
      requestId,
      sessionKey: deps.getSessionKeyForChat(msg.chat_jid),
      latestUserText,
      finalPrompt,
      codingHint,
      codingRoute,
      delegationInstruction,
      shouldUseCodingWorker,
      runPreferences,
      timestampToPersist: msg.timestamp,
      workspaceRoot,
    };
  }

  async function processMessageWithOutcome(
    msg: NewMessage,
  ): Promise<ProcessMessageOutcome> {
    const classified = classifyInboundMessage(msg, deps);
    if (!classified) return 'ignored';
    if (classified.origin === 'user') {
      // Mark host activity so the idle curator only runs during true quiet.
      deps.state.lastInboundAt = Date.now();
    }
    if (classified.origin === 'user' && deps.activeChatRuns.has(msg.chat_jid)) {
      enqueueInboundMessage(msg);
      return 'queued';
    }

    const request = await buildDispatchRequest(msg, classified);
    if (!request) return 'ignored';
    if (deps.activeChatRuns.has(msg.chat_jid)) {
      enqueueInboundMessage(msg);
      return 'queued';
    }
    if (
      shouldAutoRouteLongRun({
        isMainGroup: request.group.folder === deps.constants.mainGroupFolder,
        onboardingActive: request.onboardingGate.active,
        content: request.content,
        latestUserText: request.latestUserText,
        shouldUseCodingWorker: request.shouldUseCodingWorker,
        deps,
      })
    ) {
      await startDurableLongRun({
        chatJid: msg.chat_jid,
        prompt: request.finalPrompt,
        notice: "Started long run <id>. I'll post the result here.",
        sourceRequestId: request.requestId,
        source: 'auto-route',
      });
      return 'started';
    }

    await executeDispatchRun({
      chatJid: msg.chat_jid,
      group: request.group,
      sessionKey: request.sessionKey,
      requestId: request.requestId,
      latestUserText: request.latestUserText,
      finalPrompt: request.finalPrompt,
      codingHint: request.codingHint,
      codingRoute: request.codingRoute,
      delegationInstruction: request.delegationInstruction,
      runPreferences: request.runPreferences,
      onboardingGate: request.onboardingGate,
      route: selectRunRoute(request, deps),
      timestampToPersist: request.timestampToPersist,
      onSettled: () => {
        drainQueuedWork(msg.chat_jid);
      },
      workspaceRoot: request.workspaceRoot,
    });
    return 'started';
  }

  async function processMessage(msg: NewMessage): Promise<boolean> {
    await processMessageWithOutcome(msg);
    return true;
  }

  async function runDirectSessionTurn(params: {
    chatJid: string;
    text: string;
    runId: string;
    deliver: boolean;
  }): Promise<{
    runId: string;
    status: 'started' | 'queued' | 'already_running';
  }> {
    const { chatJid, text, runId, deliver } = params;
    if (text.trim().startsWith('/')) {
      const handled = await deps.handleLongRunCommand?.(chatJid, text);
      if (handled) return { runId, status: 'started' };
    }
    const group = deps.state.registeredGroups[chatJid];
    if (!group) {
      throw new Error(`Chat is not registered: ${chatJid}`);
    }
    const existing = deps.activeChatRuns.get(chatJid);
    if (existing) {
      const queue = deps.tuiMessageQueue.get(chatJid) ?? [];
      queue.push({ text, runId, deliver });
      const TUI_QUEUE_CAP = 50;
      while (queue.length > TUI_QUEUE_CAP) queue.shift();
      deps.tuiMessageQueue.set(chatJid, queue);
      return { runId: existing.requestId, status: 'queued' };
    }
    const onboardingGate = deps.resolveMainOnboardingGate(chatJid);
    const sessionKey = deps.getSessionKeyForChat(chatJid);
    deps.persistTuiUserHistory?.(chatJid, text, runId);
    let runPreferences: Record<string, any> = {
      ...(deps.state.chatRunPreferences[chatJid] || {}),
    };
    if (deps.consumeNextRunNoContinue(chatJid)) {
      runPreferences.nextRunNoContinue = true;
    }
    if (deps.sanitizeRunPreferences) {
      const sanitized = deps.sanitizeRunPreferences(chatJid, runPreferences);
      runPreferences = sanitized.runPreferences;
      if (sanitized.noticeText) {
        await deps.sendMessage(chatJid, sanitized.noticeText);
      }
    }
    const timestamp = new Date().toISOString();
    const preparedPrompt = prepareInteractivePrompt({
      chatJid,
      selectedMessages: [
        {
          id: `${runId}:user`,
          chat_jid: chatJid,
          sender: '__fft_tui__',
          sender_name: deps.constants.tuiSenderName,
          content: text,
          timestamp,
          is_from_me: 0,
        },
      ],
      queueMode: 'collect',
      queueDrop: 'old',
      droppedCount: 0,
      queueDebounceMs: 0,
      getRecentConversation: deps.getRecentConversation,
      includeRecentConversation: runPreferences.nextRunNoContinue !== true,
      includeTuiMessagesInRecentConversation: true,
    });
    const promptBase = onboardingGate.active
      ? deps.buildOnboardingInterviewPrompt({
          prompt: preparedPrompt.finalPrompt,
          latestUserText: text,
        })
      : preparedPrompt.finalPrompt;
    const prompt = maybeInjectUnresolvedWork(chatJid, promptBase);
    deps.writePromptInputLog?.({
      groupFolder: group.folder,
      requestId: runId,
      chatJid,
      queueMode: 'collect',
      selectedMessageCount: 1,
      recentContextCount: preparedPrompt.recentConversationCount,
      noContinue: runPreferences.nextRunNoContinue === true,
      latestUserText: text,
      finalPrompt: prompt,
      createdAt: new Date().toISOString(),
    });
    void (async () => {
      await executeDispatchRun({
        chatJid,
        group,
        sessionKey,
        requestId: runId,
        latestUserText: text,
        finalPrompt: prompt,
        codingHint: 'none',
        codingRoute: null,
        delegationInstruction: null,
        runPreferences,
        onboardingGate,
        route: 'agent',
        deliverToChat: deliver,
        onSettled: () => {
          drainQueuedWork(chatJid);
        },
      });
    })();
    return { runId, status: 'started' };
  }

  return {
    processMessage,
    runDirectSessionTurn,
  };
}
