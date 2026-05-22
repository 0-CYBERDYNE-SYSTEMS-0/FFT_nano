import type {
  RunPipeline,
  PipelineDispatchRequest,
  PreparedRun,
  RunOutput,
} from './run-pipeline.js';
import type { RegisteredGroup } from '../types.js';
import type {
  CodingWorkerRequest,
  CodingTaskRunResult,
} from '../coding-orchestrator.js';

export interface CodingPipelineDeps {
  state: {
    registeredGroups: Record<string, RegisteredGroup>;
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
  createCodingOrchestrator: (deps: {
    activeRuns: Map<string, unknown>;
    runContainerAgent: unknown;
    publishEvent: (event: unknown) => void;
    createEphemeralWorktree?: unknown;
    runEvaluatorPass?: unknown;
  }) => {
    runTask: (request: CodingWorkerRequest) => Promise<CodingTaskRunResult>;
  };
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
  sendAgentResultMessage: (
    chatJid: string,
    text: string,
    opts?: { prefixWhatsApp?: boolean },
  ) => Promise<boolean>;
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
  logger?: {
    info?: (payload: unknown, message?: string) => void;
    error?: (payload: unknown, message?: string) => void;
    warn?: (payload: unknown, message?: string) => void;
  };
}

export class CodingPipeline implements RunPipeline {
  constructor(private deps: CodingPipelineDeps) {}

  async prepare(request: PipelineDispatchRequest): Promise<PreparedRun> {
    const abortController = request.abortController || new AbortController();

    const activeRunEntry = {
      chatJid: request.chatJid,
      startedAt: Date.now(),
      requestId: request.requestId,
      abortController,
    };

    this.deps.activeChatRuns.set(request.chatJid, activeRunEntry);
    this.deps.activeChatRunsById.set(request.requestId, activeRunEntry);

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
    // Coding execution is handled via runCodingTask - this is called by the dispatcher
    throw new Error(
      'CodingPipeline.execute should not be called directly; use runCodingTask instead',
    );
  }

  async runCodingTask(
    request: PipelineDispatchRequest,
    orchestrator: {
      runTask: (request: CodingWorkerRequest) => Promise<CodingTaskRunResult>;
    },
  ): Promise<RunOutput> {
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
      const codingRequest: CodingWorkerRequest = {
        requestId: request.requestId,
        mode: request.config?.toolMode === 'read_only' ? 'plan' : 'execute',
        config: request.config || {
          toolMode: 'full',
          isSubagent: false,
          workspaceMode: 'ephemeral_worktree',
        },
        originChatJid: request.chatJid,
        originGroupFolder: request.groupFolder,
        taskText: request.taskText || '',
        timeoutSeconds: 1800,
        allowFanout: request.allowFanout || false,
        sessionContext: request.prompt || '',
        assistantName: this.deps.constants.assistantName,
        sessionKey: request.sessionKey,
        group,
        workspaceRoot: request.workspaceRoot,
        runtimePrefs:
          request.runtimePrefs as CodingWorkerRequest['runtimePrefs'],
        abortController,
      };

      const result = await orchestrator.runTask(codingRequest);

      return {
        ok: result.ok,
        result: result.result,
        streamed: result.streamed,
        usage: result.usage as RunOutput['usage'],
        codingWorkerResult: result.workerResult,
        changedFiles: result.workerResult?.changedFiles,
        testsRun: result.workerResult?.testsRun,
        commandsRun: result.workerResult?.commandsRun,
        worktreePath: result.workerResult?.worktreePath,
      };
    } finally {
      if (this.deps.activeChatRuns.get(request.chatJid) === activeRunEntry) {
        this.deps.activeChatRuns.delete(request.chatJid);
      }
      this.deps.activeChatRunsById.delete(request.requestId);
    }
  }

  async deliver(output: RunOutput, prepared: PreparedRun): Promise<void> {
    if (output.result) {
      await this.deps.sendAgentResultMessage(prepared.chatJid, output.result, {
        prefixWhatsApp: true,
      });
    }
  }
}
