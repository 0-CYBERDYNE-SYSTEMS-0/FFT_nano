import { TIMEZONE } from './config.js';
import { logger } from './logger.js';

function isValidTimezone(tz: string): boolean {
  if (!tz || typeof tz !== 'string' || tz.trim() === '') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function resolveEffectiveTimezone(
  preferred?: string,
  fallback?: string,
): string {
  if (preferred && isValidTimezone(preferred)) return preferred;

  if (preferred && !isValidTimezone(preferred)) {
    logger.warn(
      { invalidTimezone: preferred, fallback },
      'Invalid preferred timezone, falling back',
    );
  }

  if (fallback && isValidTimezone(fallback)) return fallback;

  if (fallback && !isValidTimezone(fallback)) {
    logger.warn(
      { invalidTimezone: fallback },
      'Invalid fallback timezone, using UTC',
    );
  }

  return 'UTC';
}

export function getEffectiveTimezone(preferredTz?: string): string {
  return resolveEffectiveTimezone(preferredTz, TIMEZONE);
}

export function getLocalDateKey(now: Date, tz: string): string {
  const resolved = resolveEffectiveTimezone(tz);
  return formatLocalDate(now, resolved);
}

export function getDailyMemoryRelativePath(now: Date, tz: string): string {
  return `memory/${getLocalDateKey(now, tz)}.md`;
}

export function getLegacyDailyMemoryCandidates(
  now: Date,
  tz: string,
): string[] {
  const localKey = getLocalDateKey(now, tz);
  const localYesterday = shiftDateByDays(localKey, -1);
  const utcKey = formatLocalDate(now, 'UTC');
  const utcYesterday = shiftDateByDays(utcKey, -1);

  return [...new Set([localKey, localYesterday, utcKey, utcYesterday])].map(
    (key) => `memory/${key}.md`,
  );
}

export function getWeekday(now: Date, tz: string): string {
  const resolved = resolveEffectiveTimezone(tz);
  return formatWeekday(now, resolved);
}

export function getFormatterParts(
  now: Date,
  timezone: string,
  opts: Intl.DateTimeFormatOptions,
): Record<string, string> {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    ...opts,
  });
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(now)) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }
  return parts;
}

export function formatLocalDate(now: Date, timezone: string): string {
  const parts = getFormatterParts(now, timezone, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function formatLocalTime(now: Date, timezone: string): string {
  const parts = getFormatterParts(now, timezone, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  return `${parts.hour}:${parts.minute}:${parts.second}`;
}

export function formatWeekday(now: Date, timezone: string): string {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'long',
  });
  return formatter.format(now);
}

export function shiftDateByDays(dateStr: string, days: number): string {
  const [year, month, day] = dateStr
    .split('-')
    .map((value) => Number.parseInt(value, 10));
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}
