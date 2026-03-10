import fs from 'fs';

import { WORKSPACE_IPC_MESSAGES_DIR } from './runtime-paths.js';

const TELEGRAM_DRAFT_PREFIX = '...';
const TELEGRAM_DRAFT_MAX_LEN = 4096;

export interface TelegramDraftUpdate {
  chatJid: string;
  requestId?: string;
  draftId: number;
  text: string;
  messageThreadId?: number;
}

export function deriveTelegramDraftId(seed: string): number {
  const input = seed.trim() || `draft-${Date.now()}`;
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const raw = hash >>> 0;
  return (raw % 2_000_000_000) + 1;
}

export function normalizeTelegramDraftText(text: string): string {
  const normalized = text.replace(/\r\n/g, '\n');
  if (!normalized) return '.';
  if (normalized.length <= TELEGRAM_DRAFT_MAX_LEN) return normalized;
  const suffixLen = Math.max(1, TELEGRAM_DRAFT_MAX_LEN - TELEGRAM_DRAFT_PREFIX.length);
  return `${TELEGRAM_DRAFT_PREFIX}${normalized.slice(-suffixLen)}`;
}

export function writeIpcTelegramDraftUpdate(update: TelegramDraftUpdate): boolean {
  const chatJid = update.chatJid.trim();
  if (!chatJid) return false;
  if (!Number.isInteger(update.draftId) || update.draftId <= 0) return false;

  try {
    const dir = WORKSPACE_IPC_MESSAGES_DIR;
    fs.mkdirSync(dir, { recursive: true });
    const ts = Date.now();
    const rand = Math.random().toString(36).slice(2, 8);
    const tmp = `${dir}/.tmp_${ts}_${rand}.json`;
    const out = `${dir}/draft_${ts}_${rand}.json`;
    const text = normalizeTelegramDraftText(update.text);
    const payload: Record<string, unknown> = {
      type: 'telegram_draft_update',
      chatJid,
      requestId: (update.requestId || '').trim(),
      draftId: update.draftId,
      text,
    };
    if (
      typeof update.messageThreadId === 'number' &&
      Number.isFinite(update.messageThreadId)
    ) {
      payload.messageThreadId = Math.trunc(update.messageThreadId);
    }
    fs.writeFileSync(tmp, JSON.stringify(payload));
    fs.renameSync(tmp, out);
    return true;
  } catch {
    return false;
  }
}
