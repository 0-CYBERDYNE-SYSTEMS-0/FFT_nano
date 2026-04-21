import { randomUUID } from 'crypto';

import type {
  AgentEventPayload,
  ChatEventPayload,
  GatewayEventFrame,
} from '../tui/protocol.js';

export interface HostEventBase {
  id: string;
  createdAt: string;
  source: string;
}

export interface HostRunUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  provider?: string;
  model?: string;
}

export type HostEvent =
  | (HostEventBase & {
      kind: 'telegram_preview_requested';
      chatJid: string;
      requestId: string;
      text: string;
    })
  | (HostEventBase & {
      kind: 'chat_delivery_requested';
      chatJid: string;
      text: string;
      requestId?: string;
      prefixWhatsApp?: boolean;
    })
  | (HostEventBase & {
      kind: 'task_requested';
      sourceGroup: string;
      isMain: boolean;
      request: Record<string, unknown>;
    })
  | (HostEventBase & {
      kind: 'action_requested';
      sourceGroup: string;
      isMain: boolean;
      request:
        | import('../types.js').FarmActionRequest
        | import('../types.js').MemoryActionRequest;
      resultPath: string;
    })
  | (HostEventBase & {
      kind: 'action_result_ready';
      sourceGroup: string;
      requestId: string;
      resultPath: string;
      result: unknown;
    })
  | (HostEventBase & {
      kind: 'file_delivery_requested';
      sourceGroup: string;
      isMain: boolean;
      chatJid: string;
      requestId: string;
      filePath: string;
      mediaKind: 'photo' | 'document' | 'video' | 'audio';
      caption?: string;
    })
  | (HostEventBase & {
      kind: 'file_delivery_completed';
      sourceGroup: string;
      chatJid: string;
      requestId: string;
      filePath: string;
      success: boolean;
      mediaKind?: 'photo' | 'document' | 'video' | 'audio';
      error?: string;
    })
  | (HostEventBase & {
      kind: 'host_error';
      scope: 'ipc' | 'telegram' | 'runtime' | 'tui';
      detail: string;
      errorMessage: string;
      sourceGroup?: string;
      requestId?: string;
    })
  | (HostEventBase & {
      kind: 'chat_state_changed';
      runId: string;
      sessionKey: string;
      chatJid?: string;
      state: 'message' | 'delta' | 'final' | 'aborted' | 'error';
      message?: { role: 'assistant' | 'user' | 'system'; content: string };
      errorMessage?: string;
      usage?: HostRunUsage;
    })
  | (HostEventBase & {
      kind: 'run_lifecycle_changed';
      runId: string;
      sessionKey: string;
      chatJid?: string;
      phase: 'start' | 'end' | 'error';
      detail?: string;
    })
  | (HostEventBase & {
      kind: 'tool_progress';
      runId: string;
      sessionKey: string;
      chatJid?: string;
      index: number;
      toolName: string;
      status: 'start' | 'ok' | 'error';
      args?: string;
      output?: string;
      error?: string;
    })
  | (HostEventBase & {
      kind: 'run_progress';
      runId: string;
      sessionKey: string;
      chatJid?: string;
      phase:
        | 'spawn'
        | 'thinking'
        | 'tool_running'
        | 'waiting_permission'
        | 'retry_fresh'
        | 'retry_delay'
        | 'retry_provider_switch'
        | 'stale';
      text: string;
      detail?: string;
      attempt?: number;
      delayMs?: number;
      fromProvider?: string;
      toProvider?: string;
    })
  | (HostEventBase & {
      kind: 'assistant_final';
      runId: string;
      sessionKey: string;
      chatJid: string;
      message: { role: 'assistant' | 'user' | 'system'; content: string };
      usage?: HostRunUsage;
    })
  | (HostEventBase & {
      kind: 'run_started' | 'run_finished' | 'run_aborted' | 'run_failed';
      runId: string;
      sessionKey: string;
      chatJid: string;
      detail?: string;
      errorMessage?: string;
    })
  | (HostEventBase & {
      kind: 'tool_started' | 'tool_finished' | 'tool_failed';
      runId: string;
      sessionKey: string;
      chatJid: string;
      index: number;
      toolName: string;
      args?: string;
      output?: string;
      error?: string;
    });

export type LegacyTuiEvent =
  | {
      kind: 'chat';
      payload: ChatEventPayload;
    }
  | {
      kind: 'agent';
      payload: AgentEventPayload & { sessionKey?: string };
    };

export type HostEventOrLegacyTuiEvent = HostEvent | LegacyTuiEvent;

type Listener<TEvent> = (event: TEvent) => void;

export interface HostEventSubscriber<TEvent = HostEventOrLegacyTuiEvent> {
  subscribe(listener: Listener<TEvent>): () => void;
}

export class HostEventBus implements HostEventSubscriber<HostEvent> {
  private readonly listeners = new Set<Listener<HostEvent>>();

  subscribe(listener: Listener<HostEvent>): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  publish(event: HostEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Keep broadcasting even if one listener fails.
      }
    }
  }
}

export function createHostEventId(prefix = 'evt'): string {
  return `${prefix}-${randomUUID()}`;
}

export function invokeHostEventHandlerSafely(
  handler: (event: HostEvent) => Promise<void> | void,
  event: HostEvent,
  onError: (err: unknown) => void,
): void {
  void Promise.resolve()
    .then(() => handler(event))
    .catch((err) => {
      onError(err);
    });
}

export function createOrderedHostEventProcessor(
  handler: (event: HostEvent) => Promise<void> | void,
  onError: (err: unknown, event: HostEvent) => void,
): (event: HostEvent) => Promise<void> {
  let tail = Promise.resolve();

  return (event: HostEvent) => {
    const next = tail
      .catch(() => {})
      .then(() => handler(event))
      .catch((err) => {
        onError(err, event);
        throw err;
      });

    tail = next.catch(() => {});
    return next;
  };
}

export function projectEventToGatewayFrame(
  event: HostEventOrLegacyTuiEvent,
): GatewayEventFrame | null {
  if ('payload' in event) {
    if (event.kind === 'chat') {
      return { event: 'chat_event', payload: event.payload };
    }
    return { event: 'agent_event', payload: event.payload };
  }

  switch (event.kind) {
    case 'chat_state_changed':
      return {
        event: 'chat_event',
        payload: {
          runId: event.runId,
          sessionKey: event.sessionKey,
          state: event.state,
          ...(event.message ? { message: event.message } : {}),
          ...(event.errorMessage ? { errorMessage: event.errorMessage } : {}),
          ...(event.usage ? { usage: event.usage } : {}),
          timestamp: event.createdAt,
        },
      };
    case 'run_lifecycle_changed':
      return {
        event: 'agent_event',
        payload: {
          runId: event.runId,
          sessionKey: event.sessionKey,
          stream: 'lifecycle',
          data: {
            phase: event.phase,
            detail: event.detail,
          },
        },
      };
    case 'tool_progress':
      return {
        event: 'agent_event',
        payload: {
          runId: event.runId,
          sessionKey: event.sessionKey,
          stream: 'tool',
          data: {
            index: event.index,
            toolName: event.toolName,
            status: event.status,
            ...(event.args ? { args: event.args } : {}),
            ...(event.output ? { output: event.output } : {}),
            ...(event.error ? { error: event.error } : {}),
          },
        },
      };
    case 'run_progress':
      return {
        event: 'agent_event',
        payload: {
          runId: event.runId,
          sessionKey: event.sessionKey,
          stream: 'progress',
          data: {
            phase: event.phase,
            text: event.text,
            ...(event.detail ? { detail: event.detail } : {}),
            ...(typeof event.attempt === 'number'
              ? { attempt: event.attempt }
              : {}),
            ...(typeof event.delayMs === 'number'
              ? { delayMs: event.delayMs }
              : {}),
            ...(event.fromProvider
              ? { fromProvider: event.fromProvider }
              : {}),
            ...(event.toProvider ? { toProvider: event.toProvider } : {}),
          },
        },
      };
    case 'assistant_final':
      return {
        event: 'chat_event',
        payload: {
          runId: event.runId,
          sessionKey: event.sessionKey,
          state: 'final',
          message: event.message,
          timestamp: event.createdAt,
          usage: event.usage,
        },
      };
    case 'run_started':
      return {
        event: 'agent_event',
        payload: {
          runId: event.runId,
          sessionKey: event.sessionKey,
          stream: 'lifecycle',
          data: {
            phase: 'start',
            detail: event.detail,
          },
        },
      };
    case 'run_finished':
    case 'run_aborted':
      return {
        event: 'agent_event',
        payload: {
          runId: event.runId,
          sessionKey: event.sessionKey,
          stream: 'lifecycle',
          data: {
            phase: 'end',
            detail: event.kind === 'run_aborted' ? 'aborted' : event.detail,
          },
        },
      };
    case 'run_failed':
      return {
        event: 'chat_event',
        payload: {
          runId: event.runId,
          sessionKey: event.sessionKey,
          state: 'error',
          errorMessage: event.errorMessage || event.detail || 'Run failed',
          timestamp: event.createdAt,
        },
      };
    case 'tool_started':
    case 'tool_finished':
    case 'tool_failed':
      return {
        event: 'agent_event',
        payload: {
          runId: event.runId,
          sessionKey: event.sessionKey,
          stream: 'tool',
          data: {
            index: event.index,
            toolName: event.toolName,
            status:
              event.kind === 'tool_started'
                ? 'start'
                : event.kind === 'tool_finished'
                  ? 'ok'
                  : 'error',
            ...(event.args ? { args: event.args } : {}),
            ...(event.output ? { output: event.output } : {}),
            ...(event.error ? { error: event.error } : {}),
          },
        },
      };
    default:
      return null;
  }
}
