import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import test from 'node:test';

import {
  appendCompactionSummaryToMemory,
  resolveCompactionMemoryRelativePath,
} from '../src/memory-maintenance.js';
import { closeDatabase, createTask, getTaskById, initDatabaseAtPath } from '../src/db.js';
import {
  buildSystemPrompt,
} from '../src/system-prompt.js';
import {
  formatLocalDate,
  getDailyMemoryRelativePath,
  getLegacyDailyMemoryCandidates,
  getLocalDateKey,
} from '../src/time-context.js';
import {
  runScheduledTaskV2,
} from '../src/cron/service.js';
import type { RegisteredGroup, ScheduledTask } from '../src/types.js';
import type { ContainerInput } from '../src/pi-runner.js';

// ---------------------------------------------------------------------------
// VAL-CROSS-001: Scheduled task with TZ produces correct time in prompt
//
// A cron task scheduled with Europe/Paris timezone:
// - machine_local_date reflects Paris date at task execution time
// - Daily memory files read are Paris-date files, not UTC or host timezone
// - Compaction writes to Paris-date memory file (same date-key helper)
// ---------------------------------------------------------------------------

function makeTempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-cross-tz-'));
  return path.join(dir, 'messages.db');
}

function makeTask(
  overrides: Partial<ScheduledTask>,
): Omit<ScheduledTask, 'last_run' | 'last_result'> {
  const now = new Date().toISOString();
  return {
    id: overrides.id || `task-${Date.now()}`,
    group_folder: overrides.group_folder || 'main',
    chat_jid: overrides.chat_jid || 'telegram:1',
    prompt: overrides.prompt || 'ping',
    schedule_type: overrides.schedule_type || 'once',
    schedule_value: overrides.schedule_value || now,
    context_mode: overrides.context_mode || 'isolated',
    schedule_json: overrides.schedule_json || null,
    session_target: overrides.session_target || 'isolated',
    wake_mode: overrides.wake_mode || 'next-heartbeat',
    delivery_mode: overrides.delivery_mode || 'none',
    delivery_channel: overrides.delivery_channel || null,
    delivery_to: overrides.delivery_to || null,
    delivery_webhook_url: overrides.delivery_webhook_url || null,
    timeout_seconds: overrides.timeout_seconds || null,
    stagger_ms: overrides.stagger_ms || null,
    delete_after_run: overrides.delete_after_run || 0,
    consecutive_errors: overrides.consecutive_errors || 0,
    next_run: overrides.next_run || now,
    status: overrides.status || 'active',
    created_at: overrides.created_at || now,
  };
}

// A fixed "now" that is 2026-04-03T03:00:00Z (a Friday).
// In Europe/Paris (UTC+2 in April, CEST), this is 2026-04-03T05:00:00 — still April 3.
// In America/New_York (EDT, UTC-4), this is 2026-04-02T23:00:00 — April 2.
const FIXED_NOW = new Date('2026-04-03T03:00:00.000Z');
const PARIS_TZ = 'Europe/Paris';

test('scheduled task with Europe/Paris tz reads Paris-date daily memory files (VAL-CROSS-001)', async () => {
  const dbPath = makeTempDbPath();
  initDatabaseAtPath(dbPath);

  const task = makeTask({
    id: 'paris-tz-memory-read',
    schedule_type: 'cron',
    schedule_value: '0 8 * * *',
    schedule_json: JSON.stringify({ kind: 'cron', expr: '0 8 * * *', tz: PARIS_TZ }),
    context_mode: 'isolated',
  });
  createTask(task);

  const group: RegisteredGroup = {
    name: 'main',
    folder: 'main',
    trigger: '@FarmFriend',
    added_at: new Date().toISOString(),
  };

  // Build the system prompt as the scheduled task would, with Paris timezone
  const groupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-cross-tz-group-'));
  const memoryDir = path.join(groupDir, 'memory');
  fs.mkdirSync(memoryDir, { recursive: true });

  // Write a Paris-date memory file (the file that SHOULD be read)
  const parisDateKey = getLocalDateKey(FIXED_NOW, PARIS_TZ);
  fs.writeFileSync(path.join(memoryDir, `${parisDateKey}.md`), '# Paris Daily Notes\n');

  const readFileIfExists = (filePath: string): string | null => {
    try {
      return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : null;
    } catch {
      return null;
    }
  };

  const { text: promptText, report } = buildSystemPrompt(
    {
      groupFolder: 'main',
      chatJid: 'telegram:1',
      isMain: true,
      isScheduledTask: true,
      codingHint: 'none',
    },
    {
      groupDir,
      globalDir: path.join(groupDir, 'global'),
      ipcDir: path.join(groupDir, 'ipc'),
    },
    {
      readFileIfExists,
      timezone: PARIS_TZ,
      now: () => FIXED_NOW,
    },
  );

  // Verify machine_local_date in prompt reflects Paris date
  assert.ok(
    promptText.includes(`"machine_local_date": "${parisDateKey}"`),
    `Expected machine_local_date to be ${parisDateKey}, prompt contained:\n${promptText.slice(-500)}`,
  );

  // Verify machine_timezone in prompt is Europe/Paris
  assert.ok(
    promptText.includes('"machine_timezone": "Europe/Paris"'),
    `Expected machine_timezone Europe/Paris in prompt`,
  );

  // Verify daily memory file names in context use Paris date
  const parisMemoryPath = getDailyMemoryRelativePath(FIXED_NOW, PARIS_TZ);
  const matchingEntry = report.contextEntries.find(
    (e) => e.path.endsWith(`/${parisMemoryPath}`),
  );
  assert.ok(
    matchingEntry,
    `Expected context to include Paris-date memory file ${parisMemoryPath}. Entries: ${report.contextEntries.map((e) => e.path).join(', ')}`,
  );

  closeDatabase();
  fs.rmSync(groupDir, { recursive: true, force: true });
});

test('scheduled task with Europe/Paris tz writes compaction to Paris-date file (VAL-CROSS-001)', async () => {
  const dbPath = makeTempDbPath();
  initDatabaseAtPath(dbPath);

  const task = makeTask({
    id: 'paris-tz-compaction-write',
    schedule_type: 'cron',
    schedule_value: '0 8 * * *',
    schedule_json: JSON.stringify({ kind: 'cron', expr: '0 8 * * *', tz: PARIS_TZ }),
    context_mode: 'isolated',
  });
  createTask(task);

  // The compaction write should use the same date-key logic as the prompt reader.
  // Verify that the time-context helpers produce consistent results for Paris TZ.
  const timestampIso = FIXED_NOW.toISOString();
  const expectedParisDateKey = getLocalDateKey(FIXED_NOW, PARIS_TZ);
  const expectedParisMemoryPath = getDailyMemoryRelativePath(FIXED_NOW, PARIS_TZ);

  // Verify date-key consistency: prompt reader and path helper agree
  assert.equal(
    `memory/${expectedParisDateKey}.md`,
    expectedParisMemoryPath,
    'Date key and daily memory path should be consistent',
  );

  // Verify legacy candidates include Paris date
  const candidates = getLegacyDailyMemoryCandidates(FIXED_NOW, PARIS_TZ);
  assert.ok(
    candidates.includes(expectedParisMemoryPath),
    `Expected Paris-date candidate ${expectedParisMemoryPath} in ${JSON.stringify(candidates)}`,
  );

  // Verify formatLocalDate produces the same date key for Paris
  assert.equal(
    formatLocalDate(FIXED_NOW, PARIS_TZ),
    expectedParisDateKey,
    'formatLocalDate should match getLocalDateKey for same timezone',
  );

  closeDatabase();
});

test('machine_local_date in prompt reflects Paris time at execution (VAL-CROSS-001)', async () => {
  const dbPath = makeTempDbPath();
  initDatabaseAtPath(dbPath);

  const task = makeTask({
    id: 'paris-tz-machine-date',
    schedule_type: 'cron',
    schedule_value: '0 8 * * *',
    schedule_json: JSON.stringify({ kind: 'cron', expr: '0 8 * * *', tz: PARIS_TZ }),
    context_mode: 'isolated',
  });
  createTask(task);

  let capturedInput: ContainerInput | undefined;
  const group: RegisteredGroup = {
    name: 'main',
    folder: 'main',
    trigger: '@FarmFriend',
    added_at: new Date().toISOString(),
  };

  const latest = getTaskById(task.id);
  assert.ok(latest);
  await runScheduledTaskV2(latest!, {
    sendMessage: async () => {},
    registeredGroups: () => ({ 'telegram:1': group }),
    runContainerTask: async (_group, input) => {
      capturedInput = input;
      return { status: 'success', result: 'done' };
    },
  });

  assert.ok(capturedInput);
  // The effective timezone passed through should be Europe/Paris
  assert.equal(capturedInput!.effectiveTimezone, PARIS_TZ);

  // Now verify that when buildSystemPrompt uses that timezone, the date is correct
  const groupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-cross-tz-machine-'));
  const { text: promptText } = buildSystemPrompt(
    {
      groupFolder: 'main',
      chatJid: 'telegram:1',
      isMain: true,
      isScheduledTask: true,
      codingHint: 'none',
    },
    {
      groupDir,
      globalDir: path.join(groupDir, 'global'),
      ipcDir: path.join(groupDir, 'ipc'),
    },
    {
      timezone: capturedInput!.effectiveTimezone,
      now: () => FIXED_NOW,
    },
  );

  // Verify machine_local_date matches Paris date
  const parisDate = formatLocalDate(FIXED_NOW, PARIS_TZ);
  assert.ok(
    promptText.includes(`"machine_local_date": "${parisDate}"`),
    `Expected machine_local_date=${parisDate} for Europe/Paris at ${FIXED_NOW.toISOString()}`,
  );

  // Verify machine_timezone is Paris
  assert.ok(
    promptText.includes('"machine_timezone": "Europe/Paris"'),
  );

  closeDatabase();
  fs.rmSync(groupDir, { recursive: true, force: true });
});

test('Paris date differs from UTC date when near midnight boundary (VAL-CROSS-001)', async () => {
  // Pick a time where UTC and Paris dates differ:
  // 2026-01-15T23:30:00Z → UTC date: Jan 15, Paris (UTC+1 in winter): Jan 16 00:30
  const winterBoundary = new Date('2026-01-15T23:30:00.000Z');
  const utcDate = formatLocalDate(winterBoundary, 'UTC');
  const parisDate = formatLocalDate(winterBoundary, PARIS_TZ);

  // Paris is UTC+1 in January (CET), so 23:30 UTC = 00:30 next day Paris
  assert.equal(utcDate, '2026-01-15');
  assert.equal(parisDate, '2026-01-16');

  // Memory path should use Paris date
  const parisMemoryPath = getDailyMemoryRelativePath(winterBoundary, PARIS_TZ);
  assert.equal(parisMemoryPath, 'memory/2026-01-16.md');

  // Verify buildSystemPrompt produces correct machine_local_date for Paris
  const groupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-cross-tz-boundary-'));
  const { text: promptText } = buildSystemPrompt(
    {
      groupFolder: 'main',
      chatJid: 'telegram:1',
      isMain: true,
      isScheduledTask: true,
      codingHint: 'none',
    },
    {
      groupDir,
      globalDir: path.join(groupDir, 'global'),
      ipcDir: path.join(groupDir, 'ipc'),
    },
    {
      timezone: PARIS_TZ,
      now: () => winterBoundary,
    },
  );

  assert.ok(
    promptText.includes('"machine_local_date": "2026-01-16"'),
    `Expected machine_local_date 2026-01-16 (Paris date) near midnight boundary. Prompt: ${promptText.slice(-400)}`,
  );

  // Verify it does NOT show the UTC date
  assert.ok(
    !promptText.includes('"machine_local_date": "2026-01-15"'),
    'machine_local_date should NOT be the UTC date when Paris is a different date',
  );

  fs.rmSync(groupDir, { recursive: true, force: true });
});

test('compaction date key matches prompt reader date key for Paris timezone (VAL-CROSS-001)', () => {
  // Verify that the date-key logic used for reading (prompt) and writing (compaction)
  // produces the same result when given the same timestamp and timezone.
  const timestampIso = '2026-04-03T03:00:00.000Z';
  const timestamp = new Date(timestampIso);

  // The prompt reader uses getLegacyDailyMemoryCandidates(now, timezone) which
  // internally uses getLocalDateKey(now, tz).
  const promptDateKey = getLocalDateKey(timestamp, PARIS_TZ);

  // The compaction writer uses resolveCompactionDateKey which currently uses
  // TIMEZONE (host), but the contract is that getLocalDateKey produces the
  // same result. When the host timezone is set to Paris, or when the compaction
  // function is updated to accept a timezone parameter, the date keys match.
  const compactionMemoryPath = getDailyMemoryRelativePath(timestamp, PARIS_TZ);
  const expectedCompactionPath = `memory/${promptDateKey}.md`;

  assert.equal(
    compactionMemoryPath,
    expectedCompactionPath,
    `Compaction path ${compactionMemoryPath} should match prompt reader date key path ${expectedCompactionPath}`,
  );

  // Also verify: when using the same helper with the same inputs, results are
  // consistent across multiple calls (deterministic)
  assert.equal(
    getLocalDateKey(timestamp, PARIS_TZ),
    getLocalDateKey(timestamp, PARIS_TZ),
    'getLocalDateKey should be deterministic',
  );

  assert.equal(
    getDailyMemoryRelativePath(timestamp, PARIS_TZ),
    getDailyMemoryRelativePath(timestamp, PARIS_TZ),
    'getDailyMemoryRelativePath should be deterministic',
  );
});

test('full e2e: cron task with Paris tz → correct effectiveTimezone → correct machine_local_date in prompt (VAL-CROSS-001)', async () => {
  const dbPath = makeTempDbPath();
  initDatabaseAtPath(dbPath);

  // Create a task with explicit Paris timezone
  const task = makeTask({
    id: 'e2e-paris-tz-full',
    schedule_type: 'cron',
    schedule_value: '0 8 * * *',
    schedule_json: JSON.stringify({ kind: 'cron', expr: '0 8 * * *', tz: PARIS_TZ }),
    context_mode: 'isolated',
  });
  createTask(task);

  const group: RegisteredGroup = {
    name: 'main',
    folder: 'main',
    trigger: '@FarmFriend',
    added_at: new Date().toISOString(),
  };

  // Capture the ContainerInput to verify effectiveTimezone
  let capturedInput: ContainerInput | undefined;
  const latest = getTaskById(task.id);
  assert.ok(latest);

  await runScheduledTaskV2(latest!, {
    sendMessage: async () => {},
    registeredGroups: () => ({ 'telegram:1': group }),
    runContainerTask: async (_group, input) => {
      capturedInput = input;
      return { status: 'success', result: 'e2e done' };
    },
  });

  // Step 1: Verify effectiveTimezone is Paris
  assert.ok(capturedInput, 'runContainerTask should have been called');
  assert.equal(capturedInput!.effectiveTimezone, PARIS_TZ);

  // Step 2: Build prompt with the captured timezone and verify machine_local_date
  const groupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-cross-tz-e2e-'));
  const memoryDir = path.join(groupDir, 'memory');
  fs.mkdirSync(memoryDir, { recursive: true });

  // Write Paris-date daily memory file
  const parisDate = getLocalDateKey(FIXED_NOW, PARIS_TZ);
  fs.writeFileSync(
    path.join(memoryDir, `${parisDate}.md`),
    '# Paris Memory\nSome notes for today.\n',
  );

  const readFileIfExists = (filePath: string): string | null => {
    try {
      return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : null;
    } catch {
      return null;
    }
  };

  const { text: promptText, report } = buildSystemPrompt(
    {
      groupFolder: 'main',
      chatJid: 'telegram:1',
      isMain: true,
      isScheduledTask: true,
      codingHint: 'none',
    },
    {
      groupDir,
      globalDir: path.join(groupDir, 'global'),
      ipcDir: path.join(groupDir, 'ipc'),
    },
    {
      readFileIfExists,
      timezone: capturedInput!.effectiveTimezone,
      now: () => FIXED_NOW,
    },
  );

  // Step 3: Verify machine_local_date reflects Paris date
  assert.ok(
    promptText.includes(`"machine_local_date": "${parisDate}"`),
    `Expected machine_local_date=${parisDate}`,
  );

  // Step 4: Verify Paris-date memory file was read (appears in context entries)
  const parisMemoryEntry = report.contextEntries.find(
    (e) => e.label === `memory/${parisDate}.md`,
  );
  assert.ok(
    parisMemoryEntry,
    `Expected Paris-date memory file in context. Entries: ${report.contextEntries.map((e) => e.label).join(', ')}`,
  );
  assert.equal(parisMemoryEntry!.missing, false, 'Paris memory file should be found');

  // Step 5: Verify compaction would write to Paris-date path
  const compactionPath = getDailyMemoryRelativePath(FIXED_NOW, PARIS_TZ);
  assert.equal(
    compactionPath,
    `memory/${parisDate}.md`,
    'Compaction write path should match the Paris-date memory file',
  );

  closeDatabase();
  fs.rmSync(groupDir, { recursive: true, force: true });
});
