import { createHostEventId, type HostEvent } from './runtime/host-events.js';
import type { ContainerProgressEvent } from './pi-runner.js';

type RunProgressPhase =
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

type RunProgressEvent = Extract<HostEvent, { kind: 'run_progress' }>;

export function createRunProgressReporter(params: {
  source: string;
  runId: string;
  sessionKey: string;
  chatJid?: string;
  heartbeatMs: number;
  label?: string;
  emit: (event: RunProgressEvent) => void;
}) {
  const label = params.label || 'Coder';
  let heartbeat: NodeJS.Timeout | null = null;
  let activeHeartbeatPhase: RunProgressPhase | null = null;
  let activeHeartbeatDetail = '';
  let activeHeartbeatStartedAt = 0;
  let lastFingerprint = '';

  function clearHeartbeat(): void {
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = null;
    activeHeartbeatPhase = null;
    activeHeartbeatDetail = '';
    activeHeartbeatStartedAt = 0;
  }

  function emitProgress(
    phase: RunProgressPhase,
    text: string,
    extra: Partial<RunProgressEvent> = {},
  ): void {
    const fingerprint = JSON.stringify({
      phase,
      text,
      detail: extra.detail || '',
      attempt: extra.attempt ?? null,
      delayMs: extra.delayMs ?? null,
      fromProvider: extra.fromProvider || '',
      toProvider: extra.toProvider || '',
    });
    if (fingerprint === lastFingerprint) return;
    lastFingerprint = fingerprint;
    params.emit({
      kind: 'run_progress',
      id: createHostEventId('progress'),
      createdAt: new Date().toISOString(),
      source: params.source,
      runId: params.runId,
      sessionKey: params.sessionKey,
      ...(params.chatJid ? { chatJid: params.chatJid } : {}),
      phase,
      text,
      ...extra,
    });
  }

  function startHeartbeat(phase: RunProgressPhase, detail = ''): void {
    clearHeartbeat();
    activeHeartbeatPhase = phase;
    activeHeartbeatDetail = detail;
    activeHeartbeatStartedAt = Date.now();
    if (params.heartbeatMs <= 0) return;
    heartbeat = setInterval(() => {
      const elapsedSeconds = Math.max(
        1,
        Math.round((Date.now() - activeHeartbeatStartedAt) / 1000),
      );
      if (phase === 'tool_running') {
        const suffix = detail ? ` ${detail}` : '';
        emitProgress(
          phase,
          `${label} status: Still running${suffix} (${elapsedSeconds}s).`,
          detail ? { detail } : {},
        );
        return;
      }
      if (phase === 'waiting_permission') {
        emitProgress(
          phase,
          `${label} status: Still waiting for approval to continue (${elapsedSeconds}s).`,
          detail ? { detail } : {},
        );
        return;
      }
      if (phase === 'thinking') {
        emitProgress(
          phase,
          `${label} status: Still reasoning about the task (${elapsedSeconds}s).`,
          detail ? { detail } : {},
        );
      }
    }, params.heartbeatMs);
  }

  function handle(event: ContainerProgressEvent): void {
    switch (event.kind) {
      case 'spawn':
        emitProgress(
          'spawn',
          event.resumed
            ? `${label} status: Resuming worker session.`
            : `${label} status: Starting worker session.`,
          { detail: event.resumed ? 'resumed' : 'fresh' },
        );
        clearHeartbeat();
        return;
      case 'thinking':
        emitProgress('thinking', `${label} status: Reasoning about the task.`);
        startHeartbeat('thinking');
        return;
      case 'tool':
        if (event.status !== 'start') {
          clearHeartbeat();
          return;
        }
        emitProgress(
          'tool_running',
          `${label} status: Running ${event.toolName}.`,
          { detail: event.toolName },
        );
        startHeartbeat('tool_running', event.toolName);
        return;
      case 'wait':
        emitProgress(
          'waiting_permission',
          `${label} status: Waiting for approval to continue.`,
          { detail: event.reason },
        );
        startHeartbeat('waiting_permission', event.reason);
        return;
      case 'retry_fresh':
        emitProgress(
          'retry_fresh',
          `${label} status: Retrying with a fresh session.`,
        );
        clearHeartbeat();
        return;
      case 'retry_delay':
        emitProgress(
          'retry_delay',
          `${label} status: Retrying after ${event.delayMs}ms.`,
          {
            detail: event.reason,
            attempt: event.attempt,
            delayMs: event.delayMs,
          },
        );
        clearHeartbeat();
        return;
      case 'retry_provider_switch':
        emitProgress(
          'retry_provider_switch',
          `${label} status: Switching provider from ${event.fromProvider} to ${event.toProvider}.`,
          {
            fromProvider: event.fromProvider,
            toProvider: event.toProvider,
          },
        );
        clearHeartbeat();
        return;
      case 'stale':
        emitProgress(
          'stale',
          event.retryingFresh
            ? `${label} status: Run stalled; retrying fresh.`
            : `${label} status: Run stalled.`,
        );
        clearHeartbeat();
        return;
      case 'delta':
        return;
      case 'assistant':
        clearHeartbeat();
        return;
      case 'stdout':
        return;
      case 'retry_exhausted':
        emitProgress(
          'stale',
          `${label} status: Retries exhausted. ${event.finalError}`,
          { detail: event.finalError },
        );
        clearHeartbeat();
        return;
      default:
        return;
    }
  }

  function stop(): void {
    clearHeartbeat();
  }

  return { handle, stop };
}
