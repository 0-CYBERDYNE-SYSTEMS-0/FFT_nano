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
    const pipeline = this.selectPipeline(request);
    const prepared = await pipeline.prepare(request);
    const output = await pipeline.execute(prepared);
    await pipeline.deliver(output, prepared);
  }
}

export type { ChatPipelineDeps, CodingPipelineDeps, CronPipelineDeps };
export type { ChatPipeline } from './chat-pipeline.js';
export type { CodingPipeline } from './coding-pipeline.js';
export type { CronPipeline } from './cron-pipeline.js';
