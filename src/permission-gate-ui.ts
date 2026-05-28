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
const expiredConfirmations = new Map<
  string,
  { chatJid?: string; expiredAt: number; reason: 'timeout' | 'cancelled' }
>();
const EXPIRED_CONFIRMATION_TTL_MS = 10 * 60_000;

let timeoutInterval: ReturnType<typeof setInterval> | null = null;

function startTimeoutChecker(): void {
  if (timeoutInterval) return;
  timeoutInterval = setInterval(() => {
    const now = Date.now();
    for (const [id, expired] of expiredConfirmations) {
      if (now - expired.expiredAt > EXPIRED_CONFIRMATION_TTL_MS) {
        expiredConfirmations.delete(id);
      }
    }
    for (const [id, pending] of pendingConfirmations) {
      if (now - pending.createdAt <= pending.timeoutMs) continue;
      pendingConfirmations.delete(id);
      expiredConfirmations.set(id, {
        chatJid: pending.chatJid,
        expiredAt: now,
        reason: 'timeout',
      });
      logger.info(
        { requestId: id, chatJid: pending.chatJid },
        'Permission gate confirmation timed out, auto-denying',
      );
      pending.resolve({ confirmed: false });
    }
  }, 5_000);
  timeoutInterval.unref?.();
}

startTimeoutChecker();

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

export function getExpiredConfirmation(requestId: string): {
  chatJid?: string;
  expiredAt: number;
  reason: 'timeout' | 'cancelled';
} | null {
  return expiredConfirmations.get(requestId) || null;
}

export function cancelPendingConfirmationsForChat(
  chatJid: string,
  reason: 'cancelled' | 'timeout' = 'cancelled',
): number {
  let count = 0;
  const now = Date.now();
  for (const [id, pending] of pendingConfirmations) {
    if (pending.chatJid !== chatJid) continue;
    pendingConfirmations.delete(id);
    expiredConfirmations.set(id, {
      chatJid: pending.chatJid,
      expiredAt: now,
      reason,
    });
    pending.resolve({ confirmed: false });
    count += 1;
  }
  if (count > 0) {
    logger.info(
      { chatJid, count, reason },
      'Permission gate confirmations cancelled for chat',
    );
  }
  return count;
}

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

export function parsePermissionGateCallback(
  callbackData: string,
): string | null {
  if (
    callbackData.startsWith('pg_allow:') ||
    callbackData.startsWith('pg_block:')
  ) {
    return callbackData.split(':')[1] || null;
  }
  return null;
}

export function shouldPromptPermissionGate(
  request: ExtensionUIRequest,
): boolean {
  return request.method === 'confirm';
}
