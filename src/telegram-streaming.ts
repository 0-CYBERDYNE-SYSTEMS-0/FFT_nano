import {
  normalizeTelegramPreviewText,
  splitTelegramPreviewText,
  type TelegramBot,
} from './telegram.js';
import { logger } from './logger.js';

export interface TelegramMessagePreviewState {
  // Active (last) bubble id — retained for callers that take a single id.
  messageId: number;
  // All preview bubble ids in order; a long reply spans more than one.
  messageIds: number[];
  // Current text rendered in each bubble (parallel to messageIds), used to
  // skip unchanged edits.
  bubbleTexts: string[];
  // Full accumulated preview text (never truncated), for downstream consumers
  // that fall back to the streamed text.
  lastText: string;
  updatedAt: number;
}

export interface TelegramMessageStreamState {
  mode: 'message';
  messageId: number;
  messageIds: number[];
  bubbleTexts: string[];
  lastText: string;
  updatedAt: number;
}

export interface TelegramDraftStreamState {
  mode: 'draft';
  draftId: number;
  lastText: string;
  updatedAt: number;
}

export type TelegramStreamState =
  | TelegramMessageStreamState
  | TelegramDraftStreamState;

export function getTelegramPreviewRunKey(
  chatJid: string,
  requestId: string,
): string {
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
    return {
      effectiveStreamed: true,
      messagePreviewState: params.previewState,
    };
  }
  return { effectiveStreamed: false, messagePreviewState: null };
}

const RUN_STATUS_PREVIEW_PREFIXES = [
  'Agent status:',
  'Coder status:',
  'Skill manager status:',
  'Librarian status:',
  'Run status:',
  'Working on your reply',
];

export function isTelegramRunStatusPreviewText(text: string): boolean {
  const trimmed = text.trim();
  return RUN_STATUS_PREVIEW_PREFIXES.some((prefix) =>
    trimmed.startsWith(prefix),
  );
}

const BACKOFF_STEPS_MS = [1_000, 3_000, 10_000];
const MAX_FAILURES_BEFORE_DISABLE = 4;
const DISABLE_TTL_MS = 120_000;
const MIN_PREVIEW_CHARS = 20;

class BaseTelegramStreamRegistry {
  private readonly disabledUntil = new Map<string, number>();
  private readonly streamStates = new Map<string, TelegramStreamState>();
  private readonly completedRuns = new Map<string, number>();
  private readonly failureCounts = new Map<
    string,
    { count: number; retryAfter: number }
  >();
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

  recordFailure(
    runKey: string,
    now = Date.now(),
  ): { count: number; disabled: boolean } {
    const existing = this.failureCounts.get(runKey);
    const count = (existing?.count ?? 0) + 1;
    if (count >= MAX_FAILURES_BEFORE_DISABLE) {
      this.failureCounts.delete(runKey);
      this.disable(runKey, now);
      return { count, disabled: true };
    }
    const backoffMs =
      BACKOFF_STEPS_MS[Math.min(count - 1, BACKOFF_STEPS_MS.length - 1)];
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
    if (trail[trail.length - 1] === entry) return;
    trail.push(entry);
    this.toolTrails.set(runKey, trail.slice(-8));
  }

  getToolTrailFooter(runKey: string): string | undefined {
    const trail = this.toolTrails.get(runKey);
    if (!trail || trail.length === 0) return undefined;
    return `Tools: ${trail.join(' → ')}`;
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
    return state?.mode === 'message'
      ? {
          messageId: state.messageId,
          messageIds: [...state.messageIds],
          bubbleTexts: [...state.bubbleTexts],
          lastText: state.lastText,
          updatedAt: state.updatedAt,
        }
      : undefined;
  }

  setPreviewState(runKey: string, state: TelegramMessagePreviewState): void {
    this.streamStates.set(runKey, {
      mode: 'message',
      messageId: state.messageId,
      messageIds: [...state.messageIds],
      bubbleTexts: [...state.bubbleTexts],
      lastText: state.lastText,
      updatedAt: state.updatedAt,
    });
  }

  getDraftState(runKey: string): TelegramDraftStreamState | undefined {
    const state = this.streamStates.get(runKey);
    return state?.mode === 'draft' ? state : undefined;
  }

  setDraftState(runKey: string, state: TelegramDraftStreamState): void {
    this.streamStates.set(runKey, state);
  }

  consumeDraftState(runKey: string): TelegramDraftStreamState | null {
    const state = this.streamStates.get(runKey);
    this.streamStates.delete(runKey);
    return state?.mode === 'draft' ? state : null;
  }

  clearDraftState(runKey: string): void {
    const state = this.streamStates.get(runKey);
    if (state?.mode === 'draft') this.streamStates.delete(runKey);
  }

  consumePreviewState(runKey: string): TelegramMessagePreviewState | null {
    const state = this.streamStates.get(runKey);
    this.streamStates.delete(runKey);
    return state?.mode === 'message'
      ? {
          messageId: state.messageId,
          messageIds: [...state.messageIds],
          bubbleTexts: [...state.bubbleTexts],
          lastText: state.lastText,
          updatedAt: state.updatedAt,
        }
      : null;
  }

  clearPreviewState(runKey: string): void {
    this.streamStates.delete(runKey);
  }

  noteCompleted(runKey: string, now = Date.now()): void {
    this.completedRuns.set(runKey, now);
  }

  isCompleted(runKey: string): boolean {
    return this.completedRuns.has(runKey);
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
      const oldestKey = this.streamStates.keys().next().value as
        | string
        | undefined;
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
  if (params.registry.isCompleted(runKey)) {
    return { runKey, sent: false, disabled: true };
  }
  if (params.registry.isDisabled(runKey)) {
    return { runKey, sent: false, disabled: true };
  }

  try {
    const now = Date.now();
    const footer = params.toolTrailFooter
      ? `\n\n${params.toolTrailFooter}`
      : '';
    const fullText = params.text.replace(/\r\n/g, '\n');
    const state = params.registry.getStreamState(runKey);
    if (state?.mode === 'draft') {
      params.registry.clearDraftState(runKey);
    }
    const existing = state?.mode === 'message' ? state : undefined;

    // Split into bubble-sized bodies; the tool-trail footer rides the last
    // bubble only so it follows the live tail without being duplicated.
    const bodies = splitTelegramPreviewText(fullText);
    if (bodies.length === 0) {
      return { runKey, sent: false, disabled: false };
    }
    const targetTexts = bodies.map((body, i) =>
      i === bodies.length - 1 ? `${body}${footer}` : body,
    );

    if (!existing && fullText.length + footer.length < MIN_PREVIEW_CHARS) {
      return { runKey, sent: false, disabled: false };
    }

    const ids = existing ? [...existing.messageIds] : [];
    const prevTexts = existing ? [...existing.bubbleTexts] : [];

    const unchanged =
      existing !== undefined &&
      ids.length === targetTexts.length &&
      targetTexts.every((text, i) => prevTexts[i] === text);
    if (unchanged) {
      params.registry.setStreamState(runKey, { ...existing, updatedAt: now });
      return {
        runKey,
        sent: false,
        disabled: false,
        messageId: ids[ids.length - 1],
      };
    }

    // Mirrors `ids`; persisted after each delivery so a transient failure
    // mid-pagination never re-sends an already-delivered bubble on retry.
    const committedTexts = [...prevTexts];
    const persistProgress = () => {
      params.registry.setStreamState(runKey, {
        mode: 'message',
        messageId: ids[ids.length - 1],
        messageIds: ids,
        bubbleTexts: committedTexts,
        lastText: fullText,
        updatedAt: Date.now(),
      });
    };

    let sentAny = false;
    for (let i = 0; i < targetTexts.length; i++) {
      const text = targetTexts[i];
      if (i < ids.length) {
        if (committedTexts[i] !== text) {
          await params.bot.editStreamMessage(params.chatJid, ids[i], text);
          committedTexts[i] = text;
          persistProgress();
          sentAny = true;
        }
      } else {
        const id = await params.bot.sendStreamMessage(params.chatJid, text);
        ids.push(id);
        committedTexts.push(text);
        persistProgress();
        sentAny = true;
      }
    }

    const activeId = ids[ids.length - 1];
    params.registry.clearFailures(runKey);
    const pendingReaction = existing
      ? undefined
      : params.registry.consumePendingReaction(runKey);
    return {
      runKey,
      sent: sentAny,
      disabled: false,
      messageId: activeId,
      pendingReaction,
    };
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

export async function updateTelegramDraftPreview(params: {
  bot: Pick<TelegramBot, 'sendMessageDraft'>;
  registry: TelegramStreamRegistry;
  chatJid: string;
  requestId: string;
  draftId: number;
  text: string;
  toolTrailFooter?: string;
}): Promise<{
  runKey: string;
  sent: boolean;
  disabled: boolean;
  error?: string;
  draftId?: number;
}> {
  const runKey = getTelegramPreviewRunKey(params.chatJid, params.requestId);
  params.registry.prune();
  if (params.registry.isCompleted(runKey)) {
    return { runKey, sent: false, disabled: true };
  }
  if (params.registry.isDisabled(runKey)) {
    return { runKey, sent: false, disabled: true };
  }

  try {
    const now = Date.now();
    const baseText = normalizeTelegramPreviewText(params.text);
    const nextText = params.toolTrailFooter
      ? `${baseText}\n\n${params.toolTrailFooter}`
      : baseText;
    const state = params.registry.getStreamState(runKey);
    if (state?.mode === 'message') {
      params.registry.clearPreviewState(runKey);
    }

    const existingDraftState = params.registry.getDraftState(runKey);
    if (!existingDraftState && nextText.length < MIN_PREVIEW_CHARS) {
      return { runKey, sent: false, disabled: false };
    }

    if (existingDraftState && existingDraftState.lastText === nextText) {
      params.registry.setDraftState(runKey, {
        ...existingDraftState,
        updatedAt: now,
      });
      return {
        runKey,
        sent: false,
        disabled: false,
        draftId: existingDraftState.draftId,
      };
    }

    const draftId = existingDraftState?.draftId || params.draftId;
    await params.bot.sendMessageDraft(params.chatJid, draftId, nextText);
    params.registry.setDraftState(runKey, {
      mode: 'draft',
      draftId,
      lastText: nextText,
      updatedAt: now,
    });
    params.registry.clearFailures(runKey);
    return { runKey, sent: true, disabled: false, draftId };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const failure = params.registry.recordFailure(runKey);
    if (failure.disabled) {
      logger.warn(
        { runKey, failureCount: failure.count, err: error },
        'Telegram draft preview disabled after repeated failures',
      );
    } else {
      logger.debug(
        { runKey, failureCount: failure.count, err: error },
        'Telegram draft preview failed; backing off before retry',
      );
    }
    return {
      runKey,
      sent: false,
      disabled: failure.disabled,
      error,
    };
  }
}
