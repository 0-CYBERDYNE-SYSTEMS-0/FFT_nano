import { normalizeTelegramDraftText, type TelegramBot } from './telegram.js';

export interface TelegramDraftIpcMessage {
  type: 'telegram_draft_update';
  chatJid: string;
  requestId?: string;
  draftId: number;
  text: string;
  messageThreadId?: number;
}

export function parseTelegramDraftIpcMessage(
  value: unknown,
): TelegramDraftIpcMessage | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (raw.type !== 'telegram_draft_update') return null;
  if (typeof raw.chatJid !== 'string' || !raw.chatJid.trim()) return null;
  if (!Number.isInteger(raw.draftId) || Number(raw.draftId) <= 0) return null;
  if (typeof raw.text !== 'string') return null;
  const parsed: TelegramDraftIpcMessage = {
    type: 'telegram_draft_update',
    chatJid: raw.chatJid.trim(),
    draftId: Number(raw.draftId),
    text: normalizeTelegramDraftText(raw.text),
  };
  if (typeof raw.requestId === 'string' && raw.requestId.trim()) {
    parsed.requestId = raw.requestId.trim();
  }
  if (
    typeof raw.messageThreadId === 'number' &&
    Number.isFinite(raw.messageThreadId) &&
    Number.isInteger(raw.messageThreadId)
  ) {
    parsed.messageThreadId = Math.trunc(raw.messageThreadId);
  }
  return parsed;
}

export function getTelegramDraftRunKey(
  chatJid: string,
  requestId: string | undefined,
  draftId: number,
): string {
  if (requestId && requestId.trim()) {
    return `${chatJid}:${requestId.trim()}`;
  }
  return `${chatJid}:draft:${draftId}`;
}

export type TelegramStreamState =
  | { mode: 'draft'; lastText: string; updatedAt: number }
  | { mode: 'message'; messageId: number; lastText: string; updatedAt: number };

export function resolveTelegramStreamCompletionState(params: {
  reportedStreamed: boolean;
  externallyCompleted: boolean;
  streamState: TelegramStreamState | null;
}): {
  effectiveStreamed: boolean;
  messagePreviewState: { messageId: number; lastText: string; updatedAt: number } | null;
  usedDraftState: boolean;
} {
  if (params.externallyCompleted) {
    return {
      effectiveStreamed: true,
      messagePreviewState: null,
      usedDraftState: false,
    };
  }

  if (params.streamState?.mode === 'message') {
    return {
      effectiveStreamed: true,
      messagePreviewState: {
        messageId: params.streamState.messageId,
        lastText: params.streamState.lastText,
        updatedAt: params.streamState.updatedAt,
      },
      usedDraftState: false,
    };
  }

  if (params.streamState?.mode === 'draft') {
    return {
      effectiveStreamed: false,
      messagePreviewState: null,
      usedDraftState: true,
    };
  }

  return {
    effectiveStreamed: false,
    messagePreviewState: null,
    usedDraftState: false,
  };
}

export class TelegramDraftDisableRegistry {
  private disabledUntil = new Map<string, number>();
  private streamStates = new Map<string, TelegramStreamState>();
  private ttlMs: number;
  private maxStreamStates: number;

  constructor(ttlMs: number, maxStreamStates = 2000) {
    this.ttlMs = Math.max(1, Math.floor(ttlMs));
    this.maxStreamStates = Math.max(50, Math.floor(maxStreamStates));
  }

  disable(runKey: string, now = Date.now()): void {
    this.disabledUntil.set(runKey, now + this.ttlMs);
  }

  isDisabled(runKey: string, now = Date.now()): boolean {
    const until = this.disabledUntil.get(runKey);
    if (!until) return false;
    if (until <= now) {
      this.disabledUntil.delete(runKey);
      return false;
    }
    return true;
  }

  prune(now = Date.now()): void {
    for (const [runKey, until] of this.disabledUntil.entries()) {
      if (until <= now) this.disabledUntil.delete(runKey);
    }
    const staleCutoff = now - this.ttlMs * 4;
    for (const [runKey, state] of this.streamStates.entries()) {
      if (state.updatedAt <= staleCutoff) {
        this.streamStates.delete(runKey);
      }
    }
    while (this.streamStates.size > this.maxStreamStates) {
      const oldestKey = this.streamStates.keys().next().value as string | undefined;
      if (!oldestKey) break;
      this.streamStates.delete(oldestKey);
    }
  }

  size(): number {
    return this.disabledUntil.size;
  }

  getStreamState(
    runKey: string,
  ): TelegramStreamState | undefined {
    return this.streamStates.get(runKey);
  }

  setStreamState(
    runKey: string,
    state: TelegramStreamState,
  ): void {
    this.streamStates.set(runKey, state);
  }
}

export async function sendTelegramDraftWithFallback(params: {
  bot: Pick<
    TelegramBot,
    'sendMessageDraft' | 'sendStreamMessage' | 'editStreamMessage'
  >;
  draft: TelegramDraftIpcMessage;
  registry: TelegramDraftDisableRegistry;
}): Promise<{ runKey: string; sent: boolean; disabled: boolean; error?: string }> {
  const runKey = getTelegramDraftRunKey(
    params.draft.chatJid,
    params.draft.requestId,
    params.draft.draftId,
  );
  params.registry.prune();
  if (params.registry.isDisabled(runKey)) {
    return { runKey, sent: false, disabled: true };
  }

  try {
    const now = Date.now();
    const state = params.registry.getStreamState(runKey);
    if (state && state.lastText === params.draft.text) {
      params.registry.setStreamState(runKey, { ...state, updatedAt: now });
      return { runKey, sent: false, disabled: false };
    }

    const messageThreadOptions =
      typeof params.draft.messageThreadId === 'number'
        ? { messageThreadId: params.draft.messageThreadId }
        : undefined;

    if (state?.mode === 'message') {
      await params.bot.editStreamMessage(
        params.draft.chatJid,
        state.messageId,
        params.draft.text,
        messageThreadOptions,
      );
      params.registry.setStreamState(runKey, {
        mode: 'message',
        messageId: state.messageId,
        lastText: params.draft.text,
        updatedAt: now,
      });
      return { runKey, sent: true, disabled: false };
    }

    // Prefer native draft streaming. Fallback to visible message+edits only if
    // draft sending has not succeeded yet for this run.
    try {
      await params.bot.sendMessageDraft(
        params.draft.chatJid,
        params.draft.draftId,
        params.draft.text,
        messageThreadOptions,
      );
      params.registry.setStreamState(runKey, {
        mode: 'draft',
        lastText: params.draft.text,
        updatedAt: now,
      });
      return { runKey, sent: true, disabled: false };
    } catch (draftErr) {
      if (state?.mode === 'draft') {
        throw draftErr;
      }
      const messageId = await params.bot.sendStreamMessage(
        params.draft.chatJid,
        params.draft.text,
        messageThreadOptions,
      );
      params.registry.setStreamState(runKey, {
        mode: 'message',
        messageId,
        lastText: params.draft.text,
        updatedAt: now,
      });
      return { runKey, sent: true, disabled: false };
    }
  } catch (err) {
    params.registry.disable(runKey);
    return {
      runKey,
      sent: false,
      disabled: true,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
