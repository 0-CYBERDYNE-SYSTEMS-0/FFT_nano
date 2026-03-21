import type { TelegramMessagePreviewState } from './telegram-streaming.js';
import type { NewMessage } from './types.js';

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
  persistAssistantHistory: (chatJid: string, text: string, runId?: string) => string | void;
  deleteTelegramPreviewMessage: (chatJid: string, messageId: number) => Promise<void>;
  finalizeTelegramPreviewMessage: (
    chatJid: string,
    messageId: number,
    text: string,
  ) => Promise<boolean>;
  sendAgentResultMessage: (
    chatJid: string,
    text: string,
    opts?: { prefixWhatsApp?: boolean },
  ) => Promise<void>;
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

export interface MessageDispatcherDeps {
  state: {
    registeredGroups: Record<string, any>;
    chatRunPreferences: Record<string, Record<string, any>>;
    lastAgentTimestamp?: Record<string, string>;
  };
  constants: {
    assistantName: string;
    mainGroupFolder: string;
    triggerPattern: RegExp;
    tuiSenderName: string;
    mainWorkspaceDir?: string;
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
    }
  >;
  tuiMessageQueue: Map<string, Array<{ text: string; runId: string; deliver: boolean }>>;
  sendMessage: (chatJid: string, text: string) => Promise<void>;
  setTyping: (chatJid: string, typing: boolean) => Promise<void>;
  getMessagesSince: (chatJid: string, sinceTimestamp: string, assistantName: string) => NewMessage[];
  getSessionKeyForChat: (chatJid: string) => string;
  resolveMainOnboardingGate: (chatJid: string) => { active: boolean };
  buildOnboardingInterviewPrompt: (params: { prompt: string; latestUserText: string }) => string;
  extractOnboardingCompletion: (text: string | null) => { text: string | null; completed: boolean };
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
  ) => Promise<{ result: string | null; streamed: boolean; ok: boolean; usage?: RunUsage }>;
  consumeNextRunNoContinue: (chatJid: string) => boolean;
  updateChatUsage: (chatJid: string, usage?: RunUsage) => void;
  persistAssistantHistory: (chatJid: string, text: string, runId?: string) => string | void;
  deleteTelegramPreviewMessage: (chatJid: string, messageId: number) => Promise<void>;
  finalizeTelegramPreviewMessage: (
    chatJid: string,
    messageId: number,
    text: string,
  ) => Promise<boolean>;
  sendAgentResultMessage: (
    chatJid: string,
    text: string,
    opts?: { prefixWhatsApp?: boolean },
  ) => Promise<void>;
  emitTuiChatEvent: (payload: any) => void;
  emitTuiAgentEvent: (payload: any) => void;
  isTelegramJid: (chatJid: string) => boolean;
  consumeTelegramHostCompletedRun: (chatJid: string, runId: string) => boolean;
  consumeTelegramHostStreamState: (chatJid: string, runId: string) => TelegramMessagePreviewState | null;
  resolveTelegramStreamCompletionState: (params: {
    externallyCompleted: boolean;
    previewState: TelegramMessagePreviewState | null;
  }) => {
    effectiveStreamed: boolean;
    messagePreviewState: TelegramMessagePreviewState | null;
  };
  finalizeCompletedRun: (params: FinalizeCompletedRunParams) => Promise<void>;
  parseDelegationTrigger?: (text: string) => { hint: string; instruction: string | null };
  isCoderDelegationCommand?: (content: string) => boolean;
  onboardingCommandBlockedText?: () => string;
  makeRunId?: (prefix: string) => string;
  logger?: { info?: (payload: unknown, message?: string) => void };
  persistTuiUserHistory?: (chatJid: string, text: string, runId: string) => void;
}

export async function finalizeCompletedRun(
  params: FinalizeCompletedRunParams,
): Promise<void> {
  params.updateChatUsage(params.chatJid, params.usage);
  if (params.timestampToPersist) {
    params.persistLastAgentTimestamp?.(params.chatJid, params.timestampToPersist);
  }

  if (params.abortSignal.aborted) {
    if (params.telegramPreviewState) {
      await params.deleteTelegramPreviewMessage(
        params.chatJid,
        params.telegramPreviewState.messageId,
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

  if (params.result) {
    params.persistAssistantHistory(params.chatJid, params.result, params.runId);
    let finalizedPreview = false;
    if (!params.externallyCompleted && params.telegramPreviewState) {
      finalizedPreview = await params.finalizeTelegramPreviewMessage(
        params.chatJid,
        params.telegramPreviewState.messageId,
        params.result,
      );
    }
    if (
      params.deliverToChat !== false &&
      !params.externallyCompleted &&
      (!params.streamed || (params.telegramPreviewState && !finalizedPreview))
    ) {
      await params.sendAgentResultMessage(params.chatJid, params.result, {
        prefixWhatsApp: true,
      });
    }
    params.emitTuiChatEvent({
      runId: params.runId,
      sessionKey: params.sessionKey,
      state: 'final',
      message: { role: 'assistant', content: params.result },
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
  }) => Promise<{ runId: string; status: 'started' | 'queued' | 'already_running' }>;
} {
  async function processMessage(msg: NewMessage): Promise<boolean> {
    const group = deps.state.registeredGroups[msg.chat_jid];
    if (!group) return true;

    const content = msg.content.trim();
    const isMainGroup = group.folder === deps.constants.mainGroupFolder;
    const queuePrefs = deps.state.chatRunPreferences[msg.chat_jid] || {};
    const queueMode = queuePrefs.queueMode || 'collect';
    const queueDrop = queuePrefs.queueDrop || 'old';
    const queueCap =
      typeof queuePrefs.queueCap === 'number' && queuePrefs.queueCap > 0
        ? Math.floor(queuePrefs.queueCap)
        : undefined;
    const queueDebounceMs =
      typeof queuePrefs.queueDebounceMs === 'number' && queuePrefs.queueDebounceMs > 0
        ? Math.floor(queuePrefs.queueDebounceMs)
        : 0;
    const freeChatEnabled = queuePrefs.freeChat === true;
    if (!isMainGroup && !freeChatEnabled && !deps.constants.triggerPattern.test(content)) return true;

    const onboardingGate = deps.resolveMainOnboardingGate(msg.chat_jid);
    if (onboardingGate.active && deps.isCoderDelegationCommand?.(content)) {
      await deps.sendMessage(msg.chat_jid, deps.onboardingCommandBlockedText?.() || 'Blocked');
      return true;
    }

    let codingHint: any = isMainGroup
      ? 'auto'
      : 'none';
    let requestId = deps.makeRunId ? deps.makeRunId('chat') : `chat-${Date.now()}`;
    let delegationInstruction: string | null = null;
    let delegationMarker: string | null = null;

    const stripped = content.replace(deps.constants.triggerPattern, '').trimStart();
    const parsedTrigger = onboardingGate.active || !deps.parseDelegationTrigger
      ? { hint: 'none' as const, instruction: null }
      : deps.parseDelegationTrigger(stripped);
    const wantsDelegation = parsedTrigger.hint !== 'none';

    if (wantsDelegation && !isMainGroup) {
      await deps.sendMessage(
        msg.chat_jid,
        `${deps.constants.assistantName}: coder delegation is only available in the main/admin chat for safety.`,
      );
      return true;
    }

    if (wantsDelegation) {
      codingHint = parsedTrigger.hint;
      delegationInstruction = parsedTrigger.instruction;
      delegationMarker =
        codingHint === 'force_delegate_plan'
          ? '[CODER PLAN REQUEST]'
          : '[CODER EXECUTE REQUEST]';
      requestId = `coder-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const startMessageBody =
        codingHint === 'force_delegate_plan'
          ? `Starting coder plan run (${requestId})...`
          : `Starting coder run (${requestId})...`;
      await deps.sendMessage(msg.chat_jid, startMessageBody);
    }

    const sinceTimestamp = deps.state.lastAgentTimestamp?.[msg.chat_jid] || '';
    const missedMessages = deps.getMessagesSince(
      msg.chat_jid,
      sinceTimestamp,
      deps.constants.assistantName,
    );

    let selectedMessages = [...missedMessages];
    let droppedCount = 0;
    if (queueCap && selectedMessages.length > queueCap) {
      droppedCount = selectedMessages.length - queueCap;
      if (queueDrop === 'new') selectedMessages = selectedMessages.slice(0, queueCap);
      else selectedMessages = selectedMessages.slice(-queueCap);
    }
    if (queueMode === 'followup' || queueMode === 'interrupt') {
      selectedMessages = selectedMessages.length ? [selectedMessages[selectedMessages.length - 1] as NewMessage] : [];
    }
    const lines = selectedMessages.map((m) => `[${m.timestamp}] ${m.sender_name}: ${m.content}`);
    const prompt = lines.join('\n');
    if (!prompt) return true;
    if (group.folder === deps.constants.mainGroupFolder) {
      deps.rememberHeartbeatTarget(msg.chat_jid);
    }
    const sessionKey = deps.getSessionKeyForChat(msg.chat_jid);
    const latestUserText = selectedMessages[selectedMessages.length - 1]?.content || content;
    let finalPrompt =
      codingHint !== 'none' && delegationMarker
        ? delegationInstruction
          ? `${prompt}\n\n${delegationMarker}\n${delegationInstruction}`
          : `${prompt}\n\n${delegationMarker}`
        : prompt;
    if (queueMode === 'interrupt') {
      finalPrompt =
        `${finalPrompt}\n\n[QUEUE MODE: interrupt]\n` +
        'Prioritize the latest message and ignore stale unresolved asks unless explicitly requested.';
    } else if (queueMode === 'steer') {
      finalPrompt =
        `${finalPrompt}\n\n[QUEUE MODE: steer]\n` +
        'Respect full context, but prioritize the user’s newest intent and provide concise steering updates.';
    } else if (queueMode === 'steer-backlog') {
      finalPrompt =
        `${finalPrompt}\n\n[QUEUE MODE: steer-backlog]\n` +
        'Process backlog context and prioritize the newest request first.';
    }
    if (queueDrop === 'summarize' && droppedCount > 0) {
      finalPrompt =
        `${finalPrompt}\n\n[QUEUE NOTE]\n` +
        `Older backlog truncated by queue cap (${droppedCount} message(s) dropped); summarize assumptions before acting.`;
    }
    if (queueDebounceMs > 0) {
      finalPrompt =
        `${finalPrompt}\n\n[QUEUE NOTE]\n` +
        `Debounce preference is ${queueDebounceMs}ms; keep responses concise and account for rapid bursts.`;
    }
    if (onboardingGate.active) {
      codingHint = 'none';
      requestId = deps.makeRunId ? deps.makeRunId('onboarding') : `onboarding-${Date.now()}`;
      finalPrompt = deps.buildOnboardingInterviewPrompt({
        prompt,
        latestUserText,
      });
    }
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
    if (
      (codingHint === 'force_delegate_execute' || codingHint === 'force_delegate_plan') &&
      requestId
    ) {
      deps.activeCoderRuns.set(requestId, {
        requestId,
        mode: codingHint === 'force_delegate_plan' ? 'plan' : 'execute',
        chatJid: msg.chat_jid,
        groupName: group.name,
        startedAt: Date.now(),
      });
    }
    const runPreferences: Record<string, any> = {
      ...(deps.state.chatRunPreferences[msg.chat_jid] || {}),
    };
    if (deps.consumeNextRunNoContinue(msg.chat_jid)) {
      runPreferences.nextRunNoContinue = true;
    }
    let result: string | null = null;
    let streamed = false;
    let ok = false;
    let usage: RunUsage | undefined;
    const abortController = new AbortController();
    const activeRun = {
      chatJid: msg.chat_jid,
      startedAt: Date.now(),
      requestId,
      abortController,
    };
    deps.activeChatRuns.set(msg.chat_jid, activeRun);
    deps.activeChatRunsById.set(requestId, activeRun);
    deps.emitTuiChatEvent({
      runId: requestId,
      sessionKey,
      state: 'message',
      message: { role: 'user', content: latestUserText },
    });
    deps.emitTuiAgentEvent({
      runId: requestId,
      sessionKey,
      phase: 'start',
      detail: 'running',
    });
    await deps.setTyping(msg.chat_jid, true);
    try {
      const run = await deps.runAgent(
        group,
        finalPrompt,
        msg.chat_jid,
        codingHint,
        requestId,
        runPreferences,
        {},
        abortController.signal,
      );
      result = run.result;
      streamed = run.streamed;
      ok = run.ok;
      usage = run.usage;
    } finally {
      await deps.setTyping(msg.chat_jid, false);
      if (deps.activeChatRuns.get(msg.chat_jid) === activeRun) {
        deps.activeChatRuns.delete(msg.chat_jid);
      }
      deps.activeChatRunsById.delete(requestId);
      deps.activeCoderRuns.delete(requestId);
    }
    if (ok && onboardingGate.active) {
      const completion = deps.extractOnboardingCompletion(result);
      result = completion.text;
      if (completion.completed) {
        deps.completeMainWorkspaceOnboarding({ workspaceDir: deps.constants.mainWorkspaceDir });
        if (!result) result = 'Onboarding complete.';
        deps.logger?.info?.(
          { chatJid: msg.chat_jid, requestId },
          'Completed main workspace onboarding from gated interview run',
        );
      }
    }
    if (ok) {
      const externallyCompleted = deps.isTelegramJid(msg.chat_jid)
        ? deps.consumeTelegramHostCompletedRun(msg.chat_jid, requestId)
        : false;
      const telegramStreamState = deps.isTelegramJid(msg.chat_jid)
        ? deps.consumeTelegramHostStreamState(msg.chat_jid, requestId)
        : null;
      const telegramCompletionState = deps.resolveTelegramStreamCompletionState({
        externallyCompleted,
        previewState: telegramStreamState,
      });
      streamed = telegramCompletionState.effectiveStreamed;
      const telegramPreviewState = telegramCompletionState.messagePreviewState;
      await deps.finalizeCompletedRun({
        chatJid: msg.chat_jid,
        runId: requestId,
        sessionKey,
        result,
        streamed,
        usage,
        abortSignal: abortController.signal,
        externallyCompleted,
        telegramPreviewState,
        timestampToPersist: msg.timestamp,
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
    } else {
      deps.emitTuiChatEvent({
        runId: requestId,
        sessionKey,
        state: 'error',
        errorMessage: 'Run failed',
      });
      deps.emitTuiAgentEvent({
        runId: requestId,
        sessionKey,
        phase: 'error',
        detail: 'run failed',
      });
    }
    return true;
  }

  async function runDirectSessionTurn(params: {
    chatJid: string;
    text: string;
    runId: string;
    deliver: boolean;
  }): Promise<{ runId: string; status: 'started' | 'queued' | 'already_running' }> {
    const { chatJid, text, runId, deliver } = params;
    const group = deps.state.registeredGroups[chatJid];
    if (!group) {
      throw new Error(`Chat is not registered: ${chatJid}`);
    }
    const existing = deps.activeChatRuns.get(chatJid);
    if (existing) {
      const queue = deps.tuiMessageQueue.get(chatJid) ?? [];
      queue.push({ text, runId, deliver });
      deps.tuiMessageQueue.set(chatJid, queue);
      return { runId: existing.requestId, status: 'queued' };
    }
    const onboardingGate = deps.resolveMainOnboardingGate(chatJid);
    const sessionKey = deps.getSessionKeyForChat(chatJid);
    deps.persistTuiUserHistory?.(chatJid, text, runId);
    deps.emitTuiChatEvent({
      runId,
      sessionKey,
      state: 'message',
      message: { role: 'user', content: text },
    });
    deps.emitTuiAgentEvent({
      runId,
      sessionKey,
      phase: 'start',
      detail: 'running',
    });
    const runPreferences: Record<string, any> = {
      ...(deps.state.chatRunPreferences[chatJid] || {}),
    };
    if (deps.consumeNextRunNoContinue(chatJid)) {
      runPreferences.nextRunNoContinue = true;
    }
    const directPrompt = `[${new Date().toISOString()}] ${deps.constants.tuiSenderName}: ${text}`;
    const prompt = onboardingGate.active
      ? deps.buildOnboardingInterviewPrompt({
          prompt: directPrompt,
          latestUserText: text,
        })
      : directPrompt;
    const abortController = new AbortController();
    const activeRun = {
      chatJid,
      startedAt: Date.now(),
      requestId: runId,
      abortController,
    };
    deps.activeChatRuns.set(chatJid, activeRun);
    deps.activeChatRunsById.set(runId, activeRun);
    void (async () => {
      let result: string | null = null;
      let streamed = false;
      let ok = false;
      let usage: RunUsage | undefined;
      await deps.setTyping(chatJid, true);
      try {
        const run = await deps.runAgent(
          group,
          prompt,
          chatJid,
          'none',
          runId,
          runPreferences,
          {},
          abortController.signal,
        );
        result = run.result;
        streamed = run.streamed;
        ok = run.ok;
        usage = run.usage;
      } finally {
        await deps.setTyping(chatJid, false);
        if (deps.activeChatRuns.get(chatJid) === activeRun) {
          deps.activeChatRuns.delete(chatJid);
        }
        deps.activeChatRunsById.delete(runId);
        const tuiQueue = deps.tuiMessageQueue.get(chatJid);
        const nextTuiMessage = tuiQueue?.shift();
        if (nextTuiMessage) {
          if (tuiQueue?.length === 0) deps.tuiMessageQueue.delete(chatJid);
          void runDirectSessionTurn({
            chatJid,
            text: nextTuiMessage.text,
            runId: nextTuiMessage.runId,
            deliver: nextTuiMessage.deliver,
          });
        }
      }
      if (!ok) {
        deps.emitTuiChatEvent({
          runId,
          sessionKey,
          state: 'error',
          errorMessage: 'Run failed',
        });
        deps.emitTuiAgentEvent({
          runId,
          sessionKey,
          phase: 'error',
          detail: 'run failed',
        });
        return;
      }
      if (onboardingGate.active) {
        const completion = deps.extractOnboardingCompletion(result);
        result = completion.text;
        if (completion.completed) {
          deps.completeMainWorkspaceOnboarding({ workspaceDir: deps.constants.mainWorkspaceDir });
          if (!result) result = 'Onboarding complete.';
          deps.logger?.info?.(
            { chatJid, runId },
            'Completed main workspace onboarding from direct session run',
          );
        }
      }
      const externallyCompleted = deps.isTelegramJid(chatJid)
        ? deps.consumeTelegramHostCompletedRun(chatJid, runId)
        : false;
      const telegramStreamState = deps.isTelegramJid(chatJid)
        ? deps.consumeTelegramHostStreamState(chatJid, runId)
        : null;
      const telegramCompletionState = deps.resolveTelegramStreamCompletionState({
        externallyCompleted,
        previewState: telegramStreamState,
      });
      streamed = telegramCompletionState.effectiveStreamed;
      const telegramPreviewState = telegramCompletionState.messagePreviewState;
      await deps.finalizeCompletedRun({
        chatJid,
        runId,
        sessionKey,
        result,
        streamed,
        usage,
        abortSignal: abortController.signal,
        deliverToChat: deliver,
        externallyCompleted,
        telegramPreviewState,
        updateChatUsage: deps.updateChatUsage,
        persistAssistantHistory: deps.persistAssistantHistory,
        deleteTelegramPreviewMessage: deps.deleteTelegramPreviewMessage,
        finalizeTelegramPreviewMessage: deps.finalizeTelegramPreviewMessage,
        sendAgentResultMessage: deps.sendAgentResultMessage,
        emitTuiChatEvent: deps.emitTuiChatEvent as any,
        emitTuiAgentEvent: deps.emitTuiAgentEvent as any,
      });
    })();
    return { runId, status: 'started' };
  }

  return {
    processMessage,
    runDirectSessionTurn,
  };
}
