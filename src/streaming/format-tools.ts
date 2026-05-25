import type { VerboseMode } from '../verbose-mode.js';

export interface ToolProgressEvent {
  toolName: string;
  status: 'start' | 'ok' | 'error';
  args?: string;
  output?: string;
  error?: string;
}

const TOOL_EMOJIS: Record<string, string> = {
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

export function getToolEmoji(toolName: string): string {
  return TOOL_EMOJIS[toolName] || '🔥';
}

export function truncatePreview(value: string, max = 80): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  if (!compact) return '';
  return compact.length <= max ? compact : `${compact.slice(0, max - 3)}...`;
}

export function extractToolPreview(args?: string): string | null {
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
        return truncatePreview(value);
      }
    }
    const firstString = Object.values(parsed).find(
      (value) => typeof value === 'string' && value.trim(),
    );
    if (typeof firstString === 'string') {
      return truncatePreview(firstString);
    }
  } catch {
    return truncatePreview(args);
  }
  return truncatePreview(args);
}

export function formatToolProgressLine(
  event: ToolProgressEvent,
  mode: VerboseMode,
  lastToolName?: string,
): string | null {
  const emoji = getToolEmoji(event.toolName);
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
        ? `${emoji} ${event.toolName}(${keys})\n${truncatePreview(event.args, 200)}`
        : `${emoji} ${event.toolName}\n${truncatePreview(event.args, 200)}`;
    }
    const preview = extractToolPreview(event.args);
    return preview
      ? `${emoji} ${event.toolName}: "${preview}"`
      : `${emoji} ${event.toolName}...`;
  }
  if (event.status === 'error') {
    const preview = truncatePreview(
      event.error || event.output || 'tool failed',
      120,
    );
    return `⚠️ ${event.toolName} error: ${preview}`;
  }
  if (mode === 'verbose' && event.output) {
    return `↳ ${event.toolName}: ${truncatePreview(event.output, 160)}`;
  }
  return null;
}

export function formatToolProgressMessage(lines: string[]): string {
  return ['Tool progress', ...lines].join('\n');
}

export function formatToolTrailEntry(
  event: ToolProgressEvent,
  mode: Extract<VerboseMode, 'new' | 'all' | 'verbose'>,
  lastToolName?: string,
): string | null {
  if (event.status !== 'start') return null;
  if (mode === 'new' && event.toolName === lastToolName) return null;
  const emoji = getToolEmoji(event.toolName);
  if (mode === 'new' || mode === 'all') {
    return `${emoji} ${event.toolName}`;
  }
  const preview = extractToolPreview(event.args);
  return preview
    ? `${emoji} ${event.toolName}: "${preview}"`
    : `${emoji} ${event.toolName}`;
}

export function formatToolTrailFooter(trail: string[]): string | undefined {
  if (trail.length === 0) return undefined;
  return `Tools: ${trail.join(' → ')}`;
}
