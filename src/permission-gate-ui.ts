/**
 * Permission Gate UI Handler
 *
 * Manages user-facing confirmation dialogs for the pi extension permission gate.
 * When the extension intercepts a destructive command, it sends an extension_ui_request
 * via the RPC protocol. This module presents the confirmation in Telegram (or logs
 * it for non-Telegram contexts) and resolves the promise with the user's choice.
 *
 * Uses a Map of pending confirmations keyed by request ID. When a Telegram callback
 * query arrives with a matching ID, the corresponding promise is resolved.
 */

import type { ExtensionUIRequest, ExtensionUIResponse } from './pi-runner.js';
import { logger } from './logger.js';

export interface PendingConfirmation {
  requestId: string;
  chatJid?: string;
  resolve: (response: ExtensionUIResponse) => void;
  reject: (err: Error) => void;
  createdAt: number;
  timeoutMs: number;
}

const pendingConfirmations = new Map<string, PendingConfirmation>();

// Timeout checker interval (every 5 seconds)
let timeoutInterval: ReturnType<typeof setInterval> | null = null;

function startTimeoutChecker(): void {
  if (timeoutInterval) return;
  timeoutInterval = setInterval(() => {
    const now = Date.now();
    for (const [id, pending] of pendingConfirmations) {
      if (now - pending.createdAt > pending.timeoutMs) {
        pendingConfirmations.delete(id);
        logger.info(
          { requestId: id, chatJid: pending.chatJid },
          'Permission gate confirmation timed out, auto-denying',
        );
        pending.resolve({ confirmed: false });
      }
    }
  }, 5_000);
}

startTimeoutChecker();

/**
 * Create a new pending confirmation and return its ID.
 * The caller should send the UI message and then await the result.
 */
export function createPendingConfirmation(
  requestId: string,
  chatJid: string | undefined,
  timeoutMs: number = 60_000,
): {
  promise: Promise<ExtensionUIResponse>;
  resolve: (response: ExtensionUIResponse) => void;
  reject: (err: Error) => void;
} {
  let resolve!: (response: ExtensionUIResponse) => void;
  let reject!: (err: Error) => void;

  const promise = new Promise<ExtensionUIResponse>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  pendingConfirmations.set(requestId, {
    requestId,
    chatJid,
    resolve,
    reject,
    createdAt: Date.now(),
    timeoutMs,
  });

  logger.debug(
    { requestId, chatJid, timeoutMs },
    'Permission gate confirmation created',
  );

  return { promise, resolve, reject };
}

/**
 * Resolve a pending confirmation from a Telegram callback query.
 * Returns true if the confirmation was found and resolved, false otherwise.
 */
export function resolvePendingConfirmation(
  requestId: string,
  response: ExtensionUIResponse,
): boolean {
  const pending = pendingConfirmations.get(requestId);
  if (!pending) return false;

  pendingConfirmations.delete(requestId);
  pending.resolve(response);

  logger.info(
    { requestId, chatJid: pending.chatJid, response },
    'Permission gate confirmation resolved',
  );

  return true;
}

/**
 * Check if a callback data string is a permission gate confirmation.
 * Returns the request ID if it matches, null otherwise.
 */
export function parsePermissionGateCallback(
  callbackData: string,
): string | null {
  if (callbackData.startsWith('pg_allow:') || callbackData.startsWith('pg_block:')) {
    return callbackData.split(':')[1];
  }
  return null;
}

/**
 * Get the number of pending confirmations (for diagnostics).
 */
export function getPendingConfirmationCount(): number {
  return pendingConfirmations.size;
}

/**
 * Get all pending confirmations (for diagnostics).
 */
export function getPendingConfirmations(): PendingConfirmation[] {
  return Array.from(pendingConfirmations.values());
}
