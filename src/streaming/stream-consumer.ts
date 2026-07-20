import type { PlatformAdapter } from './platform-adapter.js';
import type { ContainerProgressEvent } from '../pi-runner.js';
import type { VerboseMode } from '../verbose-mode.js';
import type { TelegramDeliveryMode } from '../app-state.js';
import {
  formatToolTrailEntry,
  formatToolTrailFooter,
  formatToolProgressLine,
  formatToolProgressMessage,
  type ToolProgressEvent,
} from './format-tools.js';
import {
  OUTBOUND_DUMP_FALLBACK,
  guardOutboundAgentText,
} from '../outbound-text-guard.js';
import { STREAM_CURSOR, holdbackSilenceMarker } from './stream-filter.js';

const BACKOFF_STEPS_MS = [1_000, 3_000, 10_000];
const MAX_FAILURES_BEFORE_DISABLE = 4;
const MAX_EDIT_FLOOD_STRIKES = 3;
const DISABLE_TTL_MS = 120_000;
const MIN_PREVIEW_CHARS = 20;
const FAST_FLUSH_CHARS = 24;
const FAST_FLUSH_INTERVAL_MS = 400;
// Segment budget for one live bubble: Telegram's 4096 minus the streaming
// cursor and a safety margin (telegram-spec §3.2). Text beyond this is sealed
// into a finalized message and streaming continues in a fresh bubble.
const SEAL_SAFE_LIMIT = 4096 - STREAM_CURSOR.length - 100;
const MAX_APPEND_BLOCK_CHARS = 3_900;
const MAX_TOOL_TRAIL_LENGTH = 8;
const MAX_TOOL_PROGRESS_LINES = 12;
// Below this run age, status text never spawns its own bubble — quick turns stay
// a single content bubble with no progress ceremony. See updateActivity().
const DEFAULT_ACTIVITY_SPAWN_THRESHOLD_MS = 2_500;
// Under /delivery status: milestone-only status lines, debounced.
const STATUS_MILESTONE_MIN_INTERVAL_MS = 6_000;
const STATUS_MILESTONE_PHASES = new Set([
  'spawn',
  'tool_running',
  'waiting_permission',
  'retry_fresh',
  'retry_delay',
  'retry_provider_switch',
  'stale',
  'external_progress',
]);

function deriveStreamDraftId(seed: string): number {
  const input = seed.trim() || `draft-${Date.now()}`;
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const raw = hash >>> 0;
  return (raw % 2_000_000_000) + 1;
}

type OpenCodeFence = {
  marker: '```' | '~~~';
  info: string;
};

function findOpenCodeFence(text: string): OpenCodeFence | null {
  const fencePattern = /(?:^|\n)[ \t]{0,3}(```|~~~)([^\n`~]*)/g;
  let openFence: OpenCodeFence | null = null;
  for (const match of text.matchAll(fencePattern)) {
    const marker = match[1] as OpenCodeFence['marker'];
    if (openFence === null) {
      openFence = { marker, info: (match[2] || '').trim().slice(0, 80) };
    } else if (openFence.marker === marker) {
      openFence = null;
    }
  }
  return openFence;
}

export interface StreamConsumerConfig {
  chatId: string;
  runId: string;
  adapter: PlatformAdapter;
  draftId?: number;
  label?: string;
  heartbeatMs?: number;
  deliveryMode: TelegramDeliveryMode;
  verboseMode: VerboseMode;
  onTuiEvent?: (event: StreamTuiEvent) => void;
  // How long a run must last before status/progress text earns its own
  // (ephemeral) Activity bubble. Quick turns finish before this and stay a
  // single content bubble. Defaults to 2.5s.
  activitySpawnThresholdMs?: number;
  // Minimum interval (ms) between draft edits for coalescing. Defaults based on
  // chatId sign: positive (private) = 800ms, negative (group) = 3000ms.
  // Exposed for testing; prefer FFT_NANO_TELEGRAM_GROUP_EDIT_INTERVAL_MS env var.
  draftMinIntervalMs?: number;
  // Segment sealing (overflow continuation + tool-boundary bubbles). Disabled
  // when the preview text is non-monotonic (e.g. streamed reasoning prefix).
  sealingEnabled?: boolean;
}

export interface StreamTuiEvent {
  kind: 'run_progress' | 'tool_progress';
  phase?: string;
  text?: string;
  detail?: string;
  toolName?: string;
  toolStatus?: string;
}

export interface PreviewState {
  messageId: string;
  lastText: string;
}

export interface FinishResult {
  previewState: PreviewState | null;
  completed: boolean;
}

export class StreamConsumer {
  // Content (Answer) block — streams the assistant's reply and becomes the
  // final answer. In two-block mode nothing else writes here, so it is never
  // overwritten mid-run.
  private messageId: string | null = null;
  private lastText = '';
  private failureCount = 0;
  private disabled = false;
  private disabledUntil = 0;
  private editFloodStrikes = 0;
  private editFloodDisabled = false;
  private completed = false;

  // Activity block — ephemeral bubble carrying status/progress/reasoning churn,
  // kept separate from the content block so the two never clobber each other.
  private activityMessageId: string | null = null;
  private activityText = '';
  private pendingActivityText = '';
  private activitySpawnTimer: NodeJS.Timeout | null = null;
  private activityCollapsed = false;
  private readonly runStartedAt = Date.now();
  private readonly activitySpawnThresholdMs: number;
  // Status and answer content use separate delivery paths in every live mode.
  private readonly twoBlock: boolean;

  private heartbeatTimer: NodeJS.Timeout | null = null;
  private heartbeatPhase = '';
  private heartbeatDetail = '';
  private heartbeatStartedAt = 0;
  private lastProgressFingerprint = '';

  private toolTrail: string[] = [];
  private lastToolName: string | undefined;
  private toolProgressLines: string[] = [];
  private toolProgressMessageId: string | null = null;
  private answerChain: Promise<void> = Promise.resolve();
  private activityChain: Promise<void> = Promise.resolve();

  // One pending slot plus a non-resetting timer prevents continuous output
  // from postponing every edit while still dropping stale intermediate frames.
  private pendingText: string | null = null;
  private flushTimer: NodeJS.Timeout | null = null;
  private flushDueAt = 0;
  private lastAnswerFlushAt = 0;
  private flushSuppressed = false;
  private readonly draftMinIntervalMs: number;

  private draftId: number | null = null;
  private draftMode = false;
  private appendMode = false;
  private statusMode = false;
  private appendSourceText = '';
  private lastMilestoneAt = 0;
  private lastMilestoneKey = '';

  // Segment sealing state (telegram-spec W6/W7). `sealedSourceLen` marks how
  // much of the guarded source text is already sealed into permanent messages;
  // the live bubble only ever renders the remainder. `sealBroken` freezes
  // sealing after a failed seal so the host-side full final delivery restores
  // completeness (possible duplication, never loss).
  private readonly sealingEnabled: boolean;
  private lastSourceText = '';
  private sealedSourceLen = 0;
  private didSeal = false;
  private sealBroken = false;
  private sealedSegmentPrefix = '';
  private outboundBlocked = false;
  private deliveredPreviewMessageIds = new Set<string>();
  private streamGeneration = 0;

  private readonly label: string;
  private readonly heartbeatMs: number;

  constructor(private readonly config: StreamConsumerConfig) {
    this.label = config.label || 'Agent';
    const configuredHeartbeat = config.heartbeatMs ?? 15_000;
    this.heartbeatMs =
      Number.isFinite(configuredHeartbeat) && configuredHeartbeat > 0
        ? configuredHeartbeat
        : 0;
    this.activitySpawnThresholdMs =
      config.activitySpawnThresholdMs ?? DEFAULT_ACTIVITY_SPAWN_THRESHOLD_MS;
    if (config.draftMinIntervalMs !== undefined) {
      this.draftMinIntervalMs = Math.max(0, config.draftMinIntervalMs);
    } else {
      const chatIdNum = this.parseTelegramChatId();
      if (!Number.isNaN(chatIdNum) && chatIdNum < 0) {
        // Group chat (negative chatId)
        const groupInterval = parseInt(
          process.env.FFT_NANO_TELEGRAM_GROUP_EDIT_INTERVAL_MS || '3000',
          10,
        );
        this.draftMinIntervalMs =
          Number.isFinite(groupInterval) && groupInterval >= 0
            ? groupInterval
            : 3000;
      } else {
        // Private chat (positive or non-numeric chatId)
        this.draftMinIntervalMs = 800;
      }
    }
    this.sealingEnabled = config.sealingEnabled !== false;
    this.appendMode = config.deliveryMode === 'append';
    this.statusMode = config.deliveryMode === 'status';
    this.draftMode =
      config.deliveryMode === 'draft' &&
      this.parseTelegramChatId() > 0 &&
      typeof config.adapter.sendDraft === 'function' &&
      config.adapter.supportsDraftStreaming?.(config.chatId) !== false;
    // off: no activity. status/stream/append/draft: activity block allowed.
    this.twoBlock = config.deliveryMode !== 'off';
    this.draftId = this.draftMode
      ? config.draftId ||
        deriveStreamDraftId(`${config.chatId}:${config.runId}`)
      : null;
  }

  async onDelta(text: string): Promise<void> {
    if (this.completed) return;
    if (this.editFloodDisabled) return;
    // off + status: no assistant monologue streaming
    if (
      this.config.deliveryMode === 'off' ||
      this.config.deliveryMode === 'status'
    ) {
      return;
    }
    const guarded = guardOutboundAgentText(text);
    if (!guarded.allow) {
      this.invalidateOutboundPreview();
      return;
    }

    // Hold back partial silence markers so "NO" → "NO_REPLY" never flashes on
    // screen; an exact marker is never previewed at all (telegram-spec W4).
    const source = holdbackSilenceMarker(guarded.text);
    if (!source) return;

    if (this.appendMode) {
      const nextText = this.appendToolTrailFooter(source);
      this.answerChain = this.answerChain
        .catch(() => {})
        .then(() => {
          const appendText = this.extractAppendText(nextText);
          if (!appendText) return;
          return this.sendAppendBlock(appendText, nextText);
        });
      return;
    }

    let segment = source;
    if (this.sealingEnabled) {
      if (
        this.sealedSourceLen > 0 &&
        !source.startsWith(this.lastSourceText.slice(0, this.sealedSourceLen))
      ) {
        // Replace-style delta shrank below the sealed boundary: the buffer now
        // holds a fresh assistant message, so start a new segment.
        this.sealedSourceLen = 0;
        this.sealedSegmentPrefix = '';
      }
      segment = source.slice(this.sealedSourceLen);
      if (this.sealedSourceLen > 0) {
        const trimmedLead = segment.replace(/^\n+/, '');
        this.sealedSourceLen += segment.length - trimmedLead.length;
        segment = trimmedLead;
      }
      // Overflow: seal head chunks as permanent formatted messages and keep
      // streaming the remainder in a fresh bubble (telegram-spec W6).
      while (
        !this.sealBroken &&
        this.sealedSegmentPrefix.length + segment.length > SEAL_SAFE_LIMIT
      ) {
        const rawLimit = SEAL_SAFE_LIMIT - this.sealedSegmentPrefix.length;
        let cut = segment.lastIndexOf('\n', rawLimit);
        if (cut < rawLimit / 2) cut = rawLimit;
        const priorCodeUnit = segment.charCodeAt(cut - 1);
        const nextCodeUnit = segment.charCodeAt(cut);
        const endsWithHighSurrogate =
          priorCodeUnit >= 0xd800 && priorCodeUnit <= 0xdbff;
        const startsWithLowSurrogate =
          nextCodeUnit >= 0xdc00 && nextCodeUnit <= 0xdfff;
        if (endsWithHighSurrogate && startsWithLowSurrogate) cut--;
        const head = `${this.sealedSegmentPrefix}${segment.slice(0, cut)}`;
        const openFence = findOpenCodeFence(head);
        this.enqueueSeal(
          openFence === null ? head : `${head}\n${openFence.marker}`,
        );
        this.sealedSegmentPrefix =
          openFence === null ? '' : `${openFence.marker}${openFence.info}\n`;
        const rest = segment.slice(cut);
        const consumedBoundary = rest.startsWith('\n') ? 1 : 0;
        this.sealedSourceLen += cut + consumedBoundary;
        segment = rest.slice(consumedBoundary);
      }
    }
    this.lastSourceText = source;

    const nextText = this.appendToolTrailFooter(
      `${this.sealedSegmentPrefix}${segment}`,
    );

    const hasExistingDraft = this.draftMode && this.lastText.length > 0;
    if (
      !this.messageId &&
      !hasExistingDraft &&
      nextText.length < MIN_PREVIEW_CHARS
    ) {
      return;
    }

    if ((this.messageId || hasExistingDraft) && this.lastText === nextText) {
      return;
    }

    const fastFlush =
      nextText.length - this.lastText.length >= FAST_FLUSH_CHARS;
    this.pendingText = nextText;
    this.scheduleAnswerFlush(fastFlush);
  }

  handleProgress(event: ContainerProgressEvent): void {
    if (this.completed) return;

    switch (event.kind) {
      case 'spawn':
        this.emitStatusText(
          'spawn',
          event.resumed
            ? `${this.label} status: Resuming worker session.`
            : `${this.label} status: Starting worker session.`,
          event.resumed ? 'resumed' : 'fresh',
        );
        this.clearHeartbeat();
        return;

      case 'thinking':
        this.emitStatusText(
          'thinking',
          `${this.label} status: Reasoning about the task.`,
        );
        this.startHeartbeat('thinking');
        return;

      case 'tool':
        if (event.status !== 'start') {
          this.clearHeartbeat();
          return;
        }
        this.emitStatusText(
          'tool_running',
          `${this.label} status: Running ${event.toolName}.`,
          event.toolName,
        );
        this.startHeartbeat('tool_running', event.toolName);
        return;

      case 'wait':
        this.emitStatusText(
          'waiting_permission',
          `${this.label} status: Waiting for approval to continue.`,
          event.reason,
        );
        this.startHeartbeat('waiting_permission', event.reason);
        return;

      case 'retry_fresh':
        this.resetPreviewForRetry();
        this.emitStatusText(
          'retry_fresh',
          `${this.label} status: Retrying with a fresh session.`,
        );
        this.clearHeartbeat();
        return;

      case 'retry_delay':
        this.resetPreviewForRetry();
        this.emitStatusText(
          'retry_delay',
          `${this.label} status: Retrying after ${event.delayMs}ms.`,
          event.reason,
        );
        this.clearHeartbeat();
        return;

      case 'retry_provider_switch':
        this.resetPreviewForRetry();
        this.emitStatusText(
          'retry_provider_switch',
          `${this.label} status: Switching provider from ${event.fromProvider} to ${event.toProvider}.`,
        );
        this.clearHeartbeat();
        return;

      case 'stale':
        this.emitStatusText(
          'stale',
          event.retryingFresh
            ? `${this.label} status: Run stalled; retrying fresh.`
            : `${this.label} status: Run stalled.`,
        );
        this.clearHeartbeat();
        return;

      case 'retry_exhausted':
        this.emitStatusText(
          'stale',
          `${this.label} status: Retries exhausted. ${event.finalError}`,
          event.finalError,
        );
        this.clearHeartbeat();
        return;

      case 'delta':
        this.onDelta(event.text);
        return;

      case 'assistant':
        this.clearHeartbeat();
        return;

      case 'stdout':
        return;

      default:
        return;
    }
  }

  onToolEvent(event: ToolProgressEvent): void {
    if (this.completed) return;
    if (event.status === 'start' && this.sealSegmentBoundary()) {
      this.enqueueToolBoundary(event);
    }
    this.handleToolTrail(event);
    this.handleStandaloneToolProgress(event);

    this.config.onTuiEvent?.({
      kind: 'tool_progress',
      toolName: event.toolName,
      toolStatus: event.status,
    });
  }

  handleExternalProgress(phase: string, text: string, detail?: string): void {
    if (this.completed) return;
    this.emitStatusText(phase, text, detail);
  }

  async finish(finalText?: string): Promise<FinishResult> {
    this.completed = true;
    this.clearHeartbeat();
    this.clearActivityTimer();
    this.clearFlushTimer();

    await this.answerChain.catch(() => {});
    if (this.sealBroken || this.outboundBlocked || this.editFloodDisabled) {
      this.pendingText = null;
      await this.deleteDeliveredPreviewMessages();
      await this.collapseActivity();
      return { previewState: null, completed: true };
    }
    if (this.pendingText !== null) {
      const pending = this.pendingText;
      this.pendingText = null;
      await this.sendOrEdit(pending).catch(() => {});
    }

    if (this.appendMode) {
      await this.collapseActivity();
      return { previewState: null, completed: true };
    }

    if (finalText && this.messageId && !this.editFloodDisabled) {
      const guarded = guardOutboundAgentText(finalText);
      const result = await this.config.adapter.editMessage(
        this.config.chatId,
        this.messageId,
        guarded.text,
        true,
      );
      if (result.success) {
        this.lastText = guarded.text;
      }
    }

    await this.collapseActivity();

    const previewState = this.getPreviewState();
    return { previewState, completed: true };
  }

  /**
   * Collapse the ephemeral Activity bubble to a one-line receipt at run end.
   * No-op if no activity bubble was ever spawned (quick turns). Never deletes —
   * a finished turn leaves a quiet "✓ Done" receipt above/near the answer
   * rather than yanking content away. Safe to call more than once.
   */
  async collapseActivity(summary?: string): Promise<void> {
    this.clearActivityTimer();
    this.pendingActivityText = '';
    await this.activityChain.catch(() => {});
    if (!this.activityMessageId || this.activityCollapsed) {
      this.activityCollapsed = true;
      return;
    }
    const text = summary && summary.trim() ? summary.trim() : '✓ Done';
    try {
      await this.config.adapter.editMessage(
        this.config.chatId,
        this.activityMessageId,
        text,
        true,
      );
      this.activityText = text;
    } catch {
      // best-effort
    }
    this.activityCollapsed = true;
  }

  async abort(): Promise<void> {
    this.completed = true;
    this.flushSuppressed = true;
    this.clearHeartbeat();
    this.clearActivityTimer();
    this.clearFlushTimer();
    await this.answerChain.catch(() => {});
    await this.activityChain.catch(() => {});

    // Strip the streaming cursor from the content bubble so an interrupted run
    // never leaves a frozen "still typing" marker. Best-effort.
    if (this.messageId && this.lastText) {
      try {
        await this.config.adapter.editMessage(
          this.config.chatId,
          this.messageId,
          this.lastText,
        );
      } catch {
        // best-effort
      }
    }

    // Non-destructive: collapse the activity bubble to an interrupted notice and
    // LEAVE the content bubble in place. A recoverable stop must never yank away
    // text the user was reading.
    if (this.activityMessageId && !this.activityCollapsed) {
      try {
        await this.config.adapter.editMessage(
          this.config.chatId,
          this.activityMessageId,
          '⟳ Interrupted.',
          true,
        );
      } catch {
        // best-effort
      }
      this.activityCollapsed = true;
    }
  }

  async retract(): Promise<void> {
    this.completed = true;
    this.clearHeartbeat();
    this.clearActivityTimer();
    this.clearFlushTimer();
    await this.answerChain.catch(() => {});
    await this.activityChain.catch(() => {});
    if (
      this.draftMode &&
      this.draftId !== null &&
      this.config.adapter.sendDraft
    ) {
      try {
        await this.config.adapter.sendDraft(
          this.config.chatId,
          this.draftId,
          '',
        );
      } catch {}
    }
    if (this.activityMessageId) {
      this.deliveredPreviewMessageIds.add(this.activityMessageId);
      this.activityMessageId = null;
    }
    await this.deleteDeliveredPreviewMessages();
    this.activityCollapsed = true;
  }

  getPreviewState(): PreviewState | null {
    if (this.appendMode) return null;
    if (this.outboundBlocked) return null;
    if (this.editFloodDisabled) return null;
    if (!this.messageId) return null;
    return { messageId: this.messageId, lastText: this.lastText };
  }

  /** True when segment sealing delivered permanent content for this run. */
  hasSealedContent(): boolean {
    return this.didSeal && !this.sealBroken;
  }

  /**
   * Finalize the live tail after a sealed run: the remaining unsealed segment
   * becomes the last permanent, formatted message. The host must then skip its
   * own full-text final delivery (it would duplicate the sealed heads).
   * Returns false when finalization failed so callers can fall back to the
   * legacy full-delivery path.
   */
  async finalizeTail(finalText?: string): Promise<boolean> {
    this.completed = true;
    this.clearFlushTimer();
    this.pendingText = null;
    await this.answerChain.catch(() => {});
    if (this.sealBroken) return false;
    const source =
      finalText === undefined
        ? this.lastSourceText
        : guardOutboundAgentText(finalText).text;
    const sealedPrefix = this.lastSourceText.slice(0, this.sealedSourceLen);
    if (!source.startsWith(sealedPrefix)) {
      await this.retract();
      return false;
    }
    const segment = `${this.sealedSegmentPrefix}${source.slice(this.sealedSourceLen)}`;
    if (!segment.trim()) return true;
    const { adapter, chatId } = this.config;
    try {
      if (!this.draftMode && this.messageId) {
        const result = await adapter.editMessage(
          chatId,
          this.messageId,
          segment,
          true,
        );
        if (!result.success) this.sealBroken = true;
        return result.success;
      }
      const result = await adapter.send(chatId, segment, undefined, true);
      if (!result.success) this.sealBroken = true;
      return result.success;
    } catch {
      this.sealBroken = true;
      return false;
    }
  }

  stop(): void {
    this.flushSuppressed = true;
    this.clearHeartbeat();
    this.clearActivityTimer();
    this.clearFlushTimer();
  }

  // ── Internal ──────────────────────────────────────────────────────

  /**
   * Seal the current segment at a tool boundary (telegram-spec W7): the text
   * bubble becomes permanent formatted content and the next delta opens a
   * fresh bubble below the tool activity. No-op when there is nothing to seal.
   */
  private sealSegmentBoundary(): boolean {
    if (!this.sealingEnabled || this.sealBroken || this.completed) return false;
    if (this.appendMode || this.statusMode) return false;
    if (this.config.deliveryMode === 'off') return false;
    const segment = this.lastSourceText.slice(this.sealedSourceLen);
    if (!segment.trim()) return false;
    this.sealedSourceLen = this.lastSourceText.length;
    this.pendingText = null;
    const head = `${this.sealedSegmentPrefix}${segment}`;
    this.enqueueSeal(
      findOpenCodeFence(head) === null ? head : `${head}\n\`\`\``,
    );
    this.sealedSegmentPrefix = '';
    return true;
  }

  private enqueueSeal(head: string): void {
    this.didSeal = true;
    const generation = this.streamGeneration;
    this.answerChain = this.answerChain
      .catch(() => {})
      .then(() => this.sealChunk(head, generation));
  }

  private async sealChunk(head: string, generation: number): Promise<void> {
    if (generation !== this.streamGeneration || this.sealBroken) return;
    const { adapter, chatId } = this.config;
    try {
      if (!this.draftMode && this.messageId) {
        const messageId = this.messageId;
        const result = await adapter.editMessage(chatId, messageId, head, true);
        if (result.success) {
          this.deliveredPreviewMessageIds.add(messageId);
          if (generation !== this.streamGeneration) return;
          this.messageId = null;
          this.lastText = '';
          return;
        }
      } else {
        const result = await adapter.send(chatId, head, undefined, true);
        if (result.success) {
          this.deliveredPreviewMessageIds.add(result.messageId);
          if (generation !== this.streamGeneration) return;
          if (this.draftMode) this.lastText = '';
          return;
        }
      }
      if (generation !== this.streamGeneration) return;
      this.sealBroken = true;
    } catch {
      if (generation !== this.streamGeneration) return;
      this.sealBroken = true;
    }
  }

  private async sendOrEdit(
    text: string,
    generation = this.streamGeneration,
  ): Promise<void> {
    if (
      generation !== this.streamGeneration ||
      this.editFloodDisabled ||
      this.outboundBlocked
    )
      return;
    const { adapter, chatId } = this.config;
    // Mid-stream frames carry the typing cursor; finalization paths send the
    // clean text (telegram-spec W1). `lastText` always stores cursor-free text.
    const frameText = this.completed ? text : `${text}${STREAM_CURSOR}`;

    try {
      if (this.draftMode && this.draftId !== null && adapter.sendDraft) {
        const result = await adapter.sendDraft(chatId, this.draftId, frameText);
        if (generation !== this.streamGeneration) return;
        if (result.success) {
          this.lastText = text;
          this.clearFailures();
          return;
        }
        if (this.isUnsupportedDraftError(result.error)) {
          this.draftMode = false;
          this.draftId = null;
        } else {
          this.recordFailure();
          return;
        }
      }

      if (!this.messageId) {
        const result = await adapter.send(chatId, frameText);
        if (result.success) {
          this.deliveredPreviewMessageIds.add(result.messageId);
          if (generation !== this.streamGeneration) return;
          this.messageId = result.messageId;
          this.lastText = text;
          this.clearFailures();
        } else if (generation === this.streamGeneration) {
          this.recordFailure();
        }
        return;
      }

      const result = await adapter.editMessage(
        chatId,
        this.messageId,
        frameText,
      );
      if (generation !== this.streamGeneration) return;
      if (result.success) {
        this.lastText = text;
        this.editFloodStrikes = 0;
        this.clearFailures();
      } else {
        if (result.floodControl) {
          this.editFloodStrikes++;
          if (this.editFloodStrikes >= MAX_EDIT_FLOOD_STRIKES) {
            this.disableFloodedPreview();
          }
        } else {
          this.editFloodStrikes = 0;
          this.recordFailure();
        }
      }
    } catch {
      if (generation !== this.streamGeneration) return;
      this.editFloodStrikes = 0;
      this.recordFailure();
    }
  }

  /**
   * Under /delivery status: only milestone phases, debounced, so Telegram is
   * not flooded with thinking ticks. Escape-hatch modes keep full status flow.
   */
  private allowStatusEmit(phase: string, detail?: string): boolean {
    if (!this.statusMode) return true;
    if (phase === 'thinking') return false;
    if (phase.startsWith('still_') || phase === 'heartbeat') {
      // Heartbeat “still running” is useful; allow with normal interval only.
      const now = Date.now();
      if (now - this.lastMilestoneAt < STATUS_MILESTONE_MIN_INTERVAL_MS) {
        return false;
      }
      this.lastMilestoneAt = now;
      this.lastMilestoneKey = phase;
      return true;
    }
    if (!STATUS_MILESTONE_PHASES.has(phase)) return false;
    const key = `${phase}:${detail || ''}`;
    const now = Date.now();
    const always =
      phase === 'spawn' ||
      phase === 'waiting_permission' ||
      phase === 'retry_fresh' ||
      phase === 'stale' ||
      phase === 'retry_exhausted';
    if (!always) {
      if (key === this.lastMilestoneKey) return false;
      if (now - this.lastMilestoneAt < STATUS_MILESTONE_MIN_INTERVAL_MS) {
        return false;
      }
    }
    this.lastMilestoneAt = now;
    this.lastMilestoneKey = key;
    return true;
  }

  /**
   * Route status/progress text to the Activity bubble. Gated: for the first
   * `activitySpawnThresholdMs` of a run no bubble is spawned (so quick turns
   * stay a single content bubble). The latest pending status is buffered and a
   * one-shot timer flushes it once the threshold passes, so a slow run whose
   * status fired early still surfaces activity.
   */
  private updateActivity(text: string): void {
    if (this.completed) return;
    if (this.config.deliveryMode === 'off') return;
    if (this.activityCollapsed) return;

    const elapsed = Date.now() - this.runStartedAt;
    if (!this.activityMessageId && elapsed < this.activitySpawnThresholdMs) {
      this.pendingActivityText = text;
      if (!this.activitySpawnTimer) {
        const wait = Math.max(0, this.activitySpawnThresholdMs - elapsed);
        this.activitySpawnTimer = setTimeout(() => {
          this.activitySpawnTimer = null;
          const pending = this.pendingActivityText;
          if (!pending || this.completed || this.activityCollapsed) return;
          this.activityChain = this.activityChain
            .catch(() => {})
            .then(() => this.sendOrEditActivity(pending));
        }, wait);
      }
      return;
    }

    this.activityChain = this.activityChain
      .catch(() => {})
      .then(() => this.sendOrEditActivity(text));
  }

  private async sendOrEditActivity(text: string): Promise<void> {
    if (this.activityCollapsed) return;
    if (this.completed && !this.activityMessageId) return;
    if (text === this.activityText) return;
    const { adapter, chatId } = this.config;
    try {
      if (!this.activityMessageId) {
        const result = await adapter.send(chatId, text);
        if (result.success) {
          this.activityMessageId = result.messageId;
          this.activityText = text;
        }
        return;
      }
      const result = await adapter.editMessage(
        chatId,
        this.activityMessageId,
        text,
      );
      if (result.success) {
        this.activityText = text;
      }
    } catch {
      // Activity is best-effort and must never throttle answer delivery.
    }
  }

  private clearActivityTimer(): void {
    if (this.activitySpawnTimer) {
      clearTimeout(this.activitySpawnTimer);
      this.activitySpawnTimer = null;
    }
  }

  private clearFlushTimer(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.flushDueAt = 0;
  }

  private scheduleAnswerFlush(fast = false): void {
    if (this.flushSuppressed || this.completed || this.editFloodDisabled)
      return;
    const now = Date.now();
    const interval =
      fast && this.parseTelegramChatId() > 0
        ? Math.min(this.draftMinIntervalMs, FAST_FLUSH_INTERVAL_MS)
        : this.draftMinIntervalMs;
    const cadenceDelay = Math.max(0, interval - (now - this.lastAnswerFlushAt));
    const backoffDelay = this.disabled
      ? Math.max(0, this.disabledUntil - now)
      : 0;
    const delay = Math.max(cadenceDelay, backoffDelay);
    const dueAt = now + delay;
    if (this.flushTimer) {
      if (dueAt >= this.flushDueAt) return;
      this.clearFlushTimer();
    }
    this.flushDueAt = dueAt;
    const generation = this.streamGeneration;

    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flushDueAt = 0;
      if (this.flushSuppressed || this.completed) {
        this.pendingText = null;
        return;
      }
      const text = this.pendingText;
      this.pendingText = null;
      if (text === null) return;

      this.answerChain = this.answerChain
        .catch(() => {})
        .then(async () => {
          if (
            this.flushSuppressed ||
            this.completed ||
            this.editFloodDisabled ||
            generation !== this.streamGeneration
          )
            return;
          const startedAt = Date.now();
          const cadenceDelay = Math.max(
            0,
            interval - (startedAt - this.lastAnswerFlushAt),
          );
          const backoffDelay = this.disabled
            ? Math.max(0, this.disabledUntil - startedAt)
            : 0;
          if (cadenceDelay > 0 || backoffDelay > 0) {
            if (this.pendingText === null) this.pendingText = text;
            this.scheduleAnswerFlush(fast);
            return;
          }
          this.lastAnswerFlushAt = startedAt;
          await this.sendOrEdit(text, generation);
          if (generation !== this.streamGeneration) return;
          if (
            !this.editFloodDisabled &&
            this.lastText !== text &&
            this.pendingText === null
          ) {
            this.pendingText = text;
          }
        })
        .finally(() => {
          if (this.pendingText !== null) this.scheduleAnswerFlush();
        });
    }, delay);
  }

  private handleToolTrail(event: ToolProgressEvent): void {
    const { deliveryMode, verboseMode } = this.config;
    if (deliveryMode === 'off') return;
    if (
      verboseMode !== 'new' &&
      verboseMode !== 'all' &&
      verboseMode !== 'verbose'
    )
      return;

    const entry = formatToolTrailEntry(event, verboseMode, this.lastToolName);
    if (event.status === 'start') this.lastToolName = event.toolName;
    if (!entry) return;

    if (this.toolTrail[this.toolTrail.length - 1] === entry) return;
    this.toolTrail.push(entry);
    if (this.toolTrail.length > MAX_TOOL_TRAIL_LENGTH) {
      this.toolTrail = this.toolTrail.slice(-MAX_TOOL_TRAIL_LENGTH);
    }
  }

  private handleStandaloneToolProgress(event: ToolProgressEvent): void {
    const { deliveryMode, verboseMode } = this.config;
    if (deliveryMode === 'off') return;
    if (verboseMode !== 'all' && verboseMode !== 'verbose') return;

    const line = formatToolProgressLine(event, verboseMode, this.lastToolName);
    if (!line) return;

    this.toolProgressLines.push(line);
    if (this.toolProgressLines.length > MAX_TOOL_PROGRESS_LINES) {
      this.toolProgressLines = this.toolProgressLines.slice(
        -MAX_TOOL_PROGRESS_LINES,
      );
    }

    const text = formatToolProgressMessage(this.toolProgressLines);

    if (this.twoBlock) {
      this.updateActivity(text);
      return;
    }

    this.activityChain = this.activityChain
      .catch(() => {})
      .then(async () => {
        const { adapter, chatId } = this.config;
        if (this.appendMode) {
          const text = formatToolProgressMessage([line]);
          const result = await adapter.send(chatId, text);
          if (!result.success) this.recordFailure();
          else this.clearFailures();
          return;
        }

        if (this.draftMode && this.draftId !== null) {
          await this.sendOrEdit(text);
          return;
        }

        if (!this.toolProgressMessageId) {
          const result = await adapter.send(chatId, text);
          if (result.success) this.toolProgressMessageId = result.messageId;
        } else {
          await adapter.editMessage(chatId, this.toolProgressMessageId, text);
        }
      });
  }

  private appendToolTrailFooter(text: string): string {
    const footer = formatToolTrailFooter(this.toolTrail);
    return footer ? `${text}\n\n${footer}` : text;
  }

  private extractAppendText(nextText: string): string {
    if (nextText === this.appendSourceText) return '';
    if (this.appendSourceText && nextText.startsWith(this.appendSourceText)) {
      return nextText.slice(this.appendSourceText.length).trim();
    }
    return nextText.trim();
  }

  private async sendAppendBlock(
    text: string,
    sourceText: string,
  ): Promise<void> {
    if (text.length < MIN_PREVIEW_CHARS && !this.appendSourceText) return;

    const chunks = this.chunkAppendBlock(text);
    if (chunks.length === 0) return;

    let sentAll = true;
    for (const chunk of chunks) {
      const result = await this.config.adapter.send(this.config.chatId, chunk);
      if (!result.success) {
        sentAll = false;
        this.recordFailure();
        break;
      }
      this.deliveredPreviewMessageIds.add(result.messageId);
    }

    if (sentAll) {
      this.appendSourceText = sourceText;
      this.lastText = sourceText;
      this.clearFailures();
    }
  }

  private chunkAppendBlock(text: string): string[] {
    const trimmed = text.trim();
    if (!trimmed) return [];
    if (trimmed.length <= MAX_APPEND_BLOCK_CHARS) return [trimmed];

    const chunks: string[] = [];
    let remaining = trimmed;
    while (remaining.length > MAX_APPEND_BLOCK_CHARS) {
      let splitAt = remaining.lastIndexOf('\n\n', MAX_APPEND_BLOCK_CHARS);
      if (splitAt < MAX_APPEND_BLOCK_CHARS * 0.5) {
        splitAt = remaining.lastIndexOf('\n', MAX_APPEND_BLOCK_CHARS);
      }
      if (splitAt < MAX_APPEND_BLOCK_CHARS * 0.5) {
        splitAt = MAX_APPEND_BLOCK_CHARS;
      }
      chunks.push(remaining.slice(0, splitAt).trim());
      remaining = remaining.slice(splitAt).trim();
    }
    if (remaining) chunks.push(remaining);
    return chunks;
  }

  private emitStatusText(phase: string, text: string, detail?: string): void {
    const fingerprint = `${phase}:${text}:${detail || ''}`;
    if (fingerprint === this.lastProgressFingerprint) return;
    this.lastProgressFingerprint = fingerprint;

    this.config.onTuiEvent?.({
      kind: 'run_progress',
      phase,
      text,
      detail,
    });

    if (this.config.deliveryMode === 'off') return;
    if (!this.allowStatusEmit(phase, detail)) return;

    // Two-block mode: status/progress churn goes to its own Activity bubble so
    // it never overwrites the content bubble. Other modes keep the legacy path.
    if (this.twoBlock) {
      this.updateActivity(text);
    } else {
      this.onDelta(text);
    }
  }

  private startHeartbeat(phase: string, detail = ''): void {
    this.clearHeartbeat();
    if (this.heartbeatMs <= 0) return;

    this.heartbeatPhase = phase;
    this.heartbeatDetail = detail;
    this.heartbeatStartedAt = Date.now();

    this.heartbeatTimer = setInterval(() => {
      const elapsed = Math.max(
        1,
        Math.round((Date.now() - this.heartbeatStartedAt) / 1000),
      );
      let text: string;
      if (phase === 'tool_running') {
        const suffix = this.heartbeatDetail ? ` ${this.heartbeatDetail}` : '';
        text = `${this.label} status: Still running${suffix} (${elapsed}s).`;
      } else if (phase === 'waiting_permission') {
        text = `${this.label} status: Still waiting for approval to continue (${elapsed}s).`;
      } else {
        text = `${this.label} status: Still reasoning about the task (${elapsed}s).`;
      }
      // Distinct phase so /delivery status can allow heartbeats but suppress
      // one-shot "thinking" chatter.
      this.emitStatusText('heartbeat', text, this.heartbeatDetail);
    }, this.heartbeatMs);
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    this.heartbeatPhase = '';
    this.heartbeatDetail = '';
    this.heartbeatStartedAt = 0;
  }

  private parseTelegramChatId(): number {
    const raw = this.config.chatId.startsWith('telegram:')
      ? this.config.chatId.slice('telegram:'.length)
      : this.config.chatId;
    return Number(raw);
  }

  private isUnsupportedDraftError(error?: string): boolean {
    const normalized = (error || '').toLowerCase();
    return (
      normalized.includes('sendmessagedraft') ||
      normalized.includes('method not found') ||
      normalized.includes('not supported') ||
      normalized.includes('private chat')
    );
  }

  private recordFailure(now = Date.now()): void {
    this.failureCount++;
    if (this.failureCount >= MAX_FAILURES_BEFORE_DISABLE) {
      this.disabled = true;
      this.disabledUntil = now + DISABLE_TTL_MS;
      this.failureCount = 0;
      return;
    }
    const backoffMs =
      BACKOFF_STEPS_MS[
        Math.min(this.failureCount - 1, BACKOFF_STEPS_MS.length - 1)
      ];
    this.disabledUntil = now + backoffMs;
    this.disabled = true;
  }

  private clearFailures(): void {
    this.failureCount = 0;
    this.disabled = false;
    this.disabledUntil = 0;
  }

  private disableFloodedPreview(): void {
    this.editFloodDisabled = true;
    this.pendingText = null;
    this.pendingActivityText = '';
    this.activityCollapsed = true;
    this.sealBroken = true;
    this.clearFlushTimer();
    this.clearActivityTimer();
  }

  private enqueueToolBoundary(event: ToolProgressEvent): void {
    const line = formatToolProgressLine(event, 'new');
    if (!line) return;
    const generation = this.streamGeneration;
    this.answerChain = this.answerChain
      .catch(() => {})
      .then(async () => {
        if (
          generation !== this.streamGeneration ||
          this.sealBroken ||
          this.outboundBlocked
        )
          return;
        const result = await this.config.adapter.send(
          this.config.chatId,
          line,
          undefined,
          true,
        );
        if (result.success) {
          this.deliveredPreviewMessageIds.add(result.messageId);
          if (generation !== this.streamGeneration) return;
        } else if (generation === this.streamGeneration) {
          this.sealBroken = true;
        }
      });
  }

  private resetPreviewForRetry(): void {
    if (this.appendMode || this.statusMode) return;
    this.streamGeneration++;
    this.pendingText = null;
    this.clearFlushTimer();
    if (this.messageId) {
      this.deliveredPreviewMessageIds.add(this.messageId);
    }
    this.messageId = null;
    this.lastText = '';
    this.lastSourceText = '';
    this.sealedSourceLen = 0;
    this.sealedSegmentPrefix = '';
    this.didSeal = false;
    this.sealBroken = false;
    this.outboundBlocked = false;
    this.editFloodStrikes = 0;
    this.editFloodDisabled = false;
    this.toolTrail = [];
    this.lastToolName = undefined;
    this.clearFailures();
    this.answerChain = this.answerChain
      .catch(() => {})
      .then(() => this.deleteDeliveredPreviewMessages());
  }

  private invalidateOutboundPreview(): void {
    if (this.outboundBlocked) return;
    this.outboundBlocked = true;
    this.sealBroken = true;
    this.pendingText = null;
    this.clearFlushTimer();
    this.answerChain = this.answerChain
      .catch(() => {})
      .then(() => this.deleteDeliveredPreviewMessages());
  }

  private async deleteDeliveredPreviewMessages(): Promise<void> {
    if (this.messageId) {
      this.deliveredPreviewMessageIds.add(this.messageId);
    }
    for (const messageId of this.deliveredPreviewMessageIds) {
      let retracted = false;
      try {
        await this.config.adapter.deleteMessage(this.config.chatId, messageId);
        retracted = true;
      } catch {
        try {
          const result = await this.config.adapter.editMessage(
            this.config.chatId,
            messageId,
            OUTBOUND_DUMP_FALLBACK,
            true,
          );
          retracted = result.success;
        } catch {}
      }
      if (retracted) this.deliveredPreviewMessageIds.delete(messageId);
    }
    this.messageId = null;
    this.lastText = '';
  }
}
