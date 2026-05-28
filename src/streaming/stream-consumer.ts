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
const MAX_TOOL_TRAIL_LENGTH = 8;
const MAX_TOOL_PROGRESS_LINES = 12;

export interface StreamConsumerConfig {
  chatId: string;
  runId: string;
  adapter: PlatformAdapter;
  label?: string;
  heartbeatMs?: number;
  deliveryMode: TelegramDeliveryMode;
  verboseMode: VerboseMode;
  onTuiEvent?: (event: StreamTuiEvent) => void;
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
  private messageId: string | null = null;
  private lastText = '';
  private failureCount = 0;
  private disabled = false;
  private disabledUntil = 0;
  private completed = false;

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

  private readonly label: string;
  private readonly heartbeatMs: number;

  constructor(private readonly config: StreamConsumerConfig) {
    this.label = config.label || 'Agent';
    this.heartbeatMs = config.heartbeatMs ?? 15_000;
  }

  async onDelta(text: string): Promise<void> {
    if (this.completed) return;
    if (this.config.deliveryMode === 'off') return;
    if (this.isBackedOff()) return;

    const nextText = this.appendToolTrailFooter(text);

    if (
      !this.messageId &&
      !this.draftMode &&
      nextText.length < MIN_PREVIEW_CHARS
    ) {
      return;
    }

    if (this.messageId && this.lastText === nextText) return;

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

    const previewState = this.getPreviewState();
    return { previewState, completed: true };
  }

  async abort(): Promise<void> {
    this.completed = true;
    this.clearHeartbeat();
    await this.editChain.catch(() => {});

    if (this.messageId) {
      try {
        await this.config.adapter.deleteMessage(
          this.config.chatId,
          this.messageId,
        );
      } catch {
        // best-effort
      }
      this.messageId = null;
    }
  }

  getPreviewState(): PreviewState | null {
    if (!this.messageId) return null;
    return { messageId: this.messageId, lastText: this.lastText };
  }

  stop(): void {
    this.clearHeartbeat();
  }

  // ── Internal ──────────────────────────────────────────────────────

  private async sendOrEdit(text: string): Promise<void> {
    const { adapter, chatId } = this.config;

    try {
      if (this.draftMode && this.draftId !== null && adapter.sendDraft) {
        await adapter.sendDraft(chatId, this.draftId, text);
        this.lastText = text;
        this.clearFailures();
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
    this.editChain = this.editChain
      .catch(() => {})
      .then(async () => {
        const { adapter, chatId } = this.config;
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

    if (this.config.deliveryMode !== 'off') {
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
