import type {
  RunPipeline,
  PipelineDispatchRequest,
  PreparedRun,
  RunOutput,
} from './run-pipeline.js';
import type { RegisteredGroup, ScheduledTask } from '../types.js';

export interface CronPipelineDeps {
  state: {
    registeredGroups: Record<string, RegisteredGroup>;
  };
  constants: {
    mainGroupFolder: string;
    mainWorkspaceDir?: string;
  };
  runContainerAgent: (
    group: RegisteredGroup,
    input: {
      prompt: string;
      groupFolder: string;
      chatJid: string;
      isMain: boolean;
      isScheduledTask?: boolean;
      noContinue?: boolean;
      effectiveTimezone?: string;
    },
    abortSignal?: AbortSignal,
  ) => Promise<{
    status: 'success' | 'error';
    result?: string;
    error?: string;
    toolExecutions?: unknown[];
  }>;
  deliverTaskOutcome: (
    task: ScheduledTask,
    hadError: boolean,
    result: string | null,
    deps: unknown,
  ) => Promise<void>;
  runEvaluatorPass?: (ctx: {
    runType: string;
    originalTask: string;
    agentOutput: string;
    durationMs: number;
    toolsInvoked: number;
    group: RegisteredGroup;
    chatJid: string;
    isMain?: boolean;
    workspaceDir?: string;
    startedAtMs?: number;
    abortSignal?: AbortSignal;
  }) => Promise<{
    pass: boolean;
    score: number;
    issues: string[];
    feedback: string;
    skipped: boolean;
    skippedReason?: string;
  }>;
  updateTaskAfterRun?: (params: {
    id: string;
    nextRun: string | null;
    lastResult: string;
    status: string;
    consecutiveErrors: number;
  }) => void;
  logger?: {
    info?: (payload: unknown, message?: string) => void;
    error?: (payload: unknown, message?: string) => void;
    warn?: (payload: unknown, message?: string) => void;
  };
}

export class CronPipeline implements RunPipeline {
  constructor(private deps: CronPipelineDeps) {}

  async prepare(request: PipelineDispatchRequest): Promise<PreparedRun> {
    const abortController = request.abortController || new AbortController();

    return {
      requestId: request.requestId,
      chatJid: request.chatJid,
      sessionKey: request.sessionKey,
      groupFolder: request.groupFolder,
      abortController,
      activeRunEntry: {
        chatJid: request.chatJid,
        startedAt: Date.now(),
        requestId: request.requestId,
        abortController,
      },
    };
  }

  async execute(prepared: PreparedRun): Promise<RunOutput> {
    // Cron execution is handled via runScheduledTask - this is called by the dispatcher
    throw new Error(
      'CronPipeline.execute should not be called directly; use runScheduledTask instead',
    );
  }

  async runScheduledTask(
    request: PipelineDispatchRequest,
    task: ScheduledTask,
  ): Promise<RunOutput> {
    const group = this.deps.state.registeredGroups[request.groupFolder];
    if (!group) {
      return {
        ok: false,
        result: null,
        streamed: false,
      };
    }

    const isMain = request.groupFolder === this.deps.constants.mainGroupFolder;
    const startedAt = Date.now();

    try {
      const output = await this.deps.runContainerAgent(
        group,
        {
          prompt: task.prompt,
          groupFolder: task.group_folder,
          chatJid: task.chat_jid,
          isMain,
          isScheduledTask: true,
        },
        request.abortController?.signal,
      );

      if (output.status === 'error') {
        return {
          ok: false,
          result: null,
          streamed: false,
        };
      }

      return {
        ok: true,
        result: output.result || null,
        streamed: false,
      };
    } catch (err) {
      return {
        ok: false,
        result: null,
        streamed: false,
      };
    }
  }

  async deliver(output: RunOutput, prepared: PreparedRun): Promise<void> {
    // Cron delivery is handled separately in the cron service
    throw new Error('CronPipeline.deliver should not be called directly');
  }
}
