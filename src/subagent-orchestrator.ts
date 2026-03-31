/**
 * Generalized subagent orchestrator.
 *
 * Spawns typed subagents using the registered type configs from subagent-types.ts.
 * Runs alongside (not replacing) the existing CodingOrchestrator for /coder.
 * Shares the activeCoderRuns Map for unified tracking and abort.
 */

import type {
  RegisteredGroup,
} from './types.js';
import type {
  ContainerInput,
  ContainerOutput,
  ContainerRuntimeEvent,
} from './pi-runner.js';
import type { ActiveCoderRun } from './app-state.js';
import {
  type SubagentTypeConfig,
  type SubagentSpawnRequest,
  type SubagentSpawnResult,
  getSubagentType,
  SUBAGENT_TYPE_REGISTRY,
} from './subagent-types.js';
import { loadSubagentPrompt } from './subagent-prompts.js';
import { createHostEventId } from './runtime/host-events.js';

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

export interface SubagentOrchestratorDeps {
  /** Shared active runs map (same one used by CodingOrchestrator). */
  activeRuns: Map<string, ActiveCoderRun>;

  /** The pi-runner function that spawns container agents. */
  runContainerAgent: (
    group: RegisteredGroup,
    input: ContainerInput,
    abortSignal?: AbortSignal,
    onRuntimeEvent?: (event: ContainerRuntimeEvent) => void,
  ) => Promise<ContainerOutput>;

  /** Publish events to the host event bus. */
  publishEvent: (event: import('./runtime/host-events.js').HostEvent) => void;

  /**
   * Optional worktree factory (reuses createDefaultEphemeralWorktree
   * from coding-orchestrator.ts).
   */
  createEphemeralWorktree?: (params: {
    requestId: string;
    sourceWorkspaceDir: string;
    signal?: AbortSignal;
  }) => Promise<{ worktreePath: string; cleanup: () => Promise<void> }>;

  /**
   * Optional: send a message to a chat (for async result delivery).
   * If not provided, fire-and-forget results are logged but not delivered.
   */
  sendChatMessage?: (chatJid: string, text: string) => Promise<void>;

  /**
   * Optional: write content to a file (for file result delivery).
   * If not provided, file results are logged but not written.
   */
  writeFile?: (filePath: string, content: string) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export interface SubagentOrchestrator {
  spawnSubagent(request: SubagentSpawnRequest): Promise<SubagentSpawnResult>;
  abortSubagent(requestId: string): boolean;
  listActiveRuns(): ActiveCoderRun[];
}

export function createSubagentOrchestrator(
  deps: SubagentOrchestratorDeps,
): SubagentOrchestrator {
  const EVENT_SOURCE = 'subagent-orchestrator';

  function publishStartEvent(
    requestId: string,
    subagentType: string,
    chatJid?: string,
    taskText?: string,
    blocking?: boolean,
  ): void {
    deps.publishEvent({
      id: createHostEventId('sub'),
      kind: 'subagent_run_started',
      createdAt: new Date().toISOString(),
      source: EVENT_SOURCE,
      requestId,
      subagentType,
      chatJid,
      taskText,
      blocking: blocking ?? true,
    });
  }

  function publishFinishEvent(
    requestId: string,
    subagentType: string,
    status: 'success' | 'failed' | 'aborted',
    durationMs: number,
    extra?: { resultLength?: number; error?: string },
  ): void {
    deps.publishEvent({
      id: createHostEventId('sub'),
      kind: 'subagent_run_finished',
      createdAt: new Date().toISOString(),
      source: EVENT_SOURCE,
      requestId,
      subagentType,
      status,
      durationMs,
      ...extra,
    });
  }

  // -----------------------------------------------------------------------
  // spawnSubagent
  // -----------------------------------------------------------------------

  async function spawnSubagent(
    request: SubagentSpawnRequest,
  ): Promise<SubagentSpawnResult> {
    // 1. Resolve type config
    const typeConfig = getSubagentType(request.type);
    if (!typeConfig) {
      const knownTypes = [...SUBAGENT_TYPE_REGISTRY.keys()].join(', ');
      return {
        ok: false,
        requestId: request.requestId,
        result: null,
        error: `Unknown subagent type: "${request.type}". Known types: ${knownTypes}`,
        streamed: false,
      };
    }

    // 2. Load prompt template
    const promptTemplate = loadSubagentPrompt(typeConfig.promptTemplate);

    // 3. Build the full prompt
    const prompt = [
      `[SUBAGENT RUN]`,
      `Type: ${typeConfig.name}`,
      `Request: ${request.requestId}`,
      '',
      promptTemplate,
      '',
      '## Task',
      request.taskText,
    ].join('\n');

    // 4. Determine tool mode
    const toolMode: ContainerInput['toolMode'] =
      typeConfig.tools.length === 4 && !typeConfig.tools.includes('bash') && !typeConfig.tools.includes('write')
        ? 'read_only'
        : 'full';

    // 5. Resolve workspace
    let workspaceDirOverride: string | undefined;
    let worktreeCleanup: (() => Promise<void>) | undefined;

    try {
      if (typeConfig.workspaceMode === 'worktree' && deps.createEphemeralWorktree) {
        const worktree = await deps.createEphemeralWorktree({
          requestId: request.requestId,
          sourceWorkspaceDir: process.cwd(),
          signal: request.abortController?.signal,
        });
        workspaceDirOverride = worktree.worktreePath;
        worktreeCleanup = worktree.cleanup;
      } else if (typeConfig.workspaceMode === 'path' && request.workspacePath) {
        workspaceDirOverride = request.workspacePath;
      }
      // workspaceMode === 'none' -> no override, use default group workspace

      // 6. Create active run entry
      const abortController = request.abortController ?? new AbortController();
      const activeRun: ActiveCoderRun = {
        requestId: request.requestId,
        mode: 'execute',
        chatJid: request.originChatJid,
        groupName: request.originGroupFolder,
        startedAt: Date.now(),
        route: 'subagent_execute',
        state: 'starting',
        abortController,
      };
      deps.activeRuns.set(request.requestId, activeRun);

      // 7. Publish start event
      publishStartEvent(
        request.requestId,
        typeConfig.name,
        request.originChatJid,
        request.taskText,
        typeConfig.blocking,
      );

      // 8. Transition to running
      activeRun.state = 'running';

      // 9. Build ContainerInput
      const containerInput: ContainerInput = {
        prompt,
        groupFolder: request.originGroupFolder,
        chatJid: request.originChatJid,
        isMain: false,
        isSubagent: true,
        assistantName: request.assistantName,
        noContinue: true,
        toolMode,
        workspaceDirOverride,
        requestId: request.requestId,
        extraSystemPrompt: JSON.stringify({
          schema: 'subagent-run',
          requestId: request.requestId,
          subagentType: typeConfig.name,
          workspaceMode: typeConfig.workspaceMode,
          timeoutMs: typeConfig.timeoutMs,
        }),
        suppressPreviewStreaming: !typeConfig.blocking,
        ...(request.runtimePrefs?.provider && { provider: request.runtimePrefs.provider }),
        ...(request.runtimePrefs?.model && { model: request.runtimePrefs.model }),
        ...(request.runtimePrefs?.thinkLevel && { thinkLevel: request.runtimePrefs.thinkLevel }),
        ...(request.runtimePrefs?.reasoningLevel && { reasoningLevel: request.runtimePrefs.reasoningLevel }),
      };

      // 10. Handle fire-and-forget
      if (!typeConfig.blocking) {
        // Spawn async, return immediately
        executeSubagent(
          request,
          typeConfig,
          containerInput,
          abortController,
          activeRun,
          worktreeCleanup,
        ).catch(() => {
          // Error logged inside executeSubagent
        });

        return {
          ok: true,
          requestId: request.requestId,
          result: null,
          streamed: false,
        };
      }

      // 11. Blocking: await result
      return await executeSubagent(
        request,
        typeConfig,
        containerInput,
        abortController,
        activeRun,
        worktreeCleanup,
      );
    } catch (err) {
      // Cleanup worktree on setup failure
      if (worktreeCleanup) {
        try { await worktreeCleanup(); } catch { /* ignore */ }
      }

      const errorMsg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        requestId: request.requestId,
        result: null,
        error: errorMsg,
        streamed: false,
      };
    }
  }

  // -----------------------------------------------------------------------
  // executeSubagent (internal)
  // -----------------------------------------------------------------------

  async function executeSubagent(
    request: SubagentSpawnRequest,
    typeConfig: SubagentTypeConfig,
    containerInput: ContainerInput,
    abortController: AbortController,
    activeRun: ActiveCoderRun,
    worktreeCleanup?: (() => Promise<void>),
  ): Promise<SubagentSpawnResult> {
    const startTime = Date.now();
    let output: ContainerOutput;

    try {
      output = await deps.runContainerAgent(
        request.group,
        containerInput,
        abortController.signal,
        (event: ContainerRuntimeEvent) => {
          // Forward tool events as host events
          deps.publishEvent({
            id: createHostEventId('sub'),
            kind: 'subagent_tool_event',
            createdAt: new Date().toISOString(),
            source: EVENT_SOURCE,
            requestId: request.requestId,
            subagentType: typeConfig.name,
            toolName: event.toolName ?? 'unknown',
            status: event.status ?? 'start',
            args: event.args,
            output: event.output,
            error: event.error,
          });
        },
      );
    } catch (err) {
      const isAbort =
        err instanceof Error &&
        (err.message.includes('Aborted') || err.message.includes('abort'));

      activeRun.state = isAbort ? 'aborted' : 'failed';

      publishFinishEvent(
        request.requestId,
        typeConfig.name,
        isAbort ? 'aborted' : 'failed',
        Date.now() - startTime,
        { error: err instanceof Error ? err.message : String(err) },
      );

      return {
        ok: false,
        requestId: request.requestId,
        result: null,
        error: err instanceof Error ? err.message : String(err),
        streamed: false,
      };
    } finally {
      // Cleanup worktree
      if (worktreeCleanup) {
        try { await worktreeCleanup(); } catch { /* ignore */ }
      }
      // Remove from active runs
      deps.activeRuns.delete(request.requestId);
    }

    // Handle output
    if (output.status === 'error') {
      activeRun.state = 'failed';

      publishFinishEvent(
        request.requestId,
        typeConfig.name,
        'failed',
        Date.now() - startTime,
        { error: output.error },
      );

      return {
        ok: false,
        requestId: request.requestId,
        result: output.result,
        error: output.error,
        streamed: output.streamed ?? false,
        usage: output.usage,
      };
    }

    // Success
    activeRun.state = 'completed';

    publishFinishEvent(
      request.requestId,
      typeConfig.name,
      'success',
      Date.now() - startTime,
      { resultLength: output.result?.length ?? 0 },
    );

    // Deliver result based on type config
    const resultText = output.result ?? '';

    if (typeConfig.resultDelivery === 'chat' && resultText) {
      if (deps.sendChatMessage) {
        const header = `[${typeConfig.label}] (${request.requestId})\n\n`;
        await deps.sendChatMessage(request.originChatJid, header + resultText).catch(() => {
          // Delivery failure is non-fatal
        });
      }
    } else if (typeConfig.resultDelivery === 'file' && resultText) {
      const filePath = request.resultFilePath;
      if (filePath && deps.writeFile) {
        await deps.writeFile(filePath, resultText).catch(() => {
          // Write failure is non-fatal
        });
      }
    }
    // resultDelivery === 'none' -> no delivery

    return {
      ok: true,
      requestId: request.requestId,
      result: resultText,
      streamed: output.streamed ?? false,
      usage: output.usage,
    };
  }

  // -----------------------------------------------------------------------
  // abortSubagent
  // -----------------------------------------------------------------------

  function abortSubagent(requestId: string): boolean {
    const run = deps.activeRuns.get(requestId);
    if (!run || !run.abortController) return false;
    run.abortController.abort(new Error(`Subagent ${requestId} aborted by user`));
    run.state = 'aborted';
    return true;
  }

  // -----------------------------------------------------------------------
  // listActiveRuns
  // -----------------------------------------------------------------------

  function listActiveRuns(): ActiveCoderRun[] {
    return [...deps.activeRuns.values()];
  }

  return { spawnSubagent, abortSubagent, listActiveRuns };
}
