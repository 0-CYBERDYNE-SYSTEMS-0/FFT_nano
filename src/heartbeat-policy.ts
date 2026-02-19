import { readFileSync } from 'fs';

const HEARTBEAT_TOKEN = 'HEARTBEAT_OK';
const DEFAULT_ACK_MAX_CHARS = 300;
const DAY_INDEX: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

export type StripHeartbeatMode = 'heartbeat' | 'message';

export interface StripHeartbeatResult {
  shouldSkip: boolean;
  text: string;
  didStrip: boolean;
}

export interface ActiveHoursWindow {
  days: Set<number> | null;
  startMinute: number;
  endMinute: number;
  raw: string;
}

export function isHeartbeatContentEffectivelyEmpty(
  content: string | undefined | null,
): boolean {
  if (typeof content !== 'string') return false;

  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^#+(\s|$)/.test(trimmed)) continue;
    if (/^[-*+]\s*(\[[\sXx]?\]\s*)?$/.test(trimmed)) continue;
    return false;
  }
  return true;
}

export function isHeartbeatFileEffectivelyEmpty(filePath: string): boolean {
  try {
    const content = readFileSync(filePath, 'utf-8');
    return isHeartbeatContentEffectivelyEmpty(content);
  } catch {
    return false;
  }
}

function stripTokenAtEdges(raw: string): { text: string; didStrip: boolean } {
  let text = raw.trim();
  if (!text) return { text: '', didStrip: false };
  const tokenAtEnd = new RegExp(`${HEARTBEAT_TOKEN}[^\\w]{0,4}$`);
  if (!text.includes(HEARTBEAT_TOKEN)) return { text, didStrip: false };

  let didStrip = false;
  let changed = true;
  while (changed) {
    changed = false;
    const next = text.trim();
    if (next.startsWith(HEARTBEAT_TOKEN)) {
      text = next.slice(HEARTBEAT_TOKEN.length).trimStart();
      didStrip = true;
      changed = true;
      continue;
    }
    if (tokenAtEnd.test(next)) {
      const idx = next.lastIndexOf(HEARTBEAT_TOKEN);
      const before = next.slice(0, idx).trimEnd();
      if (!before) {
        text = '';
      } else {
        const after = next.slice(idx + HEARTBEAT_TOKEN.length).trimStart();
        text = `${before}${after}`.trimEnd();
      }
      didStrip = true;
      changed = true;
    }
  }
  return { text: text.replace(/\s+/g, ' ').trim(), didStrip };
}

export function stripHeartbeatToken(
  raw?: string,
  opts: { mode?: StripHeartbeatMode; maxAckChars?: number } = {},
): StripHeartbeatResult {
  if (!raw?.trim()) return { shouldSkip: true, text: '', didStrip: false };

  const mode = opts.mode || 'message';
  const maxAckChars = Math.max(0, opts.maxAckChars ?? DEFAULT_ACK_MAX_CHARS);
  const trimmed = raw.trim();
  const stripMarkup = (text: string) =>
    text
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/^[*`~_]+/, '')
      .replace(/[*`~_]+$/, '');
  const normalized = stripMarkup(trimmed);

  const hasToken =
    trimmed.includes(HEARTBEAT_TOKEN) || normalized.includes(HEARTBEAT_TOKEN);
  if (!hasToken) {
    return { shouldSkip: false, text: trimmed, didStrip: false };
  }

  const strippedOriginal = stripTokenAtEdges(trimmed);
  const strippedNormalized = stripTokenAtEdges(normalized);
  const picked =
    strippedOriginal.didStrip && strippedOriginal.text
      ? strippedOriginal
      : strippedNormalized;

  if (!picked.didStrip) {
    return { shouldSkip: false, text: trimmed, didStrip: false };
  }

  if (!picked.text) {
    return { shouldSkip: true, text: '', didStrip: true };
  }

  const rest = picked.text.trim();
  if (mode === 'heartbeat' && rest.length <= maxAckChars) {
    return { shouldSkip: true, text: '', didStrip: true };
  }
  return { shouldSkip: false, text: rest, didStrip: true };
}

function parseTimeToMinute(text: string): number | null {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(text.trim());
  if (!match) return null;
  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);
  return hours * 60 + minutes;
}

function parseDayToken(token: string): number | null {
  const normalized = token.trim().slice(0, 3).toLowerCase();
  return DAY_INDEX[normalized] ?? null;
}

function addDayRange(target: Set<number>, start: number, end: number): void {
  target.add(start);
  if (start === end) return;
  let value = start;
  while (value !== end) {
    value = (value + 1) % 7;
    target.add(value);
  }
}

function parseDaysPart(rawDays: string): Set<number> | null {
  const out = new Set<number>();
  for (const chunk of rawDays.split(',')) {
    const item = chunk.trim();
    if (!item) continue;
    const range = item.split('-').map((part) => part.trim());
    if (range.length === 1) {
      const day = parseDayToken(range[0]);
      if (day === null) return null;
      out.add(day);
      continue;
    }
    if (range.length === 2) {
      const start = parseDayToken(range[0]);
      const end = parseDayToken(range[1]);
      if (start === null || end === null) return null;
      addDayRange(out, start, end);
      continue;
    }
    return null;
  }
  return out.size > 0 ? out : null;
}

export function parseHeartbeatActiveHours(
  raw?: string,
): ActiveHoursWindow | null {
  const value = raw?.trim();
  if (!value) return null;
  const [daysPart, timePart] = value.includes('@')
    ? value.split('@', 2)
    : [null, value];
  const [startText, endText] = timePart.split('-', 2).map((part) => part.trim());
  if (!startText || !endText) return null;
  const startMinute = parseTimeToMinute(startText);
  const endMinute = parseTimeToMinute(endText);
  if (startMinute === null || endMinute === null) return null;

  let days: Set<number> | null = null;
  if (daysPart) {
    days = parseDaysPart(daysPart);
    if (!days) return null;
  }

  return { days, startMinute, endMinute, raw: value };
}

export function isWithinHeartbeatActiveHours(
  window: ActiveHoursWindow | null,
  now: Date = new Date(),
): boolean {
  if (!window) return true;
  if (window.days && !window.days.has(now.getDay())) return false;
  const minute = now.getHours() * 60 + now.getMinutes();
  if (window.startMinute === window.endMinute) return true;
  if (window.startMinute < window.endMinute) {
    return minute >= window.startMinute && minute < window.endMinute;
  }
  return minute >= window.startMinute || minute < window.endMinute;
}

export function shouldSuppressDuplicateHeartbeat(params: {
  text: string;
  nowMs: number;
  previousText?: string;
  previousSentAt?: number;
  windowMs?: number;
}): boolean {
  const windowMs = params.windowMs ?? 24 * 60 * 60 * 1000;
  if (!params.previousText?.trim()) return false;
  if (typeof params.previousSentAt !== 'number') return false;
  if (params.nowMs - params.previousSentAt >= windowMs) return false;
  return params.text.trim() === params.previousText.trim();
}

