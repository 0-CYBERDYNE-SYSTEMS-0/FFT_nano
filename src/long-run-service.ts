import {
  createAgentRun,
  getAgentRunById,
  listAgentRunsForChat,
  listRecoverableAgentRuns,
  updateAgentRun,
  type AgentRunRecord,
} from './db.js';
import type { ContainerProgressEvent } from './pi-runner.js';
import { createRunProgressReporter } from './run-progress.js';
import {
  diffWorkspaceFiles,
  formatFileChangeLine,
  formatLongRunCompletionPacket,
  formatLongRunMilestone,
  formatLongRunStartNotice,
  snapshotWorkspaceFiles,
  type WorkspaceFileChange,
  type WorkspaceFileSnapshot,
} from './long-run-visibility.js';
import type { RegisteredGroup } from './types.js';

type RunUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  provider?: string;
  model?: string;
};

type LongRunResult = {
  result: string | null;
  streamed: boolean;
  ok: boolean;
  usage?: RunUsage;
  suppressUserDelivery?: boolean;
};

export interface LongRunServiceDeps {
  getGroupForChat: (chatJid: string) => RegisteredGroup | undefined;
  resolveWorkspacePath: (group: RegisteredGroup) => string;
  isMainChat: (chatJid: string) => boolean;
  getSessionKeyForChat: (chatJid: string) => string;
  sendMessage: (chatJid: string, text: string) => Promise<boolean>;
  sendAgentResultMessage: (
    chatJid: string,
    text: string,
    opts?: { prefixWhatsApp?: boolean },
  ) => Promise<boolean>;
  setTyping: (chatJid: string, typing: boolean) => Promise<void>;
  persistAssistantHistory: (
    chatJid: string,
    text: string,
    runId?: string,
  ) => void;
  updateChatUsage: (chatJid: string, usage?: RunUsage) => void;
  emitRunProgress: (payload: {
    chatJid: string;
    requestId: string;
    phase:
      | 'spawn'
      | 'thinking'
      | 'tool_running'
      | 'waiting_permission'
      | 'retry_fresh'
      | 'retry_delay'
      | 'retry_provider_switch'
      | 'stale'
      | 'finalizing'
      | 'completed'
      | 'failed'
      | 'aborted';
    text: string;
    detail?: string;
  }) => void;
  emitTuiChatEvent: (payload: any) => void;
  emitTuiAgentEvent: (payload: any) => void;
  runAgent: (
    group: RegisteredGroup,
    prompt: string,
    chatJid: string,
    codingHint: 'none',
    requestId: string,
    runtimePrefs: Record<string, any>,
    options: Record<string, unknown>,
    abortSignal: AbortSignal,
  ) => Promise<LongRunResult>;
  getRuntimePrefs: (chatJid: string) => Record<string, any>;
  logger?: {
    error?: (payload: unknown, msg?: string) => void;
    warn?: (payload: unknown, msg?: string) => void;
  };
  noteRunSettled?: (params: {
    chatJid: string;
    requestId: string;
    ok: boolean;
    result: string | null;
  }) => void;
}

export interface LongRunService {
  startRun: (
    chatJid: string,
    prompt: string,
    options?: {
      id?: string;
      continuationPreamble?: string;
      sourceRequestId?: string;
      source?: string;
      resumeAttempts?: number;
      startNotice?: string;
      silentStart?: boolean;
      onCreated?: (run: AgentRunRecord) => Promise<void>;
    },
  ) => Promise<AgentRunRecord>;
  listRunsText: (chatJid: string) => string;
  statusText: (chatJid: string, id: string) => string;
  cancelRun: (chatJid: string, id: string) => Promise<string>;
  handleCommand: (chatJid: string, content: string) => Promise<boolean>;
  resumeRecoverableRuns: () => Promise<{ resumed: number; abandoned: number }>;
}

function parseRuntimeMs(
  raw: string | undefined,
  fallback: number,
  min: number,
): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, parsed);
}

function makeLongRunId(): string {
  return `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function summarizePrompt(prompt: string): string {
  const compact = prompt.replace(/\s+/g, ' ').trim();
  if (compact.length <= 96) return compact;
  return `${compact.slice(0, 93)}...`;
}

function elapsedText(startIso: string | null, endIso?: string | null): string {
  if (!startIso) return 'not started';
  const start = Date.parse(startIso);
  const end = endIso ? Date.parse(endIso) : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 'unknown';
  return `${Math.max(0, Math.round((end - start) / 1000))}s`;
}

function formatRunLine(run: AgentRunRecord): string {
  const phase = run.current_phase ? ` phase=${run.current_phase}` : '';
  const detail = run.current_detail ? ` detail=${run.current_detail}` : '';
  return `- ${run.id} ${run.status} age=${elapsedText(run.created_at)}${phase}${detail} task="${summarizePrompt(run.prompt)}"`;
}

function isAbortError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /abort|aborted|stopped|cancel/i.test(msg);
}

function resolveStartNotice(
  runId: string,
  prompt: string,
  template?: string,
): string {
  if (!template || /^Started long run <id>\.?\s*$/i.test(template.trim())) {
    return formatLongRunStartNotice(runId, prompt);
  }
  return template.split('<id>').join(runId);
}

function isWriteLikeTool(toolName: string | null | undefined): boolean {
  if (!toolName) return false;
  return /write|edit|create|save|patch|apply_patch|file|bash|shell|terminal/i.test(
    toolName,
  );
}

export function createLongRunService(deps: LongRunServiceDeps): LongRunService {
  const active = new Map<string, AbortController>();

  function lifecyclePolicyOverride() {
    const hardTimeoutMs = parseRuntimeMs(
      process.env.FFT_NANO_LONG_RUN_TIMEOUT_MS,
      6 * 60 * 60 * 1000,
      1_000,
    );
    const staleAfterMs = parseRuntimeMs(
      process.env.FFT_NANO_LONG_RUN_STALE_MS,
      3 * 60 * 1000,
      100,
    );
    const toolActiveStaleMs = parseRuntimeMs(
      process.env.FFT_NANO_LONG_RUN_TOOL_STALE_MS,
      30 * 60 * 1000,
      100,
    );
    const waitStateStaleMs = parseRuntimeMs(
      process.env.FFT_NANO_LONG_RUN_WAIT_STALE_MS,
      30 * 60 * 1000,
      100,
    );
    return {
      hardTimeoutMs,
      staleAfterMs: Math.min(staleAfterMs, hardTimeoutMs - 100),
      toolActiveStaleMs: Math.min(toolActiveStaleMs, hardTimeoutMs - 100),
      waitStateStaleMs: Math.min(waitStateStaleMs, hardTimeoutMs - 100),
      allowFreshSessionFallback: true,
    };
  }

  async function publishUserVisible(
    chatJid: string,
    text: string,
    historyKey: string,
  ): Promise<void> {
    try {
      await deps.sendMessage(chatJid, text);
    } catch (err) {
      deps.logger?.warn?.({ err, chatJid, historyKey }, 'Long-run notice send failed');
    }
    try {
      deps.persistAssistantHistory(chatJid, text, historyKey);
    } catch (err) {
      deps.logger?.warn?.(
        { err, chatJid, historyKey },
        'Long-run notice persist failed',
      );
    }
  }

  async function runLongAgentRun(runId: string): Promise<void> {
    const run = getAgentRunById(runId);
    if (!run) return;
    const group = deps.getGroupForChat(run.chat_jid);
    if (!group) {
      const now = new Date().toISOString();
      updateAgentRun(runId, {
        status: 'failed',
        finished_at: now,
        error: 'chat_not_registered',
      });
      await deps.sendAgentResultMessage(
        run.chat_jid,
        `Run ${runId} failed: chat_not_registered`,
      );
      return;
    }

    const abortController = new AbortController();
    active.set(runId, abortController);
    const chatJid = run.chat_jid;
    const sessionKey = deps.getSessionKeyForChat(chatJid);
    const startedAt = new Date().toISOString();
    const workspacePath = deps.resolveWorkspacePath(group);
    // Record the durable workspace this run operates in so restart triage can
    // classify it recoverable: a long run executes in its group's persistent
    // workspace directory, which survives a host restart.
    updateAgentRun(runId, {
      status: 'running',
      started_at: startedAt,
      last_progress_at: startedAt,
      current_phase: 'spawn',
      current_detail: 'starting',
      worktree_path: workspacePath,
    });
    deps.emitTuiChatEvent({
      runId,
      sessionKey,
      state: 'message',
      message: { role: 'system', content: `Starting long run ${runId}...` },
    });
    deps.emitTuiAgentEvent({
      runId,
      sessionKey,
      phase: 'start',
      detail: 'long run',
    });
    deps.emitRunProgress({
      chatJid,
      requestId: runId,
      phase: 'spawn',
      text: `Agent status: Starting long run ${runId}.`,
      detail: 'starting',
    });
    await deps.setTyping(chatJid, true);

    let baselineSnapshot: WorkspaceFileSnapshot = snapshotWorkspaceFiles(
      workspacePath,
    );
    let latestSnapshot = baselineSnapshot;
    const announcedFiles = new Set<string>();
    let milestoneSeq = 0;
    let lastTimeMilestoneAt = Date.now();
    let currentPhase: string | null = 'spawn';
    let currentDetail: string | null = 'starting';

    const milestoneIntervalMs = parseRuntimeMs(
      process.env.FFT_NANO_LONG_RUN_MILESTONE_MS,
      2 * 60 * 1000,
      15_000,
    );

    async function publishMilestone(text: string, kind: string): Promise<void> {
      milestoneSeq += 1;
      await publishUserVisible(
        chatJid,
        text,
        `${runId}:milestone-${milestoneSeq}-${kind}`,
      );
    }

    async function announceNewFiles(
      reason: 'tool' | 'heartbeat' | 'final',
    ): Promise<WorkspaceFileChange[]> {
      latestSnapshot = snapshotWorkspaceFiles(workspacePath);
      const changes = diffWorkspaceFiles(baselineSnapshot, latestSnapshot);
      const fresh = changes.filter(
        (change) => !announcedFiles.has(change.relativePath),
      );
      for (const change of fresh) {
        announcedFiles.add(change.relativePath);
        if (reason !== 'final') {
          await publishMilestone(formatFileChangeLine(change), 'file');
        }
      }
      return changes;
    }

    const reporter = createRunProgressReporter({
      source: 'long-run-service',
      runId,
      sessionKey,
      chatJid: chatJid,
      heartbeatMs: parseRuntimeMs(
        process.env.FFT_NANO_LONG_RUN_PROGRESS_HEARTBEAT_MS,
        15_000,
        1_000,
      ),
      label: 'Agent',
      emit: (event) => {
        deps.emitRunProgress({
          chatJid: chatJid,
          requestId: runId,
          phase: event.phase,
          text: event.text,
          ...(event.detail ? { detail: event.detail } : {}),
        });
      },
    });

    const noteProgress = (event: ContainerProgressEvent) => {
      const now = new Date().toISOString();
      let phase: string | null = null;
      let detail: string | null = null;
      if (event.kind === 'tool') {
        phase = event.status === 'start' ? 'tool_running' : 'thinking';
        detail = event.toolName;
        if (
          event.status !== 'start' &&
          isWriteLikeTool(event.toolName) &&
          !abortController.signal.aborted
        ) {
          void announceNewFiles('tool').catch((err) => {
            deps.logger?.warn?.(
              { err, runId },
              'Long-run file milestone failed',
            );
          });
        }
      } else if (event.kind === 'thinking') {
        phase = 'thinking';
      } else if (event.kind === 'assistant' || event.kind === 'stdout') {
        phase = event.kind;
        if (event.kind === 'assistant' && event.text?.trim()) {
          deps.emitTuiChatEvent({
            runId,
            sessionKey,
            state: 'delta',
            message: { role: 'assistant', content: event.text },
          });
        }
      } else if (event.kind === 'wait') {
        phase = 'waiting_permission';
        detail = event.reason;
      } else if (event.kind === 'stale') {
        phase = 'stale';
        detail = event.retryingFresh ? 'retrying fresh' : event.reason;
      } else if (event.kind === 'retry_fresh') {
        phase = 'retry_fresh';
        detail = event.reason;
      } else if (event.kind === 'retry_delay') {
        phase = 'retry_delay';
        detail = event.reason;
      } else if (event.kind === 'retry_provider_switch') {
        phase = 'retry_provider_switch';
        detail = `${event.fromProvider} -> ${event.toProvider}`;
      } else if (event.kind === 'spawn') {
        phase = 'spawn';
        detail = event.resumed ? 'resumed' : 'fresh';
      }
      if (phase) {
        currentPhase = phase;
        currentDetail = detail;
        updateAgentRun(runId, {
          last_progress_at: now,
          current_phase: phase,
          current_detail: detail,
        });
      }
      reporter.handle(event);
    };

    const timeMilestoneTimer = setInterval(() => {
      if (abortController.signal.aborted) return;
      const now = Date.now();
      if (now - lastTimeMilestoneAt < milestoneIntervalMs) return;
      lastTimeMilestoneAt = now;
      void (async () => {
        try {
          await announceNewFiles('heartbeat');
          await publishMilestone(
            formatLongRunMilestone({
              runId,
              elapsedText: elapsedText(startedAt),
              phase: currentPhase,
              detail: currentDetail,
            }),
            'time',
          );
        } catch (err) {
          deps.logger?.warn?.(
            { err, runId },
            'Long-run time milestone failed',
          );
        }
      })();
    }, Math.min(30_000, milestoneIntervalMs));
    if (typeof timeMilestoneTimer.unref === 'function') {
      timeMilestoneTimer.unref();
    }

    try {
      const result = await deps.runAgent(
        group,
        run.prompt,
        chatJid,
        'none',
        runId,
        deps.getRuntimePrefs(chatJid),
        {
          suppressErrorReply: true,
          skipSkillMaintenance: true,
          lifecyclePolicyOverride: lifecyclePolicyOverride(),
          onProgressEvent: noteProgress,
        },
        abortController.signal,
      );
      deps.updateChatUsage(chatJid, result.usage);
      updateAgentRun(runId, {
        provider: result.usage?.provider ?? null,
        model: result.usage?.model ?? null,
      });
      const finishedAt = new Date().toISOString();
      if (abortController.signal.aborted) {
        updateAgentRun(runId, {
          status: 'aborted',
          finished_at: finishedAt,
          current_phase: 'aborted',
          error: 'cancelled',
        });
        deps.emitRunProgress({
          chatJid: chatJid,
          requestId: runId,
          phase: 'aborted',
          text: `Agent status: Run ${runId} aborted.`,
        });
        const abortText = `Run ${runId} aborted.`;
        await publishUserVisible(chatJid, abortText, `${runId}:aborted`);
        deps.noteRunSettled?.({
          chatJid: chatJid,
          requestId: runId,
          ok: false,
          result: 'cancelled',
        });
        return;
      }
      if (!result.ok) {
        const reason = result.result || 'agent_failed';
        updateAgentRun(runId, {
          status: 'failed',
          finished_at: finishedAt,
          current_phase: 'failed',
          error: reason,
        });
        deps.emitRunProgress({
          chatJid: chatJid,
          requestId: runId,
          phase: 'failed',
          text: `Agent status: Run ${runId} failed.`,
          detail: reason,
        });
        deps.emitTuiChatEvent({
          runId,
          sessionKey,
          state: 'error',
          errorMessage: reason,
        });
        deps.emitTuiAgentEvent({
          runId,
          sessionKey,
          phase: 'error',
          detail: reason,
        });
        const failText = `Run ${runId} failed: ${reason}`;
        await publishUserVisible(chatJid, failText, `${runId}:failed`);
        deps.noteRunSettled?.({
          chatJid: chatJid,
          requestId: runId,
          ok: false,
          result: reason,
        });
        return;
      }
      const output = result.result || 'Completed with no final text.';
      const changes = await announceNewFiles('final');
      const packet = formatLongRunCompletionPacket({
        runId,
        elapsedText: elapsedText(startedAt, finishedAt),
        output,
        changes,
        workspaceRoot: workspacePath,
      });
      updateAgentRun(runId, {
        status: 'completed',
        finished_at: finishedAt,
        current_phase: 'completed',
        current_detail: null,
        result: packet,
      });
      deps.emitRunProgress({
        chatJid: chatJid,
        requestId: runId,
        phase: 'completed',
        text: `Agent status: Run ${runId} complete.`,
      });
      deps.emitTuiChatEvent({
        runId,
        sessionKey,
        state: 'final',
        message: { role: 'assistant', content: packet },
        usage: result.usage,
      });
      deps.emitTuiAgentEvent({
        runId,
        sessionKey,
        phase: 'end',
        detail: 'complete',
      });
      // sendAgentResultMessage for channel formatting; also persist under a
      // stable completion key so chat history keeps the full packet.
      await deps.sendAgentResultMessage(chatJid, packet);
      deps.persistAssistantHistory(chatJid, packet, `${runId}:complete`);
      deps.noteRunSettled?.({
        chatJid: chatJid,
        requestId: runId,
        ok: true,
        result: packet,
      });
    } catch (err) {
      const finishedAt = new Date().toISOString();
      const reason = isAbortError(err)
        ? 'cancelled'
        : err instanceof Error
          ? err.message
          : String(err);
      const status = isAbortError(err) ? 'aborted' : 'failed';
      updateAgentRun(runId, {
        status,
        finished_at: finishedAt,
        current_phase: status,
        error: reason,
      });
      deps.emitRunProgress({
        chatJid: chatJid,
        requestId: runId,
        phase: status,
        text:
          status === 'aborted'
            ? `Agent status: Run ${runId} aborted.`
            : `Agent status: Run ${runId} failed.`,
        detail: reason,
      });
      deps.logger?.error?.({ err, runId }, 'Long agent run failed');
      const errText =
        status === 'aborted'
          ? `Run ${runId} aborted.`
          : `Run ${runId} failed: ${reason}`;
      await publishUserVisible(chatJid, errText, `${runId}:${status}`);
      deps.noteRunSettled?.({
        chatJid: chatJid,
        requestId: runId,
        ok: false,
        result: reason,
      });
    } finally {
      clearInterval(timeMilestoneTimer);
      reporter.stop();
      active.delete(runId);
      await deps.setTyping(chatJid, false);
    }
  }

  async function startRun(
    chatJid: string,
    prompt: string,
    options: {
      id?: string;
      continuationPreamble?: string;
      sourceRequestId?: string;
      source?: string;
      resumeAttempts?: number;
      startNotice?: string;
      silentStart?: boolean;
      onCreated?: (run: AgentRunRecord) => Promise<void>;
    } = {},
  ): Promise<AgentRunRecord> {
    const group = deps.getGroupForChat(chatJid);
    if (!group) throw new Error('Chat is not registered.');
    if (!deps.isMainChat(chatJid)) {
      throw new Error('Long runs are only available in the main/admin chat.');
    }
    const finalPrompt = options.continuationPreamble
      ? `${options.continuationPreamble.trim()}\n\n${prompt}`
      : prompt;
    const run = createAgentRun({
      id: options.id || makeLongRunId(),
      chatJid,
      groupFolder: group.folder,
      kind: 'agent_long',
      prompt: finalPrompt,
      resumeAttempts: options.resumeAttempts ?? 0,
    });
    await options.onCreated?.(run);
    if (!options.silentStart) {
      const notice = resolveStartNotice(
        run.id,
        finalPrompt,
        options.startNotice,
      );
      await publishUserVisible(chatJid, notice, `${run.id}:start`);
    }
    void runLongAgentRun(run.id).catch((err) => {
      deps.logger?.error?.({ err, runId: run.id }, 'Long agent run crashed');
    });
    return run;
  }

  function listRunsText(chatJid: string): string {
    const runs = listAgentRunsForChat(chatJid, 10);
    if (runs.length === 0) return 'No long runs found for this chat.';
    return ['Recent long runs:', ...runs.map(formatRunLine)].join('\n');
  }

  function statusText(chatJid: string, id: string): string {
    const run = getAgentRunById(id);
    if (!run || run.chat_jid !== chatJid) return `No long run found for: ${id}`;
    return [
      `Run ${run.id}: ${run.status}`,
      `Task: ${summarizePrompt(run.prompt)}`,
      `Created: ${run.created_at}`,
      `Elapsed: ${elapsedText(run.started_at || run.created_at, run.finished_at)}`,
      `Phase: ${run.current_phase || 'none'}`,
      `Detail: ${run.current_detail || 'none'}`,
      `Last progress: ${run.last_progress_at || 'none'}`,
      ...(run.error ? [`Error: ${run.error}`] : []),
    ].join('\n');
  }

  async function cancelRun(chatJid: string, id: string): Promise<string> {
    const run = getAgentRunById(id);
    if (!run || run.chat_jid !== chatJid) return `No long run found for: ${id}`;
    if (!['queued', 'running'].includes(run.status)) {
      return `Run ${id} is already ${run.status}.`;
    }
    const controller = active.get(id);
    if (controller) {
      controller.abort(new Error(`Cancelled via /cancel-run ${id}`));
    }
    updateAgentRun(id, {
      status: 'aborted',
      finished_at: new Date().toISOString(),
      current_phase: 'aborted',
      error: 'cancelled',
    });
    return `Stopping run ${id}...`;
  }

  async function handleCommand(
    chatJid: string,
    content: string,
  ): Promise<boolean> {
    const trimmed = content.trim();
    const [rawCmd, ...rest] = trimmed.split(/\s+/);
    const cmd = (rawCmd || '').split('@')[0]?.toLowerCase();
    if (
      ![
        '/run',
        '/runs',
        '/run-status',
        '/run_status',
        '/cancel-run',
        '/cancel_run',
      ].includes(cmd || '')
    ) {
      return false;
    }
    if (!deps.isMainChat(chatJid)) {
      await deps.sendMessage(
        chatJid,
        'Long runs are only available in the main/admin chat.',
      );
      return true;
    }
    if (cmd === '/run') {
      const task = rest.join(' ').trim();
      if (!task) {
        await deps.sendMessage(chatJid, 'Usage: /run <task>');
        return true;
      }
      await startRun(chatJid, task);
      return true;
    }
    if (cmd === '/runs') {
      await deps.sendMessage(chatJid, listRunsText(chatJid));
      return true;
    }
    if (cmd === '/run-status' || cmd === '/run_status') {
      const id = rest[0]?.trim();
      await deps.sendMessage(
        chatJid,
        id ? statusText(chatJid, id) : 'Usage: /run-status <id>',
      );
      return true;
    }
    if (cmd === '/cancel-run' || cmd === '/cancel_run') {
      const id = rest[0]?.trim();
      await deps.sendMessage(
        chatJid,
        id ? await cancelRun(chatJid, id) : 'Usage: /cancel-run <id>',
      );
      return true;
    }
    return false;
  }

  /**
   * Resume consumer for runs preserved by restart triage. Reads runs that were
   * interrupted mid-flight but whose workspace survived, and re-enqueues each as
   * a fresh continuation run that picks up from the preserved workspace state.
   *
   * A per-run attempt counter (carried forward into the resumed run) caps how
   * many times a run can be revived, so a run that crashes the host on every
   * boot is abandoned instead of looping. The source run is always marked
   * `resumed` (so it drops out of `listRecoverableAgentRuns`) before the new run
   * is started, making this idempotent across repeated startups.
   */
  async function resumeRecoverableRuns(): Promise<{
    resumed: number;
    abandoned: number;
  }> {
    const maxResumes = Math.max(
      0,
      parseRuntimeMs(process.env.FFT_NANO_LONG_RUN_MAX_RESUMES, 2, 0),
    );
    const recoverable = listRecoverableAgentRuns();
    let resumed = 0;
    let abandoned = 0;
    for (const run of recoverable) {
      const attempts = (run.resume_attempts ?? 0) + 1;
      // Mark the source consumed up front so a crash partway through never
      // leaves it eligible for re-resume on the next boot.
      updateAgentRun(run.id, { recovery_state: 'resumed' });
      const group = deps.getGroupForChat(run.chat_jid);
      if (!group || !deps.isMainChat(run.chat_jid) || attempts > maxResumes) {
        abandoned += 1;
        deps.logger?.warn?.(
          { runId: run.id, attempts, maxResumes },
          'Abandoning interrupted long run (cap reached or chat unavailable)',
        );
        continue;
      }
      try {
        await startRun(run.chat_jid, run.prompt, {
          source: 'resume',
          resumeAttempts: attempts,
          startNotice: `Resuming interrupted long run as <id> (prior ${run.id}). I'll post milestones and the result here.\nStatus: /run_status <id> · list: /runs · cancel: /cancel_run <id>`,
          continuationPreamble: `You are resuming an interrupted long run (original id ${run.id}) after a host restart. Your prior work persists in this workspace — inspect it, determine what is already done, and continue the task to completion rather than starting over.`,
        });
        resumed += 1;
      } catch (err) {
        abandoned += 1;
        deps.logger?.error?.(
          { err, runId: run.id },
          'Failed to resume interrupted long run',
        );
      }
    }
    return { resumed, abandoned };
  }

  return {
    startRun,
    listRunsText,
    statusText,
    cancelRun,
    handleCommand,
    resumeRecoverableRuns,
  };
}
