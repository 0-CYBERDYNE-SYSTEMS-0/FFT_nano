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
  | 'stale';

type RunProgressEvent = Extract<HostEvent, { kind: 'run_progress' }>;

export function createRunProgressReporter(params: {
  source: string;
  runId: string;
  sessionKey: string;
  chatJid?: string;
  heartbeatMs: number;
  emit: (event: RunProgressEvent) => void;
}) {
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
          `Coder status: Still running${suffix} (${elapsedSeconds}s).`,
          detail ? { detail } : {},
        );
        return;
      }
      if (phase === 'waiting_permission') {
        emitProgress(
          phase,
          `Coder status: Still waiting for approval to continue (${elapsedSeconds}s).`,
          detail ? { detail } : {},
        );
        return;
      }
      if (phase === 'thinking') {
        emitProgress(
          phase,
          `Coder status: Still reasoning about the task (${elapsedSeconds}s).`,
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
            ? 'Coder status: Resuming worker session.'
            : 'Coder status: Starting worker session.',
          { detail: event.resumed ? 'resumed' : 'fresh' },
        );
        clearHeartbeat();
        return;
      case 'thinking':
        emitProgress(
          'thinking',
          'Coder status: Reasoning about the task.',
        );
        startHeartbeat('thinking');
        return;
      case 'tool':
        if (event.status !== 'start') {
          clearHeartbeat();
          return;
        }
        emitProgress(
          'tool_running',
          `Coder status: Running ${event.toolName}.`,
          { detail: event.toolName },
        );
        startHeartbeat('tool_running', event.toolName);
        return;
      case 'wait':
        emitProgress(
          'waiting_permission',
          'Coder status: Waiting for approval to continue.',
          { detail: event.reason },
        );
        startHeartbeat('waiting_permission', event.reason);
        return;
      case 'retry_fresh':
        emitProgress(
          'retry_fresh',
          'Coder status: Retrying with a fresh session.',
        );
        clearHeartbeat();
        return;
      case 'retry_delay':
        emitProgress(
          'retry_delay',
          `Coder status: Retrying after ${event.delayMs}ms.`,
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
          `Coder status: Switching provider from ${event.fromProvider} to ${event.toProvider}.`,
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
            ? 'Coder status: Run stalled; retrying fresh.'
            : 'Coder status: Run stalled.',
        );
        clearHeartbeat();
        return;
      case 'assistant':
        clearHeartbeat();
        return;
      case 'stdout':
        return;
      case 'retry_exhausted':
        emitProgress(
          'stale',
          `Coder status: Retries exhausted. ${event.finalError}`,
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
