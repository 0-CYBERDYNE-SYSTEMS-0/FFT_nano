export interface TelegramPreviewUpdateEventPayload {
  chatJid: string;
  requestId: string;
  text: string;
}

export interface AgentMessageEventPayload {
  chatJid: string;
  requestId?: string;
  text: string;
  prefixWhatsApp?: boolean;
}

export type PiRuntimeEvent =
  | {
      kind: 'telegram_preview_update';
      payload: TelegramPreviewUpdateEventPayload;
    }
  | {
      kind: 'agent_message';
      payload: AgentMessageEventPayload;
    };

type Listener = (event: PiRuntimeEvent) => void;

export class PiRuntimeEventHub {
  private readonly listeners = new Set<Listener>();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(event: PiRuntimeEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Keep broadcasting even if one listener fails.
      }
    }
  }
}

export function invokePiRuntimeEventHandlerSafely(
  handler: (event: PiRuntimeEvent) => Promise<void> | void,
  event: PiRuntimeEvent,
  onError: (err: unknown) => void,
): void {
  void Promise.resolve()
    .then(() => handler(event))
    .catch((err) => {
      onError(err);
    });
}

export function createOrderedPiRuntimeEventProcessor(
  handler: (event: PiRuntimeEvent) => Promise<void> | void,
  onError: (err: unknown, event: PiRuntimeEvent) => void,
): (event: PiRuntimeEvent) => void {
  let tail = Promise.resolve();

  return (event: PiRuntimeEvent) => {
    tail = tail
      .catch(() => {})
      .then(() => handler(event))
      .catch((err) => {
        onError(err, event);
      });
  };
}
