import type { NewMessage } from '../types.js';
import type { CodingWorkerResult } from '../coding-orchestrator.js';

// ---------------------------------------------------------------------------
// Shared pipeline types
// ---------------------------------------------------------------------------

/**
 * Context for a prepared run — produced by pipeline.prepare() and consumed
 * by pipeline.execute().
 */
export interface PreparedRun {
  requestId: string;
  chatJid: string;
  sessionKey: string;
  groupFolder: string;
  abortController: AbortController;
  // Track active run in global state maps
  activeRunEntry: {
    chatJid: string;
    startedAt: number;
    requestId: string;
    abortController: AbortController;
  };
}

/**
 * Output from pipeline.execute() — passed to pipeline.deliver().
 */
export interface RunOutput {
  ok: boolean;
  result: string | null;
  streamed: boolean;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    provider?: string;
    model?: string;
  };
  suppressUserDelivery?: boolean;
  controlPlaneStatus?: 'verification_failed';
  // For coding runs, additional metadata
  codingWorkerResult?: CodingWorkerResult;
  changedFiles?: string[];
  testsRun?: string[];
  commandsRun?: string[];
  worktreePath?: string;
}

/**
 * The canonical pipeline interface. Each pipeline implements prepare →
 * execute → deliver to handle one category of run (chat, coding, cron).
 */
export interface RunPipeline {
  /**
   * Build the execution context and register the run in active state maps.
   */
  prepare(request: PipelineDispatchRequest): Promise<PreparedRun>;

  /**
   * Execute the run (agent call, container, etc.) and return output.
   */
  execute(prepared: PreparedRun): Promise<RunOutput>;

  /**
   * Deliver the result to the user (Telegram, TUI, persistence).
   */
  deliver(output: RunOutput, prepared: PreparedRun): Promise<void>;
}

/**
 * Unified request shape accepted by PipelineDispatcher. Covers chat, coding,
 * and cron/scheduled task variants.
 */
export interface PipelineDispatchRequest {
  // Common fields
  requestId: string;
  chatJid: string;
  sessionKey: string;
  groupFolder: string;
  runType: 'chat' | 'coding' | 'cron' | 'scheduled' | 'subagent';

  // Chat-specific
  prompt?: string;
  latestUserText?: string;
  codingHint?: unknown;

  // Coding-specific
  taskText?: string;
  config?: {
    toolMode: 'read_only' | 'full';
    isSubagent: boolean;
    workspaceMode: 'ephemeral_worktree' | 'read_only';
  };
  delegationInstruction?: string | null;
  allowFanout?: boolean;
  workspaceRoot?: string;

  // Cron/scheduled-specific
  taskId?: string;

  // Shared
  runtimePrefs?: Record<string, unknown>;
  abortController?: AbortController;
  isMain?: boolean;
}
