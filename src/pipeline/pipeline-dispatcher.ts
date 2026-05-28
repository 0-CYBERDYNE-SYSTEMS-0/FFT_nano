import type {
  RunPipeline,
  PipelineDispatchRequest,
  PreparedRun,
  RunOutput,
} from './run-pipeline.js';
import { ChatPipeline } from './chat-pipeline.js';
import { CodingPipeline } from './coding-pipeline.js';
import { CronPipeline } from './cron-pipeline.js';
import type { ChatPipelineDeps } from './chat-pipeline.js';
import type { CodingPipelineDeps } from './coding-pipeline.js';
import type { CronPipelineDeps } from './cron-pipeline.js';
import type {
  CodingWorkerRequest,
  CodingTaskRunResult,
} from '../coding-orchestrator.js';
import type { ScheduledTask } from '../types.js';
import { logger } from '../logger.js';

/**
 * Reconcile contradictory dispatch flags before routing so a request can never
 * silently slip into the wrong pipeline. Returns a normalized request plus any
 * warnings describing corrections that were applied. Pure and side-effect free
 * so it can be unit tested directly.
 */
export function validateDispatchRequest(request: PipelineDispatchRequest): {
  request: PipelineDispatchRequest;
  warnings: string[];
} {
  const warnings: string[] = [];
  const next: PipelineDispatchRequest = { ...request };

  // The config's isSubagent flag is the source of truth for coding-family
  // routing; reconcile runType to it so 'coding'/'subagent' never disagree.
  if (
    (next.runType === 'coding' || next.runType === 'subagent') &&
    next.config
  ) {
    if (next.config.isSubagent && next.runType !== 'subagent') {
      warnings.push(
        "runType 'coding' contradicts config.isSubagent=true; routing as 'subagent'",
      );
      next.runType = 'subagent';
    } else if (!next.config.isSubagent && next.runType === 'subagent') {
      warnings.push(
        "runType 'subagent' contradicts config.isSubagent=false; routing as 'coding'",
      );
      next.runType = 'coding';
    }
  }

  // Coding-family runs require something to act on.
  if (
    (next.runType === 'coding' || next.runType === 'subagent') &&
    !next.taskText &&
    !next.prompt
  ) {
    warnings.push(
      `${next.runType} run has neither taskText nor prompt; falling back to chat`,
    );
    next.runType = 'chat';
  }

  // Scheduled-family runs require a task id to resolve.
  if (
    (next.runType === 'cron' || next.runType === 'scheduled') &&
    !next.taskId
  ) {
    warnings.push(`${next.runType} run is missing taskId`);
  }

  // A chat run carrying a taskId is a mixed signal — taskId is meaningless to
  // chat routing, so drop it rather than let it leak downstream.
  if (next.runType === 'chat' && next.taskId) {
    warnings.push('chat run carried a taskId; clearing it');
    next.taskId = undefined;
  }

  return { request: next, warnings };
}

/**
 * PipelineDispatcher selects the appropriate RunPipeline based on the request
 * type and delegates to it.
 */
export class PipelineDispatcher {
  private chatPipeline: ChatPipeline;
  private codingPipeline: CodingPipeline;
  private cronPipeline: CronPipeline;

  constructor(
    chatDeps: ChatPipelineDeps,
    codingDeps: CodingPipelineDeps,
    cronDeps: CronPipelineDeps,
  ) {
    this.chatPipeline = new ChatPipeline(chatDeps);
    this.codingPipeline = new CodingPipeline(codingDeps);
    this.cronPipeline = new CronPipeline(cronDeps);
  }

  /**
   * Select the correct pipeline for the given request type.
   */
  selectPipeline(request: PipelineDispatchRequest): RunPipeline {
    switch (request.runType) {
      case 'coding':
      case 'subagent':
        return this.codingPipeline;
      case 'cron':
      case 'scheduled':
        return this.cronPipeline;
      case 'chat':
      default:
        return this.chatPipeline;
    }
  }

  /**
   * Get the ChatPipeline for direct execution (chat turns).
   */
  getChatPipeline(): ChatPipeline {
    return this.chatPipeline;
  }

  /**
   * Get the CodingPipeline for direct execution (coding tasks).
   */
  getCodingPipeline(): CodingPipeline {
    return this.codingPipeline;
  }

  /**
   * Get the CronPipeline for direct execution (scheduled tasks).
   */
  getCronPipeline(): CronPipeline {
    return this.cronPipeline;
  }

  /**
   * Dispatch the request through the appropriate pipeline:
   * prepare → execute → deliver
   */
  async dispatch(request: PipelineDispatchRequest): Promise<void> {
    const { request: normalized, warnings } = validateDispatchRequest(request);
    if (warnings.length > 0) {
      logger.warn(
        { requestId: normalized.requestId, warnings },
        'Dispatch request normalized',
      );
    }
    const pipeline = this.selectPipeline(normalized);
    const prepared = await pipeline.prepare(normalized);
    const output = await pipeline.execute(prepared);
    await pipeline.deliver(output, prepared);
  }
}

export type { ChatPipelineDeps, CodingPipelineDeps, CronPipelineDeps };
export type { ChatPipeline } from './chat-pipeline.js';
export type { CodingPipeline } from './coding-pipeline.js';
export type { CronPipeline } from './cron-pipeline.js';
