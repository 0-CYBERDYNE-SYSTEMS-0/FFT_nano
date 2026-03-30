import type {
  ChatRunPreferences,
  ChatUsageStats,
  QueueDropPolicy,
  QueueMode,
  ReasoningLevel,
  TelegramDeliveryMode,
  ThinkLevel,
} from './app-state.js';
import type { VerboseMode } from './verbose-mode.js';
import type { SessionPrefs as TuiSessionPrefs } from './tui/gateway-server.js';

export interface ChatPreferencesRuntime {
  chatRunPreferences: Record<string, ChatRunPreferences>;
  chatUsageStats: Record<string, ChatUsageStats>;
  saveState: () => void;
  defaultProvider?: string;
  defaultModel?: string;
  getEffectiveVerboseMode?: (mode?: VerboseMode) => VerboseMode;
}

export interface ChatUsageDelta {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  provider?: string;
  model?: string;
}

export function normalizeThinkLevel(raw: string): ThinkLevel | undefined {
  const key = raw.trim().toLowerCase();
  if (!key) return undefined;
  if (key === 'off') return 'off';
  if (['on', 'enable', 'enabled'].includes(key)) return 'low';
  if (['min', 'minimal'].includes(key)) return 'minimal';
  if (key === 'low') return 'low';
  if (['mid', 'med', 'medium'].includes(key)) return 'medium';
  if (['high', 'max', 'ultra'].includes(key)) return 'high';
  if (['xhigh', 'x-high', 'x_high'].includes(key)) return 'xhigh';
  return undefined;
}

export function normalizeReasoningLevel(
  raw: string,
): ReasoningLevel | undefined {
  const key = raw.trim().toLowerCase();
  if (!key) return undefined;
  if (['off', 'false', 'no', '0'].includes(key)) return 'off';
  if (['on', 'true', 'yes', '1'].includes(key)) return 'on';
  if (['stream', 'streaming', 'live'].includes(key)) return 'stream';
  return undefined;
}

export function normalizeTelegramDeliveryMode(
  raw: string,
): TelegramDeliveryMode | undefined {
  const key = raw.trim().toLowerCase();
  if (!key) return undefined;
  if (['off', 'final', 'final-only', 'quiet'].includes(key)) return 'off';
  if (
    ['partial', 'progress', 'live', 'block', 'persistent', 'persist', 'transcript', 'append'].includes(
      key,
    )
  ) {
    return 'partial';
  }
  if (['draft', 'native', 'native-draft'].includes(key)) return 'draft';
  return undefined;
}

export function normalizeQueueMode(raw: string): QueueMode | undefined {
  const key = raw.trim().toLowerCase();
  if (
    key === 'collect' ||
    key === 'interrupt' ||
    key === 'followup' ||
    key === 'steer' ||
    key === 'steer-backlog'
  ) {
    return key;
  }
  return undefined;
}

export function normalizeQueueDrop(raw: string): QueueDropPolicy | undefined {
  const key = raw.trim().toLowerCase();
  if (key === 'old' || key === 'new' || key === 'summarize') return key;
  return undefined;
}

export function parseDurationMs(raw: string): number | undefined {
  const value = raw.trim().toLowerCase();
  if (!value) return undefined;
  if (/^\d+$/.test(value)) {
    const ms = Number.parseInt(value, 10);
    return Number.isFinite(ms) && ms >= 0 ? ms : undefined;
  }
  const match = value.match(/^(\d+)(ms|s|m|h)$/);
  if (!match) return undefined;
  const amount = Number.parseInt(match[1] || '0', 10);
  const unit = match[2];
  if (!Number.isFinite(amount) || amount < 0) return undefined;
  if (unit === 'ms') return amount;
  if (unit === 's') return amount * 1000;
  if (unit === 'm') return amount * 60_000;
  if (unit === 'h') return amount * 60 * 60_000;
  return undefined;
}

export function parseQueueArgs(argText: string): {
  mode?: QueueMode;
  debounceMs?: number;
  cap?: number;
  drop?: QueueDropPolicy;
  reset?: boolean;
} {
  const trimmed = argText.trim();
  if (!trimmed) return {};

  const tokens = trimmed.split(/\s+/).filter(Boolean);
  let mode: QueueMode | undefined;
  let debounceMs: number | undefined;
  let cap: number | undefined;
  let drop: QueueDropPolicy | undefined;
  let reset = false;

  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (['reset', 'default', 'clear'].includes(lower)) {
      reset = true;
      continue;
    }
    const modeValue = normalizeQueueMode(lower);
    if (modeValue) {
      mode = modeValue;
      continue;
    }
    if (lower.startsWith('mode=')) {
      const value = normalizeQueueMode(lower.slice('mode='.length));
      if (value) mode = value;
      continue;
    }
    if (lower.startsWith('debounce=')) {
      const parsed = parseDurationMs(lower.slice('debounce='.length));
      if (typeof parsed === 'number') debounceMs = parsed;
      continue;
    }
    if (lower.startsWith('cap=')) {
      const parsed = Number.parseInt(lower.slice('cap='.length), 10);
      if (Number.isFinite(parsed) && parsed > 0) cap = parsed;
      continue;
    }
    if (lower.startsWith('drop=')) {
      const parsed = normalizeQueueDrop(lower.slice('drop='.length));
      if (parsed) drop = parsed;
    }
  }

  if (
    reset &&
    mode === undefined &&
    debounceMs === undefined &&
    cap === undefined &&
    drop === undefined
  ) {
    return { reset: true };
  }
  return { mode, debounceMs, cap, drop, reset };
}

export function compactChatRunPreferences(
  prefs: ChatRunPreferences,
): ChatRunPreferences | null {
  const next: ChatRunPreferences = {};
  if (prefs.provider?.trim()) next.provider = prefs.provider.trim();
  if (prefs.model?.trim()) next.model = prefs.model.trim();
  if (prefs.thinkLevel && prefs.thinkLevel !== 'off')
    next.thinkLevel = prefs.thinkLevel;
  if (prefs.reasoningLevel && prefs.reasoningLevel !== 'off') {
    next.reasoningLevel = prefs.reasoningLevel;
  }
  if (prefs.telegramDeliveryMode && prefs.telegramDeliveryMode !== 'partial') {
    next.telegramDeliveryMode = prefs.telegramDeliveryMode;
  }
  if (prefs.showReasoning === true) {
    next.showReasoning = true;
  }
  if (prefs.verboseMode && prefs.verboseMode !== 'off') {
    next.verboseMode = prefs.verboseMode;
  }
  if (prefs.queueMode && prefs.queueMode !== 'collect')
    next.queueMode = prefs.queueMode;
  if (
    typeof prefs.queueDebounceMs === 'number' &&
    Number.isFinite(prefs.queueDebounceMs) &&
    prefs.queueDebounceMs > 0
  ) {
    next.queueDebounceMs = Math.floor(prefs.queueDebounceMs);
  }
  if (
    typeof prefs.queueCap === 'number' &&
    Number.isFinite(prefs.queueCap) &&
    prefs.queueCap > 0
  ) {
    next.queueCap = Math.floor(prefs.queueCap);
  }
  if (prefs.queueDrop && prefs.queueDrop !== 'old')
    next.queueDrop = prefs.queueDrop;
  if (prefs.freeChat === true) next.freeChat = true;
  if (prefs.nextRunNoContinue) next.nextRunNoContinue = true;
  return Object.keys(next).length > 0 ? next : null;
}

export function updateChatRunPreferences(
  runtime: ChatPreferencesRuntime,
  chatJid: string,
  updater: (current: ChatRunPreferences) => ChatRunPreferences,
): ChatRunPreferences {
  const current = runtime.chatRunPreferences[chatJid] || {};
  const updated = updater({ ...current });
  const compacted = compactChatRunPreferences(updated);
  if (compacted) {
    runtime.chatRunPreferences[chatJid] = compacted;
  } else {
    delete runtime.chatRunPreferences[chatJid];
  }
  runtime.saveState();
  return runtime.chatRunPreferences[chatJid] || {};
}

export function getTuiSessionPrefs(
  runtime: Pick<ChatPreferencesRuntime, 'chatRunPreferences'>,
  chatJid: string,
): TuiSessionPrefs {
  const prefs = runtime.chatRunPreferences[chatJid] || {};
  return {
    provider: prefs.provider,
    model: prefs.model,
    thinkLevel: prefs.thinkLevel,
    reasoningLevel: prefs.reasoningLevel,
    verboseMode: prefs.verboseMode,
    noContinueNext: prefs.nextRunNoContinue === true,
  };
}

export function patchTuiSessionPrefs(
  runtime: ChatPreferencesRuntime,
  chatJid: string,
  patch: TuiSessionPrefs,
): TuiSessionPrefs {
  const next = updateChatRunPreferences(runtime, chatJid, (prefs) => {
    if (Object.prototype.hasOwnProperty.call(patch, 'provider')) {
      if (patch.provider?.trim()) prefs.provider = patch.provider.trim();
      else delete prefs.provider;
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'model')) {
      if (patch.model?.trim()) prefs.model = patch.model.trim();
      else delete prefs.model;
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'thinkLevel')) {
      if (patch.thinkLevel && patch.thinkLevel !== 'off')
        prefs.thinkLevel = patch.thinkLevel;
      else delete prefs.thinkLevel;
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'reasoningLevel')) {
      if (patch.reasoningLevel && patch.reasoningLevel !== 'off') {
        prefs.reasoningLevel = patch.reasoningLevel;
        if (patch.reasoningLevel === 'stream') prefs.showReasoning = true;
        else delete prefs.showReasoning;
      } else {
        delete prefs.reasoningLevel;
        delete prefs.showReasoning;
      }
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'verboseMode')) {
      if (patch.verboseMode && patch.verboseMode !== 'off')
        prefs.verboseMode = patch.verboseMode;
      else delete prefs.verboseMode;
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'noContinueNext')) {
      if (patch.noContinueNext) prefs.nextRunNoContinue = true;
      else delete prefs.nextRunNoContinue;
    }
    return prefs;
  });
  return {
    provider: next.provider,
    model: next.model,
    thinkLevel: next.thinkLevel,
    reasoningLevel: next.reasoningLevel,
    verboseMode: next.verboseMode,
    noContinueNext: next.nextRunNoContinue === true,
  };
}

export function consumeNextRunNoContinue(
  runtime: ChatPreferencesRuntime,
  chatJid: string,
): boolean {
  const current = runtime.chatRunPreferences[chatJid];
  if (!current?.nextRunNoContinue) return false;
  updateChatRunPreferences(runtime, chatJid, (prefs) => {
    delete prefs.nextRunNoContinue;
    return prefs;
  });
  return true;
}

export function getEffectiveModelLabel(
  runtime: Pick<
    ChatPreferencesRuntime,
    'chatRunPreferences' | 'defaultProvider' | 'defaultModel'
  >,
  chatJid: string,
): string {
  const prefs = runtime.chatRunPreferences[chatJid] || {};
  const provider =
    prefs.provider || runtime.defaultProvider || '(default-provider)';
  const model = prefs.model || runtime.defaultModel || '(default-model)';
  return `${provider}/${model}`;
}

export function formatChatRuntimePreferences(
  runtime: Pick<
    ChatPreferencesRuntime,
    | 'chatRunPreferences'
    | 'defaultProvider'
    | 'defaultModel'
    | 'getEffectiveVerboseMode'
  >,
  chatJid: string,
): string[] {
  const prefs = runtime.chatRunPreferences[chatJid] || {};
  const think = prefs.thinkLevel || 'off';
  const reasoning = prefs.reasoningLevel || 'off';
  const verbose = runtime.getEffectiveVerboseMode
    ? runtime.getEffectiveVerboseMode(prefs.verboseMode)
    : prefs.verboseMode || 'off';
  const freeChat = prefs.freeChat ? 'yes' : 'no';
  const newPending = prefs.nextRunNoContinue ? 'yes' : 'no';
  const queueMode = prefs.queueMode || 'collect';
  const queueDebounce = prefs.queueDebounceMs || 0;
  const queueCap = prefs.queueCap || 0;
  const queueDrop = prefs.queueDrop || 'old';
  return [
    `- chat_model: ${getEffectiveModelLabel(runtime, chatJid)}`,
    `- chat_think: ${think}`,
    `- chat_reasoning: ${reasoning}`,
    `- chat_tool_progress: ${verbose}`,
    `- chat_free_chat: ${freeChat}`,
    `- chat_queue: mode=${queueMode} debounce_ms=${queueDebounce} cap=${queueCap} drop=${queueDrop}`,
    `- chat_new_pending: ${newPending}`,
  ];
}

export function updateChatUsage(
  runtime: ChatPreferencesRuntime,
  chatJid: string,
  usage?: ChatUsageDelta,
  now = Date.now(),
): void {
  const current = runtime.chatUsageStats[chatJid] || {
    runs: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    tokenReports: 0,
    updatedAt: 0,
  };

  current.runs += 1;
  if (usage) {
    const inputTokens =
      typeof usage.inputTokens === 'number' &&
      Number.isFinite(usage.inputTokens)
        ? Math.max(0, Math.floor(usage.inputTokens))
        : 0;
    const outputTokens =
      typeof usage.outputTokens === 'number' &&
      Number.isFinite(usage.outputTokens)
        ? Math.max(0, Math.floor(usage.outputTokens))
        : 0;
    const totalTokens =
      typeof usage.totalTokens === 'number' &&
      Number.isFinite(usage.totalTokens)
        ? Math.max(0, Math.floor(usage.totalTokens))
        : inputTokens + outputTokens;

    if (inputTokens > 0 || outputTokens > 0 || totalTokens > 0) {
      current.tokenReports += 1;
      current.inputTokens += inputTokens;
      current.outputTokens += outputTokens;
      current.totalTokens += totalTokens;
    }
    if (usage.provider) current.lastProvider = usage.provider;
    if (usage.model) current.lastModel = usage.model;
  }

  current.updatedAt = now;
  runtime.chatUsageStats[chatJid] = current;
  runtime.saveState();
}

export function formatUsageText(
  runtime: Pick<
    ChatPreferencesRuntime,
    'chatUsageStats' | 'chatRunPreferences' | 'defaultProvider' | 'defaultModel'
  >,
  chatJid: string,
  scope: 'chat' | 'all' = 'chat',
): string {
  if (scope === 'all') {
    const rows = Object.entries(runtime.chatUsageStats);
    if (rows.length === 0) return 'No usage data collected yet.';
    let runs = 0;
    let reports = 0;
    let input = 0;
    let output = 0;
    let total = 0;
    for (const [, stats] of rows) {
      runs += stats.runs;
      reports += stats.tokenReports;
      input += stats.inputTokens;
      output += stats.outputTokens;
      total += stats.totalTokens;
    }
    return [
      'Usage (all chats):',
      `- chats: ${rows.length}`,
      `- runs: ${runs}`,
      `- token_reports: ${reports}`,
      `- input_tokens: ${input}`,
      `- output_tokens: ${output}`,
      `- total_tokens: ${total}`,
    ].join('\n');
  }

  const stats = runtime.chatUsageStats[chatJid];
  if (!stats) {
    return [
      'Usage (this chat):',
      '- runs: 0',
      '- token_reports: 0',
      '- input_tokens: 0',
      '- output_tokens: 0',
      '- total_tokens: 0',
      '',
      'Token usage appears after provider returns usage fields.',
    ].join('\n');
  }

  const lastModel =
    stats.lastProvider && stats.lastModel
      ? `${stats.lastProvider}/${stats.lastModel}`
      : stats.lastModel || getEffectiveModelLabel(runtime, chatJid);
  const updated = new Date(stats.updatedAt || Date.now()).toISOString();
  return [
    'Usage (this chat):',
    `- runs: ${stats.runs}`,
    `- token_reports: ${stats.tokenReports}`,
    `- input_tokens: ${stats.inputTokens}`,
    `- output_tokens: ${stats.outputTokens}`,
    `- total_tokens: ${stats.totalTokens}`,
    `- last_model: ${lastModel}`,
    `- updated_at: ${updated}`,
  ].join('\n');
}
