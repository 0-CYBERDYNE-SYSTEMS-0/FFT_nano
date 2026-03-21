import { normalizeTelegramDraftText, type TelegramBot } from './telegram.js';

export interface TelegramMessagePreviewState {
  messageId: number;
  lastText: string;
  updatedAt: number;
}

export function getTelegramPreviewRunKey(chatJid: string, requestId: string): string {
  return `${chatJid}:${requestId}`;
}

export function resolveTelegramStreamCompletionState(params: {
  externallyCompleted: boolean;
  previewState: TelegramMessagePreviewState | null;
}): {
  effectiveStreamed: boolean;
  messagePreviewState: TelegramMessagePreviewState | null;
} {
  if (params.externallyCompleted) {
    return {
      effectiveStreamed: true,
      messagePreviewState: null,
    };
  }
  if (params.previewState) {
    return {
      effectiveStreamed: true,
      messagePreviewState: params.previewState,
    };
  }
  return {
    effectiveStreamed: false,
    messagePreviewState: null,
  };
}

export class TelegramPreviewRegistry {
  private readonly disabledUntil = new Map<string, number>();
  private readonly previewStates = new Map<string, TelegramMessagePreviewState>();
  private readonly completedRuns = new Map<string, number>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxStates = 2000,
  ) {}

  isDisabled(runKey: string, now = Date.now()): boolean {
    const until = this.disabledUntil.get(runKey);
    if (!until) return false;
    if (until <= now) {
      this.disabledUntil.delete(runKey);
      return false;
    }
    return true;
  }

  disable(runKey: string, now = Date.now()): void {
    this.disabledUntil.set(runKey, now + this.ttlMs);
  }

  getPreviewState(runKey: string): TelegramMessagePreviewState | undefined {
    return this.previewStates.get(runKey);
  }

  setPreviewState(runKey: string, state: TelegramMessagePreviewState): void {
    this.previewStates.set(runKey, state);
  }

  consumePreviewState(runKey: string): TelegramMessagePreviewState | null {
    const state = this.previewStates.get(runKey) || null;
    this.previewStates.delete(runKey);
    return state;
  }

  clearPreviewState(runKey: string): void {
    this.previewStates.delete(runKey);
  }

  noteCompleted(runKey: string, now = Date.now()): void {
    this.completedRuns.set(runKey, now);
  }

  consumeCompleted(runKey: string): boolean {
    const had = this.completedRuns.has(runKey);
    if (had) this.completedRuns.delete(runKey);
    return had;
  }

  prune(now = Date.now()): void {
    for (const [runKey, until] of this.disabledUntil.entries()) {
      if (until <= now) this.disabledUntil.delete(runKey);
    }
    const staleCutoff = now - this.ttlMs * 4;
    for (const [runKey, state] of this.previewStates.entries()) {
      if (state.updatedAt <= staleCutoff) this.previewStates.delete(runKey);
    }
    for (const [runKey, completedAt] of this.completedRuns.entries()) {
      if (completedAt <= staleCutoff) this.completedRuns.delete(runKey);
    }
    while (this.previewStates.size > this.maxStates) {
      const oldestKey = this.previewStates.keys().next().value as string | undefined;
      if (!oldestKey) break;
      this.previewStates.delete(oldestKey);
    }
  }
}

export async function updateTelegramPreview(params: {
  bot: Pick<TelegramBot, 'sendStreamMessage' | 'editStreamMessage'>;
  registry: TelegramPreviewRegistry;
  chatJid: string;
  requestId: string;
  text: string;
}): Promise<{
  runKey: string;
  sent: boolean;
  disabled: boolean;
  error?: string;
  messageId?: number;
}> {
  const runKey = getTelegramPreviewRunKey(params.chatJid, params.requestId);
  params.registry.prune();
  if (params.registry.isDisabled(runKey)) {
    return { runKey, sent: false, disabled: true };
  }

  try {
    const now = Date.now();
    const nextText = normalizeTelegramDraftText(params.text);
    const state = params.registry.getPreviewState(runKey);
    if (state && state.lastText === nextText) {
      params.registry.setPreviewState(runKey, { ...state, updatedAt: now });
      return { runKey, sent: false, disabled: false, messageId: state.messageId };
    }

    if (state) {
      await params.bot.editStreamMessage(params.chatJid, state.messageId, nextText);
      params.registry.setPreviewState(runKey, {
        messageId: state.messageId,
        lastText: nextText,
        updatedAt: now,
      });
      return { runKey, sent: true, disabled: false, messageId: state.messageId };
    }

    const messageId = await params.bot.sendStreamMessage(params.chatJid, nextText);
    params.registry.setPreviewState(runKey, {
      messageId,
      lastText: nextText,
      updatedAt: now,
    });
    return { runKey, sent: true, disabled: false, messageId };
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
