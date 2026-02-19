import type { AgentEventPayload, ChatEventPayload } from './protocol.js';

export type TuiRuntimeEvent =
  | {
      kind: 'chat';
      payload: ChatEventPayload;
    }
  | {
      kind: 'agent';
      payload: AgentEventPayload & { sessionKey?: string };
    };

type Listener = (event: TuiRuntimeEvent) => void;

export class TuiRuntimeEventHub {
  private readonly listeners = new Set<Listener>();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(event: TuiRuntimeEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Keep broadcasting even if one listener fails.
      }
    }
  }
}

