import { readFileSync } from 'fs';

const HEARTBEAT_TOKEN = 'HEARTBEAT_OK';
const HEARTBEAT_ALERT_MARKER = 'HEARTBEAT_ALERT';
const DEFAULT_ACK_MAX_CHARS = 300;
const HEARTBEAT_OK_TEXT_RE = /^heartbeat\s+(?:ok|okay)[\s.!?]*$/i;
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
  timezone?: string;
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

  if (mode === 'heartbeat' && HEARTBEAT_OK_TEXT_RE.test(normalized)) {
    return { shouldSkip: true, text: '', didStrip: true };
  }

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

export interface HeartbeatAlert {
  isAlert: boolean;
  text: string;
}

// A heartbeat result is only delivered to the user when it explicitly leads
// with the HEARTBEAT_ALERT marker. Free-form narration of the checks performed
// (the validator's "observations") has no marker and is therefore suppressed.
export function extractHeartbeatAlert(raw?: string): HeartbeatAlert {
  if (!raw?.trim()) return { isAlert: false, text: '' };
  const normalized = raw.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ');
  const marker = new RegExp(`${HEARTBEAT_ALERT_MARKER}\\s*:?`, 'i');
  const match = marker.exec(normalized);
  if (!match) return { isAlert: false, text: '' };
  const text = normalized
    .slice(match.index + match[0].length)
    .replace(/[*`~_]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return { isAlert: false, text: '' };
  return { isAlert: true, text };
}

// ---------------------------------------------------------------------------
// SPEC-07: heartbeat health semantics (consecutive failure counter, alert
// escalation, transient retry with backoff, prompt context injection).
// Kept pure so the counter, escalation, and retry rules are unit-testable
// without spinning up the full heartbeat run path.
// ---------------------------------------------------------------------------

export interface HeartbeatFailureReason {
  tag: 'telegram_transient' | 'agent_permanent' | 'unknown';
  detail?: string;
}

export interface HeartbeatHealthState {
  consecutiveFailures: number;
  lastReason: HeartbeatFailureReason | null;
  lastFailureAt: number | null;
}

export interface HeartbeatHealthUpdate {
  state: HeartbeatHealthState;
  // Transitioned from below failureThreshold to >= failureThreshold on this
  // outcome. False on every subsequent failure while already in alert tier.
  becameAlert: boolean;
  // Transitioned from a failing state to consecutiveFailures=0 on this
  // outcome. False on every subsequent success while already healthy.
  resolved: boolean;
}

export const HEARTBEAT_HEALTHY: HeartbeatHealthState = {
  consecutiveFailures: 0,
  lastReason: null,
  lastFailureAt: null,
};

// Record one heartbeat outcome and produce the next state. Pure; the caller
// owns persistence and side effects (logging, alert delivery).
export function recordHeartbeatOutcome(
  prev: HeartbeatHealthState,
  outcome: { ok: true } | { ok: false; reason: HeartbeatFailureReason },
  options: { failureThreshold: number; now: number },
): HeartbeatHealthUpdate {
  if (outcome.ok) {
    const wasFailing = prev.consecutiveFailures > 0;
    return {
      state: HEARTBEAT_HEALTHY,
      becameAlert: false,
      resolved: wasFailing,
    };
  }
  const nextCount = prev.consecutiveFailures + 1;
  const wasBelowThreshold = prev.consecutiveFailures < options.failureThreshold;
  const becameAlert =
    options.failureThreshold > 0 &&
    nextCount >= options.failureThreshold &&
    wasBelowThreshold;
  return {
    state: {
      consecutiveFailures: nextCount,
      lastReason: outcome.reason,
      lastFailureAt: options.now,
    },
    becameAlert,
    resolved: false,
  };
}

// Build the alert-tier text emitted when consecutiveFailures has crossed the
// configured threshold. Independent of the agent's own reply text; this is
// about the host's inability to take a clean heartbeat, not the agent's
// observations.
export function buildHeartbeatHealthAlert(params: {
  consecutiveFailures: number;
  lastReason: HeartbeatFailureReason | null;
  failureThreshold: number;
}): { isAlert: boolean; text: string } {
  if (params.failureThreshold <= 0) return { isAlert: false, text: '' };
  if (params.consecutiveFailures < params.failureThreshold) {
    return { isAlert: false, text: '' };
  }
  const reasonTag = params.lastReason?.tag || 'unknown';
  return {
    isAlert: true,
    text: `HEARTBEAT_ALERT:${params.consecutiveFailures}_consecutive (reason: ${reasonTag}). Re-verify critical services.`,
  };
}

// Build the prompt-context diagnostic injected into the heartbeat prompt when
// consecutiveFailures > 0. alert=true once the threshold is crossed so the
// caller can wrap the line in a top-level alert marker.
export function buildHeartbeatHealthPromptContext(params: {
  consecutiveFailures: number;
  lastReason: HeartbeatFailureReason | null;
  failureThreshold: number;
}): { contextLine: string | null; alert: boolean } {
  if (params.consecutiveFailures <= 0) {
    return { contextLine: null, alert: false };
  }
  const reasonTag = params.lastReason?.tag || 'unknown';
  const contextLine = `HEALTH: Last check failed ${params.consecutiveFailures} times (reason: ${reasonTag}). Re-verify critical services and report.`;
  const alert =
    params.failureThreshold > 0 &&
    params.consecutiveFailures >= params.failureThreshold;
  return { contextLine, alert };
}

// Compose the full heartbeat prompt, optionally injecting a HEALTH diagnostic
// block. Pure so the prompt shape is testable without touching the agent.
export function buildHeartbeatPrompt(params: {
  basePrompt: string;
  contextLine: string | null;
  alert: boolean;
  systemNote?: string;
}): string {
  const sections: string[] = [params.basePrompt];
  if (params.contextLine) {
    const tag = params.alert ? 'HEALTH ALERT' : 'HEALTH';
    sections.push(`[${tag}]\n${params.contextLine}`);
  }
  sections.push(params.systemNote ?? '[SYSTEM NOTE]\nHeartbeat run.');
  return sections.join('\n\n');
}

// ---------------------------------------------------------------------------
// SPEC-07: transient retry helper. Distinguishes retriable Telegram / network
// faults from permanent failures so the heartbeat path doesn't spam logs and
// doesn't bury a recoverable outage under a hard fail.
// ---------------------------------------------------------------------------

export interface RunWithTransientRetryOptions<T> {
  fn: (attempt: number) => Promise<T>;
  attempts: number;
  isTransient: (err: unknown) => boolean;
  sleepMs: (attempt: number) => number;
  onRetry?: (info: {
    attempt: number;
    maxAttempts: number;
    err: unknown;
  }) => void;
}

export interface RunWithTransientRetryResult<T> {
  value: T;
  attempts: number;
  recovered: boolean;
}

// Returns the first successful value. Throws the final error if every attempt
// failed or the failure was non-transient. recovered=true when success came
// after at least one transient retry.
export async function runWithTransientRetry<T>(
  opts: RunWithTransientRetryOptions<T>,
): Promise<RunWithTransientRetryResult<T>> {
  const maxAttempts = Math.max(1, Math.floor(opts.attempts));
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const value = await opts.fn(attempt);
      return { value, attempts: attempt, recovered: attempt > 1 };
    } catch (err) {
      lastErr = err;
      if (attempt >= maxAttempts) break;
      if (!opts.isTransient(err)) break;
      const nextAttempt = attempt + 1;
      opts.onRetry?.({ attempt: nextAttempt, maxAttempts, err });
      const sleep = opts.sleepMs(attempt);
      if (sleep > 0) {
        await new Promise((resolve) => setTimeout(resolve, sleep));
      }
    }
  }
  throw lastErr;
}

export function isTelegramTransientError(err: unknown): boolean {
  if (err == null) return false;
  const message =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : (() => {
            try {
              return String(err);
            } catch {
              return '';
            }
          })();
  if (!message) return false;
  return /connection error|etimedout|econnreset|enotfound|eai_again|telegram/i.test(
    message,
  );
}

export function exponentialBackoffMs(
  attempt: number,
  baseMs = 200,
  capMs = 5000,
): number {
  const safeAttempt = Math.max(1, Math.floor(attempt));
  const delay = baseMs * 2 ** (safeAttempt - 1);
  if (!Number.isFinite(delay)) return capMs;
  return Math.min(capMs, Math.max(0, Math.floor(delay)));
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
  let daysPart: string | null = null;
  let timePart = value;
  let timezonePart: string | null = null;

  const sections = value
    .split('@')
    .map((part) => part.trim())
    .filter(Boolean);
  if (sections.length === 1) {
    timePart = sections[0];
  } else if (sections.length === 2) {
    if (/^\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}$/.test(sections[0])) {
      timePart = sections[0];
      timezonePart = sections[1];
    } else {
      daysPart = sections[0];
      timePart = sections[1];
    }
  } else if (sections.length >= 3) {
    daysPart = sections[0];
    timePart = sections[1];
    timezonePart = sections.slice(2).join('@');
  }

  const [startText, endText] = timePart
    .split('-', 2)
    .map((part) => part.trim());
  if (!startText || !endText) return null;
  const startMinute = parseTimeToMinute(startText);
  const endMinute = parseTimeToMinute(endText);
  if (startMinute === null || endMinute === null) return null;

  let days: Set<number> | null = null;
  if (daysPart) {
    days = parseDaysPart(daysPart);
    if (!days) return null;
  }

  return {
    days,
    startMinute,
    endMinute,
    raw: value,
    timezone: timezonePart || undefined,
  };
}

function getDatePartsForTimezone(
  now: Date,
  timezone?: string,
): { minute: number; day: number } {
  if (!timezone) {
    return {
      minute: now.getHours() * 60 + now.getMinutes(),
      day: now.getDay(),
    };
  }

  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(now);
    const weekday =
      parts.find((part) => part.type === 'weekday')?.value?.toLowerCase() || '';
    const hour = Number.parseInt(
      parts.find((part) => part.type === 'hour')?.value || '',
      10,
    );
    const minute = Number.parseInt(
      parts.find((part) => part.type === 'minute')?.value || '',
      10,
    );
    const day = DAY_INDEX[weekday.slice(0, 3)] ?? now.getDay();
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
      throw new Error('Invalid timezone parts');
    }
    return {
      minute: hour * 60 + minute,
      day,
    };
  } catch {
    return {
      minute: now.getHours() * 60 + now.getMinutes(),
      day: now.getDay(),
    };
  }
}

export function isWithinHeartbeatActiveHours(
  window: ActiveHoursWindow | null,
  now: Date = new Date(),
): boolean {
  if (!window) return true;
  const current = getDatePartsForTimezone(now, window.timezone);
  if (window.days && !window.days.has(current.day)) return false;
  const minute = current.minute;
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
