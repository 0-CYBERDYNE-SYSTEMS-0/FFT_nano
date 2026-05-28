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
      kind: 'chat_delivery_requested';
      chatJid: string;
      text: string;
      requestId?: string;
      prefixWhatsApp?: boolean;
    })
  | (HostEventBase & {
      kind: 'ipc_request';
      requestKind: 'task';
      sourceGroup: string;
      isMain: boolean;
      request: Record<string, unknown>;
    })
  | (HostEventBase & {
      kind: 'ipc_request';
      requestKind: 'action';
      sourceGroup: string;
      isMain: boolean;
      request:
        | import('../types.js').FarmActionRequest
        | import('../types.js').MemoryActionRequest
        | import('../types.js').SkillActionRequest;
      resultPath: string;
    })
  | (HostEventBase & {
      kind: 'ipc_result';
      sourceGroup: string;
      requestId: string;
      resultPath: string;
      result: unknown;
    })
  | (HostEventBase & {
      kind: 'file_transfer';
      phase: 'requested';
      sourceGroup: string;
      isMain: boolean;
      chatJid: string;
      requestId: string;
      filePath: string;
      mediaKind: 'photo' | 'document' | 'video' | 'audio';
      caption?: string;
    })
  | (HostEventBase & {
      kind: 'file_transfer';
      phase: 'completed';
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
      kind: 'run_state';
      runId: string;
      sessionKey: string;
      chatJid?: string;
      state: 'message' | 'delta' | 'final' | 'aborted' | 'error';
      message?: { role: 'assistant' | 'user' | 'system'; content: string };
      errorMessage?: string;
      usage?: HostRunUsage;
    })
  | (HostEventBase & {
      kind: 'run_state';
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
        | 'stale'
        | 'finalizing'
        | 'completed'
        | 'failed'
        | 'aborted';
      text: string;
      detail?: string;
      attempt?: number;
      delayMs?: number;
      fromProvider?: string;
      toProvider?: string;
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
    case 'run_state':
      if ('state' in event) {
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
      }
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
            ...(event.fromProvider ? { fromProvider: event.fromProvider } : {}),
            ...(event.toProvider ? { toProvider: event.toProvider } : {}),
          },
        },
      };
    default:
      return null;
  }
}
