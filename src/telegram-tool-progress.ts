import type { TelegramToolProgressState } from './app-state.js';
import type { TelegramDeliveryMode } from './app-state.js';
import type { TelegramBot } from './telegram.js';
import type { VerboseMode } from './verbose-mode.js';

const MAX_TELEGRAM_TOOL_PROGRESS_ENTRIES = 12;

export interface TelegramToolProgressEvent {
  toolName: string;
  status: 'start' | 'ok' | 'error';
  args?: string;
  output?: string;
  error?: string;
}

export function getTelegramToolProgressKey(
  chatJid: string,
  requestId: string,
): string {
  return `${chatJid}::${requestId}`;
}

export function truncateToolProgressPreview(value: string, max = 80): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  if (!compact) return '';
  return compact.length <= max ? compact : `${compact.slice(0, max - 3)}...`;
}

export function extractToolProgressPreview(args?: string): string | null {
  if (!args) return null;
  try {
    const parsed = JSON.parse(args) as Record<string, unknown>;
    for (const key of [
      'command',
      'path',
      'url',
      'query',
      'pattern',
      'task',
      'prompt',
      'message',
    ]) {
      const value = parsed[key];
      if (typeof value === 'string' && value.trim()) {
        return truncateToolProgressPreview(value);
      }
    }
    const firstString = Object.values(parsed).find(
      (value) => typeof value === 'string' && value.trim(),
    );
    if (typeof firstString === 'string') {
      return truncateToolProgressPreview(firstString);
    }
  } catch {
    return truncateToolProgressPreview(args);
  }
  return truncateToolProgressPreview(args);
}

const TELEGRAM_TOOL_EMOJIS: Record<string, string> = {
  bash: '🔥',
  Bash: '🔥',
  shell: '🔥',
  read: '📖',
  Read: '📖',
  read_file: '📖',
  ReadFile: '📖',
  write: '✍️',
  Write: '✍️',
  edit: '✍️',
  Edit: '✍️',
  grep: '🤓',
  Grep: '🤓',
  find: '🤓',
  Find: '🤓',
  search: '🔍',
  Search: '🔍',
  ls: '👀',
  Ls: '👀',
  glob: '📂',
  Glob: '📂',
  websearch: '🌐',
  WebSearch: '🌐',
  web_extract: '🔎',
  WebExtract: '🔎',
  todo: '📋',
  Todo: '📋',
  tasks: '📋',
  Tasks: '📋',
};

export function getTelegramToolEmoji(toolName: string): string {
  return TELEGRAM_TOOL_EMOJIS[toolName] || '🔥';
}

export function buildTelegramToolProgressLine(
  event: TelegramToolProgressEvent,
  mode: VerboseMode,
  lastToolName?: string,
): string | null {
  const emoji = getTelegramToolEmoji(event.toolName);
  if (event.status === 'start') {
    if (mode === 'new' && event.toolName === lastToolName) return null;
    if (mode === 'new') {
      return `${emoji} ${event.toolName}`;
    }
    if (mode === 'verbose' && event.args) {
      let keys = '';
      try {
        const parsed = JSON.parse(event.args) as Record<string, unknown>;
        keys = Object.keys(parsed).join(', ');
      } catch {
        keys = '';
      }
      return keys
        ? `${emoji} ${event.toolName}(${keys})\n${truncateToolProgressPreview(event.args, 200)}`
        : `${emoji} ${event.toolName}\n${truncateToolProgressPreview(event.args, 200)}`;
    }
    const preview = extractToolProgressPreview(event.args);
    return preview
      ? `${emoji} ${event.toolName}: "${preview}"`
      : `${emoji} ${event.toolName}...`;
  }
  if (event.status === 'error') {
    const preview = truncateToolProgressPreview(
      event.error || event.output || 'tool failed',
      120,
    );
    return `⚠️ ${event.toolName} error: ${preview}`;
  }
  if (mode === 'verbose' && event.output) {
    return `↳ ${event.toolName}: ${truncateToolProgressPreview(event.output, 160)}`;
  }
  return null;
}

export function buildTelegramToolProgressMessage(lines: string[]): string {
  return ['Tool progress', ...lines].join('\n');
}

export function shouldUseTelegramPreviewToolTrail(params: {
  deliveryMode: TelegramDeliveryMode;
  verboseMode: VerboseMode;
}): boolean {
  return (
    params.deliveryMode === 'draft' &&
    (params.verboseMode === 'all' || params.verboseMode === 'verbose')
  );
}

export function shouldUseStandaloneTelegramToolProgress(params: {
  deliveryMode: TelegramDeliveryMode;
  verboseMode: VerboseMode;
}): boolean {
  return (
    params.deliveryMode === 'partial' &&
    (params.verboseMode === 'all' || params.verboseMode === 'verbose')
  );
}

export function buildTelegramPreviewToolTrailEntry(
  event: TelegramToolProgressEvent,
  mode: Extract<VerboseMode, 'all' | 'verbose'>,
): string | null {
  if (event.status !== 'start') return null;
  const emoji = getTelegramToolEmoji(event.toolName);
  if (mode === 'all') {
    return `${emoji} ${event.toolName}`;
  }
  const preview = extractToolProgressPreview(event.args);
  return preview
    ? `${emoji} ${event.toolName}: "${preview}"`
    : `${emoji} ${event.toolName}`;
}

function appendTelegramToolProgressLine(
  lines: string[],
  line: string,
): string[] {
  const next = [...lines, line];
  if (next.length <= MAX_TELEGRAM_TOOL_PROGRESS_ENTRIES) {
    return next;
  }
  return next.slice(next.length - MAX_TELEGRAM_TOOL_PROGRESS_ENTRIES);
}

export function enqueueTelegramToolProgressMessage(params: {
  bot: Pick<TelegramBot, 'sendStreamMessage' | 'editStreamMessage'>;
  runs: Map<string, TelegramToolProgressState>;
  chatJid: string;
  requestId: string;
  mode: Extract<VerboseMode, 'all' | 'verbose'>;
  event: TelegramToolProgressEvent;
}): void {
  const key = getTelegramToolProgressKey(params.chatJid, params.requestId);
  const run =
    params.runs.get(key) ||
    ({
      lines: [],
      chain: Promise.resolve(),
    } satisfies TelegramToolProgressState);

  run.chain = run.chain
    .catch(() => {})
    .then(async () => {
      const line = buildTelegramToolProgressLine(
        params.event,
        params.mode,
        run.lastToolName,
      );
      if (!line) return;

      if (params.event.status === 'start') {
        run.lastToolName = params.event.toolName;
      }
      run.lines = appendTelegramToolProgressLine(run.lines, line);

      const text = buildTelegramToolProgressMessage(run.lines);
      if (!run.messageId) {
        run.messageId = await params.bot.sendStreamMessage(params.chatJid, text);
        return;
      }
      await params.bot.editStreamMessage(
        params.chatJid,
        run.messageId,
        text,
      );
    });

  params.runs.set(key, run);
}

export function finalizeTelegramToolProgressRun(
  runs: Map<string, TelegramToolProgressState>,
  key: string,
): void {
  const progress = runs.get(key);
  if (!progress) return;
  runs.delete(key);
  void progress.chain.catch(() => {});
}
