import type {
  RunPipeline,
  PipelineDispatchRequest,
  PreparedRun,
  RunOutput,
} from './run-pipeline.js';
import type { FinalizeCompletedRunParams } from '../message-dispatch.js';
import type { RegisteredGroup } from '../types.js';

export interface ChatPipelineDeps {
  state: {
    registeredGroups: Record<string, RegisteredGroup>;
    chatRunPreferences: Record<string, Record<string, unknown>>;
    lastAgentTimestamp?: Record<string, string>;
  };
  constants: {
    assistantName: string;
    mainGroupFolder: string;
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
  runAgent: (
    group: RegisteredGroup,
    prompt: string,
    chatJid: string,
    codingHint: unknown,
    requestId: string,
    runtimePrefs: Record<string, unknown>,
    options: Record<string, unknown>,
    abortSignal: AbortSignal,
  ) => Promise<{
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
  }>;
  finalizeCompletedRun: (params: FinalizeCompletedRunParams) => Promise<void>;
  emitTuiChatEvent: (payload: {
    runId: string;
    sessionKey: string;
    state: 'message' | 'final' | 'aborted';
    message?: { role: 'user' | 'assistant'; content: string };
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
    phase: 'start' | 'end';
    detail: 'running' | 'streamed' | 'complete' | 'aborted';
  }) => void;
  setTyping: (chatJid: string, typing: boolean) => Promise<void>;
  getSessionKeyForChat: (chatJid: string) => string;
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
  persistAssistantHistory: (
    chatJid: string,
    text: string,
    runId?: string,
  ) => string | void;
  persistLastAgentTimestamp?: (chatJid: string, timestamp: string) => void;
  deleteTelegramPreviewMessage: (
    chatJid: string,
    messageId: number,
  ) => Promise<void>;
  finalizeTelegramPreviewMessage: (
    chatJid: string,
    messageId: number,
    text: string,
  ) => Promise<boolean>;
  sendAgentResultMessage: (
    chatJid: string,
    text: string,
    opts?: { prefixWhatsApp?: boolean },
  ) => Promise<boolean>;
  isTelegramJid: (chatJid: string) => boolean;
  prepareTelegramCompletionState?: (params: {
    chatJid: string;
    runId: string;
    result: string | null;
  }) => Promise<{
    externallyCompleted: boolean;
    previewState: null;
  }>;
  consumeTelegramHostCompletedRun: (chatJid: string, runId: string) => boolean;
  consumeTelegramHostStreamState: (chatJid: string, runId: string) => null;
  resolveTelegramStreamCompletionState: (params: {
    externallyCompleted: boolean;
    previewState: null;
  }) => {
    effectiveStreamed: boolean;
    messagePreviewState: null;
  };
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
  logger?: {
    info?: (payload: unknown, message?: string) => void;
    error?: (payload: unknown, message?: string) => void;
    warn?: (payload: unknown, message?: string) => void;
  };
}

export class ChatPipeline implements RunPipeline {
  constructor(private deps: ChatPipelineDeps) {}

  async prepare(request: PipelineDispatchRequest): Promise<PreparedRun> {
    const group = this.deps.state.registeredGroups[request.groupFolder];
    const abortController = request.abortController || new AbortController();

    const activeRunEntry = {
      chatJid: request.chatJid,
      startedAt: Date.now(),
      requestId: request.requestId,
      abortController,
    };

    this.deps.activeChatRuns.set(request.chatJid, activeRunEntry);
    this.deps.activeChatRunsById.set(request.requestId, activeRunEntry);

    this.deps.noteRunStarted?.({
      chatJid: request.chatJid,
      requestId: request.requestId,
      latestUserText: request.latestUserText || '',
    });

    this.deps.emitTuiChatEvent({
      runId: request.requestId,
      sessionKey: request.sessionKey,
      state: 'message',
      message: { role: 'user', content: request.latestUserText || '' },
    });

    this.deps.emitTuiAgentEvent({
      runId: request.requestId,
      sessionKey: request.sessionKey,
      phase: 'start',
      detail: 'running',
    });

    await this.deps.setTyping(request.chatJid, true);

    this.deps.logger?.info?.(
      {
        group: group?.name,
        promptLength: request.prompt?.length || 0,
        route: 'agent',
      },
      'Starting chat run via ChatPipeline',
    );

    return {
      requestId: request.requestId,
      chatJid: request.chatJid,
      sessionKey: request.sessionKey,
      groupFolder: request.groupFolder,
      abortController,
      activeRunEntry,
    };
  }

  async execute(prepared: PreparedRun): Promise<RunOutput> {
    // Chat execution is handled via runAgent - this is called by the dispatcher
    throw new Error(
      'ChatPipeline.execute should not be called directly; use runChatTurn instead',
    );
  }

  async runChatTurn(request: PipelineDispatchRequest): Promise<RunOutput> {
    const group = this.deps.state.registeredGroups[request.groupFolder];
    const abortController = request.abortController || new AbortController();

    const activeRunEntry = {
      chatJid: request.chatJid,
      startedAt: Date.now(),
      requestId: request.requestId,
      abortController,
    };

    this.deps.activeChatRuns.set(request.chatJid, activeRunEntry);
    this.deps.activeChatRunsById.set(request.requestId, activeRunEntry);

    try {
      const result = await this.deps.runAgent(
        group,
        request.prompt || '',
        request.chatJid,
        request.codingHint,
        request.requestId,
        request.runtimePrefs || {},
        {},
        abortController.signal,
      );

      return {
        ok: result.ok,
        result: result.result,
        streamed: result.streamed,
        usage: result.usage,
        suppressUserDelivery: result.suppressUserDelivery,
        controlPlaneStatus: result.controlPlaneStatus,
      };
    } finally {
      await this.deps.setTyping(request.chatJid, false);
      if (this.deps.activeChatRuns.get(request.chatJid) === activeRunEntry) {
        this.deps.activeChatRuns.delete(request.chatJid);
      }
      this.deps.activeChatRunsById.delete(request.requestId);
      this.deps.noteRunSettled?.({
        chatJid: request.chatJid,
        requestId: request.requestId,
        ok: true,
        result: null,
      });
    }
  }

  async deliver(output: RunOutput, prepared: PreparedRun): Promise<void> {
    const completionState =
      this.deps.isTelegramJid(prepared.chatJid) &&
      this.deps.prepareTelegramCompletionState
        ? await this.deps.prepareTelegramCompletionState({
            chatJid: prepared.chatJid,
            runId: prepared.requestId,
            result: output.result,
          })
        : {
            externallyCompleted: this.deps.isTelegramJid(prepared.chatJid)
              ? this.deps.consumeTelegramHostCompletedRun(
                  prepared.chatJid,
                  prepared.requestId,
                )
              : false,
            previewState: this.deps.isTelegramJid(prepared.chatJid)
              ? this.deps.consumeTelegramHostStreamState(
                  prepared.chatJid,
                  prepared.requestId,
                )
              : null,
          };

    const telegramCompletionState =
      this.deps.resolveTelegramStreamCompletionState({
        externallyCompleted: completionState.externallyCompleted,
        previewState: completionState.previewState,
      });

    await this.deps.finalizeCompletedRun({
      chatJid: prepared.chatJid,
      runId: prepared.requestId,
      sessionKey: prepared.sessionKey,
      result: output.result,
      streamed: telegramCompletionState.effectiveStreamed,
      usage: output.usage,
      abortSignal: prepared.abortController.signal,
      suppressUserDelivery: output.suppressUserDelivery,
      controlPlaneStatus: output.controlPlaneStatus,
      externallyCompleted: completionState.externallyCompleted,
      telegramPreviewState: telegramCompletionState.messagePreviewState,
      updateChatUsage: this.deps.updateChatUsage,
      persistLastAgentTimestamp: this.deps.persistLastAgentTimestamp,
      persistAssistantHistory: this.deps.persistAssistantHistory,
      deleteTelegramPreviewMessage: this.deps.deleteTelegramPreviewMessage,
      finalizeTelegramPreviewMessage: this.deps.finalizeTelegramPreviewMessage,
      sendAgentResultMessage: this.deps.sendAgentResultMessage,
      emitTuiChatEvent: this.deps.emitTuiChatEvent,
      emitTuiAgentEvent: this.deps.emitTuiAgentEvent,
    });
  }
}
