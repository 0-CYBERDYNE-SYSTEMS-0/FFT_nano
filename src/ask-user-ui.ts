import type { ExtensionUIRequest, ExtensionUIResponse } from './pi-runner.js';
import { logger } from './logger.js';

/**
 * Pending ask_user request.
 *
 * Mirrors the pendingConfirmation shape used by the permission gate so the
 * two flows feel identical from the host's point of view, but lives in its
 * own map keyed off `requestId` and uses a separate `au:` Telegram callback
 * namespace so a permission-gate Allow click can never satisfy an ask_user
 * question (or vice versa).
 *
 * Callback format (intentionally short to stay well under Telegram's
 * 64-byte `callback_data` cap):
 *
 *     au:<requestId>:<index>
 *
 * The trailing `index` is a single digit (0-5) pointing into `options[]`.
 * The host resolves `(requestId, index) -> option label` by looking up the
 * pending record — option labels themselves are never encoded into
 * `callback_data`, so option text can be any length.
 */
export interface PendingAskUser {
  requestId: string;
  chatJid?: string;
  /** The exact option labels the host sent as buttons. Indexed by the callback's `index` field. */
  options: string[];
  resolve: (response: ExtensionUIResponse) => void;
  reject: (err: Error) => void;
  createdAt: number;
  timeoutMs: number;
}

const pendingAskUsers = new Map<string, PendingAskUser>();
const expiredAskUsers = new Map<
  string,
  { chatJid?: string; expiredAt: number; reason: 'timeout' | 'cancelled' }
>();
const EXPIRED_ASK_USER_TTL_MS = 10 * 60_000;

let timeoutInterval: ReturnType<typeof setInterval> | null = null;

function startTimeoutChecker(): void {
  if (timeoutInterval) return;
  timeoutInterval = setInterval(() => {
    const now = Date.now();
    for (const [id, expired] of expiredAskUsers) {
      if (now - expired.expiredAt > EXPIRED_ASK_USER_TTL_MS) {
        expiredAskUsers.delete(id);
      }
    }
    for (const [id, pending] of pendingAskUsers) {
      if (now - pending.createdAt <= pending.timeoutMs) continue;
      pendingAskUsers.delete(id);
      expiredAskUsers.set(id, {
        chatJid: pending.chatJid,
        expiredAt: now,
        reason: 'timeout',
      });
      logger.info(
        { requestId: id, chatJid: pending.chatJid },
        'Ask-user request timed out, defaulting to first option',
      );
      // Resolve with no value so the extension substitutes the timeout default.
      pending.resolve({});
    }
  }, 5_000);
  timeoutInterval.unref?.();
}

startTimeoutChecker();

export function createPendingAskUser(
  requestId: string,
  chatJid: string | undefined,
  options: string[],
  timeoutMs: number,
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

  pendingAskUsers.set(requestId, {
    requestId,
    chatJid,
    options,
    resolve,
    reject,
    createdAt: Date.now(),
    timeoutMs,
  });

  logger.debug(
    { requestId, chatJid, optionCount: options.length, timeoutMs },
    'Ask-user confirmation created',
  );

  return { promise, resolve, reject };
}

export function cancelPendingAskUsersForChat(
  chatJid: string,
  reason: 'cancelled' | 'timeout' = 'cancelled',
): number {
  let count = 0;
  const now = Date.now();
  for (const [id, pending] of pendingAskUsers) {
    if (pending.chatJid !== chatJid) continue;
    pendingAskUsers.delete(id);
    expiredAskUsers.set(id, {
      chatJid: pending.chatJid,
      expiredAt: now,
      reason,
    });
    pending.resolve({});
    count += 1;
  }
  if (count > 0) {
    logger.info(
      { chatJid, count, reason },
      'Ask-user confirmations cancelled for chat',
    );
  }
  return count;
}

export function resolvePendingAskUser(
  requestId: string,
  response: ExtensionUIResponse,
): boolean {
  const pending = pendingAskUsers.get(requestId);
  if (!pending) return false;

  pendingAskUsers.delete(requestId);
  pending.resolve(response);
  logger.info(
    { requestId, chatJid: pending.chatJid, response },
    'Ask-user confirmation resolved',
  );
  return true;
}

export function getExpiredAskUser(requestId: string): {
  chatJid?: string;
  expiredAt: number;
  reason: 'timeout' | 'cancelled';
} | null {
  return expiredAskUsers.get(requestId) || null;
}

export function getPendingAskUser(requestId: string): PendingAskUser | null {
  return pendingAskUsers.get(requestId) || null;
}

export function parseAskUserCallback(
  callbackData: string,
): { requestId: string; index: number } | null {
  // Format: au:<requestId>:<index>
  // `index` is a single digit 0-5 (string form of an integer 0..5).
  if (!callbackData.startsWith('au:')) return null;
  const rest = callbackData.slice(3);
  const colon = rest.lastIndexOf(':');
  if (colon <= 0) return null;
  const requestId = rest.slice(0, colon);
  const indexStr = rest.slice(colon + 1);
  if (!requestId || !/^\d$/.test(indexStr)) return null;
  const index = Number.parseInt(indexStr, 10);
  if (!Number.isInteger(index) || index < 0 || index > 5) return null;
  return { requestId, index };
}

export function shouldPromptAskUser(request: ExtensionUIRequest): boolean {
  return request.method === 'select';
}
