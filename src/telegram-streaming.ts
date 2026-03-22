import { normalizeTelegramDraftText, type TelegramBot } from './telegram.js';

export interface TelegramMessagePreviewState {
  messageId: number;
  lastText: string;
  updatedAt: number;
}

export interface TelegramStreamState {
  mode: 'message';
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
    return { effectiveStreamed: true, messagePreviewState: null };
  }
  if (params.previewState) {
    return { effectiveStreamed: true, messagePreviewState: params.previewState };
  }
  return { effectiveStreamed: false, messagePreviewState: null };
}

const BACKOFF_STEPS_MS = [1_000, 3_000, 10_000];
const MAX_FAILURES_BEFORE_DISABLE = 4;
const DISABLE_TTL_MS = 120_000;
const MIN_PREVIEW_CHARS = 20;

class BaseTelegramStreamRegistry {
  private readonly disabledUntil = new Map<string, number>();
  private readonly streamStates = new Map<string, TelegramStreamState>();
  private readonly completedRuns = new Map<string, number>();
  private readonly failureCounts = new Map<string, { count: number; retryAfter: number }>();
  private readonly pendingReactions = new Map<string, string | null>();
  private readonly toolTrails = new Map<string, string[]>();

  constructor(
    protected readonly ttlMs: number,
    protected readonly maxStates = 2000,
  ) {}

  isDisabled(runKey: string, now = Date.now()): boolean {
    const until = this.disabledUntil.get(runKey);
    if (until && until > now) return true;
    if (until && until <= now) this.disabledUntil.delete(runKey);

    const failure = this.failureCounts.get(runKey);
    if (failure && failure.retryAfter > now) return true;
    return false;
  }

  disable(runKey: string, now = Date.now()): void {
    this.disabledUntil.set(runKey, now + DISABLE_TTL_MS);
  }

  recordFailure(runKey: string, now = Date.now()): { count: number; disabled: boolean } {
    const existing = this.failureCounts.get(runKey);
    const count = (existing?.count ?? 0) + 1;
    if (count >= MAX_FAILURES_BEFORE_DISABLE) {
      this.failureCounts.delete(runKey);
      this.disable(runKey, now);
      return { count, disabled: true };
    }
    const backoffMs = BACKOFF_STEPS_MS[Math.min(count - 1, BACKOFF_STEPS_MS.length - 1)];
    this.failureCounts.set(runKey, { count, retryAfter: now + backoffMs });
    return { count, disabled: false };
  }

  clearFailures(runKey: string): void {
    this.failureCounts.delete(runKey);
  }

  setPendingReaction(runKey: string, emoji: string | null): void {
    this.pendingReactions.set(runKey, emoji);
  }

  consumePendingReaction(runKey: string): string | null | undefined {
    const emoji = this.pendingReactions.get(runKey);
    if (emoji !== undefined) this.pendingReactions.delete(runKey);
    return emoji;
  }

  appendToolTrail(runKey: string, entry: string): void {
    const trail = this.toolTrails.get(runKey) || [];
    trail.push(entry);
    this.toolTrails.set(runKey, trail);
  }

  getToolTrailFooter(runKey: string): string | undefined {
    const trail = this.toolTrails.get(runKey);
    if (!trail || trail.length === 0) return undefined;
    return trail.join(' → ');
  }

  clearToolTrail(runKey: string): void {
    this.toolTrails.delete(runKey);
  }

  getStreamState(runKey: string): TelegramStreamState | undefined {
    return this.streamStates.get(runKey);
  }

  setStreamState(runKey: string, state: TelegramStreamState): void {
    this.streamStates.set(runKey, state);
  }

  clearStreamState(runKey: string): void {
    this.streamStates.delete(runKey);
  }

  getPreviewState(runKey: string): TelegramMessagePreviewState | undefined {
    const state = this.streamStates.get(runKey);
    return state
      ? { messageId: state.messageId, lastText: state.lastText, updatedAt: state.updatedAt }
      : undefined;
  }

  setPreviewState(runKey: string, state: TelegramMessagePreviewState): void {
    this.streamStates.set(runKey, {
      mode: 'message',
      messageId: state.messageId,
      lastText: state.lastText,
      updatedAt: state.updatedAt,
    });
  }

  consumePreviewState(runKey: string): TelegramMessagePreviewState | null {
    const state = this.streamStates.get(runKey);
    this.streamStates.delete(runKey);
    return state
      ? { messageId: state.messageId, lastText: state.lastText, updatedAt: state.updatedAt }
      : null;
  }

  clearPreviewState(runKey: string): void {
    this.streamStates.delete(runKey);
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
    for (const [runKey, state] of this.streamStates.entries()) {
      if (state.updatedAt <= staleCutoff) this.streamStates.delete(runKey);
    }
    for (const [runKey, completedAt] of this.completedRuns.entries()) {
      if (completedAt <= staleCutoff) this.completedRuns.delete(runKey);
    }
    for (const [runKey, failure] of this.failureCounts.entries()) {
      if (failure.retryAfter <= now) this.failureCounts.delete(runKey);
    }
    for (const runKey of this.toolTrails.keys()) {
      if (!this.streamStates.has(runKey) && !this.completedRuns.has(runKey)) {
        this.toolTrails.delete(runKey);
      }
    }
    while (this.streamStates.size > this.maxStates) {
      const oldestKey = this.streamStates.keys().next().value as string | undefined;
      if (!oldestKey) break;
      this.streamStates.delete(oldestKey);
    }
  }
}

export class TelegramStreamRegistry extends BaseTelegramStreamRegistry {}

export class TelegramPreviewRegistry extends TelegramStreamRegistry {}

export async function updateTelegramPreview(params: {
  bot: Pick<TelegramBot, 'sendStreamMessage' | 'editStreamMessage'>;
  registry: TelegramStreamRegistry;
  chatJid: string;
  requestId: string;
  text: string;
  toolTrailFooter?: string;
}): Promise<{
  runKey: string;
  sent: boolean;
  disabled: boolean;
  error?: string;
  messageId?: number;
  pendingReaction?: string | null;
}> {
  const runKey = getTelegramPreviewRunKey(params.chatJid, params.requestId);
  params.registry.prune();
  if (params.registry.isDisabled(runKey)) {
    return { runKey, sent: false, disabled: true };
  }

  try {
    const now = Date.now();
    const baseText = normalizeTelegramDraftText(params.text);
    const nextText = params.toolTrailFooter
      ? `${baseText}\n\n${params.toolTrailFooter}`
      : baseText;
    const state = params.registry.getStreamState(runKey);

    if (!state && nextText.length < MIN_PREVIEW_CHARS) {
      return { runKey, sent: false, disabled: false };
    }

    if (state && state.lastText === nextText) {
      params.registry.setStreamState(runKey, { ...state, updatedAt: now });
      return {
        runKey,
        sent: false,
        disabled: false,
        messageId: state.messageId,
      };
    }

    if (state) {
      await params.bot.editStreamMessage(params.chatJid, state.messageId, nextText);
      params.registry.setStreamState(runKey, {
        mode: 'message',
        messageId: state.messageId,
        lastText: nextText,
        updatedAt: now,
      });
      params.registry.clearFailures(runKey);
      return { runKey, sent: true, disabled: false, messageId: state.messageId };
    }

    const messageId = await params.bot.sendStreamMessage(params.chatJid, nextText);
    params.registry.setStreamState(runKey, {
      mode: 'message',
      messageId,
      lastText: nextText,
      updatedAt: now,
    });
    params.registry.clearFailures(runKey);
    const pendingReaction = params.registry.consumePendingReaction(runKey);
    return { runKey, sent: true, disabled: false, messageId, pendingReaction };
  } catch (err) {
    const failure = params.registry.recordFailure(runKey);
    return {
      runKey,
      sent: false,
      disabled: failure.disabled,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

