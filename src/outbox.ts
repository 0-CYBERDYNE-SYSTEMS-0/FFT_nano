import {
  enqueueDelivery,
  getDeliveryByDedupeKey,
  listPendingDeliveries,
  markDeliveryDelivered,
  markDeliveryFailedAttempt,
  type DeliveryOutboxRecord,
} from './db.js';

export interface OutboxDelivererDeps {
  // Transport. Returns true on confirmed send, false on a soft failure that
  // should be retried. Throwing is treated the same as returning false.
  sendMessage: (destination: string, body: string) => Promise<boolean>;
  maxBodyChars?: number;
  logger?: {
    info?: (payload: unknown, msg?: string) => void;
    warn?: (payload: unknown, msg?: string) => void;
    error?: (payload: unknown, msg?: string) => void;
  };
}

export interface OutboxDeliverer {
  /**
   * Durably deliver a message exactly-once-ish: enqueue under a stable
   * `dedupeKey`, then attempt delivery. If the key was already delivered this
   * is a no-op (no double-post). If the attempt fails the entry stays pending
   * for a later `flushPending`. Returns whether the message is now delivered.
   */
  deliver: (input: {
    dedupeKey: string;
    destination: string;
    body: string;
    maxAttempts?: number;
  }) => Promise<boolean>;
  /** Retry every pending entry that still has attempts left. */
  flushPending: () => Promise<{ delivered: number; stillPending: number }>;
}

export function createOutboxDeliverer(
  deps: OutboxDelivererDeps,
): OutboxDeliverer {
  const maxBodyChars = deps.maxBodyChars ?? 4000;

  async function attempt(record: DeliveryOutboxRecord): Promise<boolean> {
    try {
      const ok = await deps.sendMessage(
        record.destination,
        record.body.slice(0, maxBodyChars),
      );
      if (ok) {
        markDeliveryDelivered(record.id);
        return true;
      }
      markDeliveryFailedAttempt(record.id, 'transport_returned_false');
      return false;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      markDeliveryFailedAttempt(record.id, reason);
      deps.logger?.warn?.(
        { dedupeKey: record.dedupe_key, destination: record.destination, err },
        'Outbox delivery attempt threw',
      );
      return false;
    }
  }

  async function deliver(input: {
    dedupeKey: string;
    destination: string;
    body: string;
    maxAttempts?: number;
  }): Promise<boolean> {
    const { record, duplicate } = enqueueDelivery(input);
    // Already delivered under this key — never send again.
    if (record.status === 'delivered') {
      if (duplicate) {
        deps.logger?.info?.(
          { dedupeKey: input.dedupeKey },
          'Outbox skip: already delivered',
        );
      }
      return true;
    }
    return attempt(record);
  }

  async function flushPending(): Promise<{
    delivered: number;
    stillPending: number;
  }> {
    const pending = listPendingDeliveries();
    let delivered = 0;
    let stillPending = 0;
    for (const record of pending) {
      const ok = await attempt(record);
      if (ok) {
        delivered += 1;
      } else {
        // Re-read to see whether the failed attempt tipped it to 'failed'.
        const after = getDeliveryByDedupeKey(record.dedupe_key);
        if (after?.status === 'pending') stillPending += 1;
      }
    }
    if (delivered > 0 || stillPending > 0) {
      deps.logger?.info?.(
        { delivered, stillPending },
        'Outbox flush completed',
      );
    }
    return { delivered, stillPending };
  }

  return { deliver, flushPending };
}
