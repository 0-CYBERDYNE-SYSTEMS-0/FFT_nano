import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatLocalDate,
  formatLocalTime,
  formatWeekday,
  getDailyMemoryRelativePath,
  getEffectiveTimezone,
  getLegacyDailyMemoryCandidates,
  getLocalDateKey,
  getWeekday,
  resolveEffectiveTimezone,
  shiftDateByDays,
} from '../src/time-context.js';

// ---------------------------------------------------------------------------
// VAL-TIME-001: Timezone validation with graceful fallback
// ---------------------------------------------------------------------------

test('resolveEffectiveTimezone returns UTC for invalid preferred without fallback', () => {
  const result = resolveEffectiveTimezone('Invalid/TZ');
  assert.equal(result, 'UTC');
});

test('resolveEffectiveTimezone returns UTC for empty string preferred', () => {
  const result = resolveEffectiveTimezone('');
  assert.equal(result, 'UTC');
});

test('resolveEffectiveTimezone returns UTC for undefined preferred and no fallback', () => {
  const result = resolveEffectiveTimezone();
  assert.equal(result, 'UTC');
});

test('resolveEffectiveTimezone returns UTC for undefined preferred and invalid fallback', () => {
  const result = resolveEffectiveTimezone(undefined, 'Fake/Zone');
  assert.equal(result, 'UTC');
});

// ---------------------------------------------------------------------------
// VAL-TIME-002: Effective timezone preference order
// ---------------------------------------------------------------------------

test('resolveEffectiveTimezone prefers valid preferred over fallback', () => {
  const result = resolveEffectiveTimezone('Europe/Paris', 'America/Chicago');
  assert.equal(result, 'Europe/Paris');
});

test('resolveEffectiveTimezone falls back to valid fallback when preferred is invalid', () => {
  const result = resolveEffectiveTimezone('Invalid/TZ', 'America/Chicago');
  assert.equal(result, 'America/Chicago');
});

test('resolveEffectiveTimezone uses fallback when preferred is undefined', () => {
  const result = resolveEffectiveTimezone(undefined, 'America/Chicago');
  assert.equal(result, 'America/Chicago');
});

test('resolveEffectiveTimezone falls back to UTC when both are invalid', () => {
  const result = resolveEffectiveTimezone('No/Such', 'Also/Bad');
  assert.equal(result, 'UTC');
});

// ---------------------------------------------------------------------------
// VAL-TIME-003: Local date key formatting (boundary timezones)
// ---------------------------------------------------------------------------

test('getLocalDateKey returns YYYY-MM-DD for UTC', () => {
  const now = new Date('2026-04-03T15:30:00.000Z');
  assert.equal(getLocalDateKey(now, 'UTC'), '2026-04-03');
});

test('getLocalDateKey returns correct date for UTC-12', () => {
  // 2026-04-03T15:30:00.000Z in UTC-12 is still 2026-04-03T03:30:00
  const now = new Date('2026-04-03T15:30:00.000Z');
  assert.equal(getLocalDateKey(now, 'Etc/GMT+12'), '2026-04-03');
});

test('getLocalDateKey crosses day boundary in UTC+14', () => {
  // 2026-04-03T15:30:00.000Z in UTC+14 is 2026-04-04T05:30:00
  const now = new Date('2026-04-03T15:30:00.000Z');
  assert.equal(getLocalDateKey(now, 'Pacific/Kiritimati'), '2026-04-04');
});

test('getLocalDateKey falls back gracefully on invalid timezone', () => {
  const now = new Date('2026-04-03T15:30:00.000Z');
  // Should not throw - implementation should handle invalid tz
  const result = getLocalDateKey(now, 'Invalid/TZ');
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(result), `Expected YYYY-MM-DD but got: ${result}`);
});

// ---------------------------------------------------------------------------
// VAL-TIME-004: Daily memory relative path derivation
// ---------------------------------------------------------------------------

test('getDailyMemoryRelativePath returns memory/YYYY-MM-DD.md', () => {
  const now = new Date('2026-04-03T15:30:00.000Z');
  assert.equal(getDailyMemoryRelativePath(now, 'UTC'), 'memory/2026-04-03.md');
});

test('getDailyMemoryRelativePath uses provided timezone, not host', () => {
  // In America/New_York, 2026-04-03T03:00:00Z is 2026-04-02T23:00:00
  const now = new Date('2026-04-03T03:00:00.000Z');
  assert.equal(getDailyMemoryRelativePath(now, 'America/New_York'), 'memory/2026-04-02.md');
  assert.equal(getDailyMemoryRelativePath(now, 'UTC'), 'memory/2026-04-03.md');
});

// ---------------------------------------------------------------------------
// VAL-TIME-005: Legacy UTC daily memory fallback candidates
// ---------------------------------------------------------------------------

test('getLegacyDailyMemoryCandidates returns UTC today and UTC yesterday', () => {
  const now = new Date('2026-04-03T15:30:00.000Z');
  const candidates = getLegacyDailyMemoryCandidates(now, 'America/New_York');
  // Should include UTC today (2026-04-03) and UTC yesterday (2026-04-02)
  assert.ok(candidates.includes('memory/2026-04-03.md'), `Expected UTC today, got: ${JSON.stringify(candidates)}`);
  assert.ok(candidates.includes('memory/2026-04-02.md'), `Expected UTC yesterday, got: ${JSON.stringify(candidates)}`);
});

test('getLegacyDailyMemoryCandidates at UTC midnight boundary', () => {
  // 00:30 UTC on April 3
  const now = new Date('2026-04-03T00:30:00.000Z');
  const candidates = getLegacyDailyMemoryCandidates(now, 'America/New_York');
  // UTC today = 2026-04-03, UTC yesterday = 2026-04-02
  assert.ok(candidates.includes('memory/2026-04-03.md'));
  assert.ok(candidates.includes('memory/2026-04-02.md'));
});

test('getLegacyDailyMemoryCandidates returns deduplicated list', () => {
  // When the effective timezone is UTC, candidates may overlap
  const now = new Date('2026-04-03T15:30:00.000Z');
  const candidates = getLegacyDailyMemoryCandidates(now, 'UTC');
  const unique = [...new Set(candidates)];
  assert.equal(candidates.length, unique.length, 'Candidates should be deduplicated');
});

// ---------------------------------------------------------------------------
// VAL-TIME-006: Weekday formatting
// ---------------------------------------------------------------------------

test('getWeekday returns correct weekday name', () => {
  // 2026-04-03T15:30:00.000Z is a Friday in UTC
  const now = new Date('2026-04-03T15:30:00.000Z');
  assert.equal(getWeekday(now, 'UTC'), 'Friday');
});

test('getWeekday changes at midnight in different timezones', () => {
  // 2026-04-03T03:00:00.000Z is Friday in UTC
  // But in America/New_York it's Thursday April 2 23:00
  const now = new Date('2026-04-03T03:00:00.000Z');
  assert.equal(getWeekday(now, 'UTC'), 'Friday');
  assert.equal(getWeekday(now, 'America/New_York'), 'Thursday');
});

// ---------------------------------------------------------------------------
// getEffectiveTimezone (convenience wrapper)
// ---------------------------------------------------------------------------

test('getEffectiveTimezone returns validated host timezone', () => {
  const result = getEffectiveTimezone();
  assert.ok(typeof result === 'string' && result.length > 0);
  // Should be a valid IANA timezone
  assert.doesNotThrow(() => new Intl.DateTimeFormat('en-US', { timeZone: result }));
});

// ---------------------------------------------------------------------------
// Existing function regression: formatLocalDate, formatLocalTime, formatWeekday, shiftDateByDays
// ---------------------------------------------------------------------------

test('formatLocalDate returns YYYY-MM-DD', () => {
  const now = new Date('2026-04-03T15:30:00.000Z');
  assert.equal(formatLocalDate(now, 'UTC'), '2026-04-03');
});

test('formatLocalTime returns HH:MM:SS', () => {
  const now = new Date('2026-04-03T15:30:45.000Z');
  assert.equal(formatLocalTime(now, 'UTC'), '15:30:45');
});

test('formatWeekday returns full weekday name', () => {
  const now = new Date('2026-04-03T15:30:00.000Z');
  assert.equal(formatWeekday(now, 'UTC'), 'Friday');
});

test('shiftDateByDays adds and subtracts days correctly', () => {
  assert.equal(shiftDateByDays('2026-04-03', 1), '2026-04-04');
  assert.equal(shiftDateByDays('2026-04-03', -1), '2026-04-02');
  assert.equal(shiftDateByDays('2026-12-31', 1), '2027-01-01');
  assert.equal(shiftDateByDays('2026-01-01', -1), '2025-12-31');
});
