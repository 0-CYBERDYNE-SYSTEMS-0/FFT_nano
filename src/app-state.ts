import type { WASocket } from '@whiskeysockets/baileys';
import type { TelegramBot, TelegramInlineKeyboard } from './telegram.js';
import type { RegisteredGroup } from './types.js';
import { PiRuntimeEventHub } from './pi-runtime-events.js';
import { TelegramPreviewRegistry } from './telegram-streaming.js';
import { TuiRuntimeEventHub } from './tui/runtime-events.js';
import type { TuiGatewayServer } from './tui/gateway-server.js';
import type { WebControlCenterServer } from './web/control-center-server.js';
import type { VerboseMode } from './verbose-mode.js';
import type { RuntimeProviderPreset } from './runtime-config.js';

// ---------------------------------------------------------------------------
// Types previously local to index.ts
// ---------------------------------------------------------------------------

export interface ActiveCoderRun {
  requestId: string;
  mode: 'execute' | 'plan';
  chatJid: string;
  groupName: string;
  startedAt: number;
}

export type ThinkLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
export type ReasoningLevel = 'off' | 'on' | 'stream';
export type QueueMode =
  | 'collect'
  | 'interrupt'
  | 'followup'
  | 'steer'
  | 'steer-backlog';
export type QueueDropPolicy = 'old' | 'new' | 'summarize';
export type PanelScope = 'home' | 'models' | 'think' | 'reasoning' | 'verbose' | 'queue';

export interface ChatRunPreferences {
  provider?: string;
  model?: string;
  thinkLevel?: ThinkLevel;
  reasoningLevel?: ReasoningLevel;
  verboseMode?: VerboseMode;
  queueMode?: QueueMode;
  queueDebounceMs?: number;
  queueCap?: number;
  queueDrop?: QueueDropPolicy;
  freeChat?: boolean;
  nextRunNoContinue?: boolean;
}

export interface ChatUsageStats {
  runs: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  tokenReports: number;
  lastProvider?: string;
  lastModel?: string;
  updatedAt: number;
}

export interface PiModelEntry {
  provider: string;
  model: string;
}

export type TelegramSetupInputKind = 'provider' | 'model' | 'endpoint' | 'api-key';

export interface TelegramSetupInputState {
  kind: TelegramSetupInputKind;
  expiresAt: number;
}

export type TelegramSettingsPanelAction =
  | { kind: 'show-home' }
  | { kind: 'show-model-providers' }
  | { kind: 'show-models-for-provider'; provider: string; page: number }
  | { kind: 'set-model'; provider: string; model: string; returnTo: PanelScope }
  | { kind: 'reset-model'; returnTo: PanelScope }
  | { kind: 'show-think' }
  | { kind: 'set-think'; value: ThinkLevel }
  | { kind: 'show-reasoning' }
  | { kind: 'set-reasoning'; value: ReasoningLevel }
  | { kind: 'show-verbose' }
  | { kind: 'set-verbose'; value: VerboseMode }
  | { kind: 'show-queue' }
  | { kind: 'set-queue-mode'; value: QueueMode }
  | { kind: 'show-subagents' }
  | { kind: 'stop-subagents'; target: 'current' | 'all' }
  | { kind: 'trigger-new' }
  | { kind: 'show-setup-home' }
  | { kind: 'show-setup-providers' }
  | { kind: 'set-setup-provider'; preset: RuntimeProviderPreset }
  | { kind: 'show-setup-models'; preset: RuntimeProviderPreset; page: number }
  | { kind: 'set-setup-model'; preset: RuntimeProviderPreset; model: string }
  | { kind: 'prompt-setup-provider' }
  | { kind: 'prompt-setup-model' }
  | { kind: 'prompt-setup-model-typed' }
  | { kind: 'show-setup-endpoint' }
  | { kind: 'prompt-setup-endpoint' }
  | { kind: 'clear-setup-endpoint' }
  | { kind: 'show-setup-api-key' }
  | { kind: 'prompt-setup-api-key' }
  | { kind: 'clear-setup-api-key' }
  | { kind: 'restart-gateway' };

export interface ActiveChatRun {
  chatJid: string;
  startedAt: number;
  requestId: string;
  abortController: AbortController;
}

export interface TelegramAttachmentHint {
  rawPath: string;
  caption?: string;
}

export interface TelegramResolvedAttachment {
  hostPath: string;
  fileName: string;
  kind: 'photo' | 'document';
  caption?: string;
}

export interface GitInfo {
  branch: string;
  sha: string;
  dirty: boolean;
}

export interface TelegramToolProgressState {
  messageId?: number;
  lines: string[];
  lastToolName?: string;
  chain: Promise<void>;
}

// ---------------------------------------------------------------------------
// Singleton mutable state — one object so ESM re-assignment works across modules
// ---------------------------------------------------------------------------

const TELEGRAM_DRAFT_DISABLE_MS = Math.max(
  60_000,
  Number.parseInt(process.env.FFT_NANO_TELEGRAM_DRAFT_DISABLE_MS || '1800000', 10) ||
    1_800_000,
);

export const state = {
  sock: null as WASocket | null,
  telegramBot: null as TelegramBot | null,
  lastTimestamp: '',
  registeredGroups: {} as Record<string, RegisteredGroup>,
  lastAgentTimestamp: {} as Record<string, string>,
  chatRunPreferences: {} as Record<string, ChatRunPreferences>,
  chatUsageStats: {} as Record<string, ChatUsageStats>,
  bootRunInFlight: false,
  lastTelegramMenuMainChatId: null as string | null,
  lidToPhoneMap: {} as Record<string, string>,
  messageLoopRunning: false,
  ipcWatcherRunning: false,
  groupSyncTimerStarted: false,
  heartbeatLoopStarted: false,
  shuttingDown: false,
  heartbeatLastTargetAny: null as string | null,
  tuiGatewayServer: null as TuiGatewayServer | null,
  webControlCenterServer: null as WebControlCenterServer | null,
  piModelsCache: null as { entries: PiModelEntry[]; loadedAt: number } | null,
};

// ---------------------------------------------------------------------------
// Maps & instances (const — never reassigned, safe to export directly)
// ---------------------------------------------------------------------------

export const activeCoderRuns = new Map<string, ActiveCoderRun>();
export const activeChatRuns = new Map<string, ActiveChatRun>();
export const activeChatRunsById = new Map<string, ActiveChatRun>();
export const tuiMessageQueue = new Map<string, Array<{ text: string; runId: string; deliver: boolean }>>();
export const telegramPreviewRegistry = new TelegramPreviewRegistry(
  TELEGRAM_DRAFT_DISABLE_MS,
);
export const heartbeatLastSent = new Map<string, { text: string; sentAt: number }>();
export const heartbeatLastTargetByChannel = new Map<'telegram' | 'whatsapp', string>();
export const compactionMemoryFlushMarkers = new Map<string, number>();
export const telegramSettingsPanelActions = new Map<
  string,
  { chatJid: string; action: TelegramSettingsPanelAction; expiresAt: number }
>();
export const telegramSetupInputStates = new Map<string, TelegramSetupInputState>();
export const piRuntimeEvents = new PiRuntimeEventHub();
export const tuiRuntimeEvents = new TuiRuntimeEventHub();
export const telegramToolProgressRuns = new Map<string, TelegramToolProgressState>();

// ---------------------------------------------------------------------------
// Constants that were interleaved with state in index.ts
// ---------------------------------------------------------------------------

export const TUI_SENDER_ID = '__fft_tui__';
export const TUI_SENDER_NAME = 'FFT_nano TUI';
export const SERVICE_STARTED_AT = new Date().toISOString();
export const APP_VERSION = process.env.npm_package_version || 'unknown';
export const TELEGRAM_SETTINGS_PANEL_PREFIX = 'cfg:';
export const TELEGRAM_SETTINGS_PANEL_TTL_MS = 15 * 60 * 1000;
export const TELEGRAM_SETUP_INPUT_TTL_MS = 15 * 60 * 1000;
export const TELEGRAM_MODEL_PANEL_PAGE_SIZE = 8;
