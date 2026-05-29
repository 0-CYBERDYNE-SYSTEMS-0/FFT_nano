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

const BACKOFF_STEPS_MS = [1_000, 3_000, 10_000];
const MAX_FAILURES_BEFORE_DISABLE = 4;
const DISABLE_TTL_MS = 120_000;
const MIN_PREVIEW_CHARS = 20;
const MAX_APPEND_BLOCK_CHARS = 3_900;
const MAX_TOOL_TRAIL_LENGTH = 8;
const MAX_TOOL_PROGRESS_LINES = 12;
// Below this run age, status text never spawns its own bubble — quick turns stay
// a single content bubble with no progress ceremony. See updateActivity().
const DEFAULT_ACTIVITY_SPAWN_THRESHOLD_MS = 2_500;

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
  // Two-block delivery (separate activity + content bubbles) applies only to
  // `stream` mode. append/draft/off retain their existing single-path behavior.
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
  private editChain: Promise<void> = Promise.resolve();

  private draftId: number | null = null;
  private draftMode = false;
  private appendMode = false;
  private appendSourceText = '';

  private readonly label: string;
  private readonly heartbeatMs: number;

  constructor(private readonly config: StreamConsumerConfig) {
    this.label = config.label || 'Agent';
    this.heartbeatMs = config.heartbeatMs ?? 15_000;
    this.activitySpawnThresholdMs =
      config.activitySpawnThresholdMs ?? DEFAULT_ACTIVITY_SPAWN_THRESHOLD_MS;
    this.appendMode = config.deliveryMode === 'append';
    this.draftMode =
      config.deliveryMode === 'draft' &&
      typeof config.adapter.sendDraft === 'function' &&
      config.adapter.supportsDraftStreaming?.(config.chatId) !== false;
    this.twoBlock = config.deliveryMode === 'stream';
    this.draftId = this.draftMode
      ? config.draftId ||
        deriveStreamDraftId(`${config.chatId}:${config.runId}`)
      : null;
  }

  async onDelta(text: string): Promise<void> {
    if (this.completed) return;
    if (this.config.deliveryMode === 'off') return;
    if (this.isBackedOff()) return;

    const nextText = this.appendToolTrailFooter(text);

    if (this.appendMode) {
      this.editChain = this.editChain
        .catch(() => {})
        .then(() => {
          const appendText = this.extractAppendText(nextText);
          if (!appendText) return;
          return this.sendAppendBlock(appendText, nextText);
        });
      return;
    }

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

    this.editChain = this.editChain
      .catch(() => {})
      .then(() => this.sendOrEdit(nextText));
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
        this.emitStatusText(
          'retry_fresh',
          `${this.label} status: Retrying with a fresh session.`,
        );
        this.clearHeartbeat();
        return;

      case 'retry_delay':
        this.emitStatusText(
          'retry_delay',
          `${this.label} status: Retrying after ${event.delayMs}ms.`,
          event.reason,
        );
        this.clearHeartbeat();
        return;

      case 'retry_provider_switch':
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
    this.handleToolTrail(event);
    this.handleStandaloneToolProgress(event);

    this.config.onTuiEvent?.({
      kind: 'tool_progress',
      toolName: event.toolName,
      toolStatus: event.status,
    });
  }

  async finish(finalText?: string): Promise<FinishResult> {
    this.completed = true;
    this.clearHeartbeat();
    this.clearActivityTimer();

    if (this.appendMode) {
      await this.editChain.catch(() => {});
      await this.collapseActivity();
      return { previewState: null, completed: true };
    }

    if (finalText && this.messageId) {
      await this.editChain.catch(() => {});
      const result = await this.config.adapter.editMessage(
        this.config.chatId,
        this.messageId,
        finalText,
        true,
      );
      if (result.success) {
        this.lastText = finalText;
      }
    }

    await this.editChain.catch(() => {});
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
    await this.editChain.catch(() => {});
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
    this.clearHeartbeat();
    this.clearActivityTimer();
    await this.editChain.catch(() => {});

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

  getPreviewState(): PreviewState | null {
    if (this.appendMode) return null;
    if (!this.messageId) return null;
    return { messageId: this.messageId, lastText: this.lastText };
  }

  stop(): void {
    this.clearHeartbeat();
    this.clearActivityTimer();
  }

  // ── Internal ──────────────────────────────────────────────────────

  private async sendOrEdit(text: string): Promise<void> {
    const { adapter, chatId } = this.config;

    try {
      if (this.draftMode && this.draftId !== null && adapter.sendDraft) {
        const result = await adapter.sendDraft(chatId, this.draftId, text);
        if (result.success) {
          this.lastText = text;
          this.clearFailures();
        } else {
          this.recordFailure();
        }
        return;
      }

      if (!this.messageId) {
        const result = await adapter.send(chatId, text);
        if (result.success) {
          this.messageId = result.messageId;
          this.lastText = text;
          this.clearFailures();
        } else {
          this.recordFailure();
        }
        return;
      }

      const result = await adapter.editMessage(chatId, this.messageId, text);
      if (result.success) {
        this.lastText = text;
        this.clearFailures();
      } else {
        this.recordFailure();
      }
    } catch {
      this.recordFailure();
    }
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
          this.editChain = this.editChain
            .catch(() => {})
            .then(() => this.sendOrEditActivity(pending));
        }, wait);
      }
      return;
    }

    this.editChain = this.editChain
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

    this.editChain = this.editChain
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
      this.emitStatusText(phase, text, this.heartbeatDetail);
    }, this.heartbeatMs);
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    this.heartbeatPhase = '';
    this.heartbeatDetail = '';
    this.heartbeatStartedAt = 0;
  }

  private isBackedOff(now = Date.now()): boolean {
    if (this.disabled) {
      if (this.disabledUntil > now) return true;
      this.disabled = false;
      this.disabledUntil = 0;
    }
    return false;
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
}
