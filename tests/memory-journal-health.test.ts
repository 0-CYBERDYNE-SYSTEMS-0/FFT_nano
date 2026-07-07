import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  buildDailyJournalBody,
  isJournalScaffoldContent,
  loadJournalPristineState,
  recordJournalPristineObservation,
} from '../src/memory-paths.js';
import { buildHeartbeatChecklist } from '../src/heartbeat-checklist.js';
import {
  mergeAndRankMemoryHits,
  searchDocumentMemory,
  type MemorySearchHit,
} from '../src/memory-search.js';

// ---------------------------------------------------------------------------
// Test 1 — isJournalScaffoldContent distinguishes pristine scaffold from
//          a written journal (one bullet under ## Session Notes flips it).
// ---------------------------------------------------------------------------

test('isJournalScaffoldContent: pristine scaffold is scaffold; one appended Session Notes bullet is not', () => {
  const dateKey = '2026-07-07';
  const scaffold = buildDailyJournalBody(dateKey);
  assert.equal(isJournalScaffoldContent(dateKey, scaffold), true);
  const written = `${scaffold}- Decision: ship SPEC-05\n`;
  assert.equal(isJournalScaffoldContent(dateKey, written), false);
});

// ---------------------------------------------------------------------------
// Test 2 — heartbeat checklist uses local-tz key (not UTC), reports existence,
//          and reports writtenToday (false on pristine scaffold, true on
//          an appended journal).
// ---------------------------------------------------------------------------

test('buildHeartbeatChecklist uses local-tz key for memoryToday.path; writtenToday reports pristine vs written', () => {
  const workspaceDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'fft-jh-checklist-'),
  );
  try {
    fs.mkdirSync(path.join(workspaceDir, 'memory'), { recursive: true });
    fs.mkdirSync(path.join(workspaceDir, 'canonical'), { recursive: true });
    fs.mkdirSync(path.join(workspaceDir, 'skills'), { recursive: true });
    const fixturedJournalDateKey = '2026-07-06';
    // First sub-case: only the pristine scaffold written to memory/2026-07-06.md
    fs.writeFileSync(
      path.join(workspaceDir, 'memory', `${fixturedJournalDateKey}.md`),
      `${buildDailyJournalBody(fixturedJournalDateKey)}\n`,
      'utf-8',
    );

    const FIXED_NOW = new Date('2026-07-06T19:14:00-07:00');
    const checklist = buildHeartbeatChecklist({
      workspaceDir,
      requestId: 'hb-test-pristine',
      reason: 'unit-test',
      result: 'HEARTBEAT_OK',
      ok: true,
      currentTasksPath: path.join(workspaceDir, 'current_tasks.json'),
      runtimeLogPath: path.join(workspaceDir, 'runtime.log'),
      now: FIXED_NOW,
      timezone: 'America/Los_Angeles',
    });

    assert.match(
      checklist.checks.memoryToday.path,
      /2026-07-06\.md$/,
      `expected path to end in 2026-07-06.md (local-tz July 6 PDT), got ${checklist.checks.memoryToday.path}`,
    );
    assert.doesNotMatch(
      checklist.checks.memoryToday.path,
      /2026-07-07\.md$/,
      'heartbeat-checklist must not use UTC date math (the buggy behavior)',
    );
    assert.equal(checklist.checks.memoryToday.exists, true);
    assert.equal(checklist.checks.memoryToday.writtenToday, false);

    // Second sub-case: same setup but with one appended session-notes bullet.
    const writtenJournal = `${buildDailyJournalBody(fixturedJournalDateKey)}\n- Captured decision: ship SPEC-05.\n`;
    fs.writeFileSync(
      path.join(workspaceDir, 'memory', `${fixturedJournalDateKey}.md`),
      writtenJournal,
      'utf-8',
    );

    const checklistWritten = buildHeartbeatChecklist({
      workspaceDir,
      requestId: 'hb-test-written',
      reason: 'unit-test',
      result: 'HEARTBEAT_OK',
      ok: true,
      currentTasksPath: path.join(workspaceDir, 'current_tasks.json'),
      runtimeLogPath: path.join(workspaceDir, 'runtime.log'),
      now: FIXED_NOW,
      timezone: 'America/Los_Angeles',
    });

    assert.equal(checklistWritten.checks.memoryToday.exists, true);
    assert.equal(checklistWritten.checks.memoryToday.writtenToday, true);
  } finally {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 3 — consecutive-pristine counter increments on pristine days and
//          resets to 0 on a written day. Idempotent for same-date repeat calls.
// ---------------------------------------------------------------------------

test('consecutive-pristine counter: 3 pristine days in a row → 3; written day resets to 0', () => {
  const workspaceDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'fft-jh-counter-'),
  );
  try {
    // Three pristine days in a row.
    const first = recordJournalPristineObservation(
      workspaceDir,
      '2026-07-04',
      false,
    );
    assert.equal(first.consecutivePristineDays, 1);

    const second = recordJournalPristineObservation(
      workspaceDir,
      '2026-07-05',
      false,
    );
    assert.equal(second.consecutivePristineDays, 2);

    const third = recordJournalPristineObservation(
      workspaceDir,
      '2026-07-06',
      false,
    );
    assert.equal(third.consecutivePristineDays, 3);

    // Reload sanity check: persisted file should reflect count = 3.
    const persisted = loadJournalPristineState(workspaceDir);
    assert.equal(persisted.consecutivePristineDays, 3);
    assert.equal(persisted.lastSeenDateKey, '2026-07-06');

    // A written day resets the counter to 0.
    const written = recordJournalPristineObservation(
      workspaceDir,
      '2026-07-07',
      true,
    );
    assert.equal(written.consecutivePristineDays, 0);

    // Subsequent pristine day counts from 0 again.
    const afterWrite = recordJournalPristineObservation(
      workspaceDir,
      '2026-07-08',
      false,
    );
    assert.equal(afterWrite.consecutivePristineDays, 1);

    // Same-day repeat is idempotent (does not double-count).
    const idempotent = recordJournalPristineObservation(
      workspaceDir,
      '2026-07-08',
      false,
    );
    assert.equal(idempotent.consecutivePristineDays, 1);
  } finally {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 4 — searchDocumentMemory applies recency decay to memory/YYYY-MM-DD.md
//          chunks: equal-lexical+path-score old + new → new ranks first.
// ---------------------------------------------------------------------------

test('searchDocumentMemory applies recency decay to memory/YYYY-MM-DD.md chunks: fresh beats 35-day-old when raw scores tie', () => {
  const folder = `test-jh-recency-${Date.now()}`;
  const workspaceDir = path.join(process.cwd(), 'groups', folder);
  const memoryDir = path.join(workspaceDir, 'memory');
  fs.mkdirSync(memoryDir, { recursive: true });

  // Identical body content → identical lexical score AND identical
  // path-bonus (both are under memory/), so the only differentiator is the
  // recency decay factor.
  const sharedContent =
    '# Note\n\nMemory of the recency debate, with rich-token-keywords everywhere.\n';

  // Old journal: 36 days prior to fixed now (≥ 35 as the spec requires).
  fs.writeFileSync(
    path.join(memoryDir, '2026-05-30-x.md'),
    `${sharedContent}\n`,
    'utf-8',
  );
  // Fresh journal: matches fixed now's local-tz date key.
  fs.writeFileSync(
    path.join(memoryDir, '2026-07-05.md'),
    `${sharedContent}\n`,
    'utf-8',
  );

  try {
    const FIXED_NOW = new Date('2026-07-05T20:00:00-07:00');
    const hits = searchDocumentMemory({
      groupFolder: folder,
      query: 'recency debate rich-token-keywords',
      topK: 8,
      includeGlobal: false,
      now: FIXED_NOW,
    });

    assert.equal(hits.length, 2, 'expected exactly 2 hits (one per file)');
    assert.equal(
      hits[0].path,
      'memory/2026-07-05.md',
      `expected freshest journal first, got ${hits[0].path}`,
    );
    assert.equal(hits[1].path, 'memory/2026-05-30-x.md');
    assert.ok(
      hits[0].score > hits[1].score,
      `fresh score (${hits[0].score}) must beat stale (${hits[1].score})`,
    );
  } finally {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 5 — mergeAndRankMemoryHits caps any single path's contribution so one
//          file cannot structurally occupy the entire merged top-K.
// ---------------------------------------------------------------------------

test('mergeAndRankMemoryHits: diversity cap limits a single dominant path to ceil(topK/2) when other paths have qualifying candidates', () => {
  function makeHit(relPath: string, score: number): MemorySearchHit {
    return {
      source: 'memory_doc',
      score,
      groupFolder: 'test',
      title: relPath,
      path: relPath,
      snippet: 'snippet',
    };
  }

  const hits: MemorySearchHit[] = [];
  // 10 hits from memory/old-snapshot.md, descending 5.0 → 4.1.
  for (let i = 0; i < 10; i++) {
    hits.push(makeHit('memory/old-snapshot.md', 5.0 - i * 0.1));
  }
  // 2 hits from MEMORY.md, scores 1.5 and 1.0 — all A's outrank both B's.
  hits.push(makeHit('MEMORY.md', 1.5));
  hits.push(makeHit('MEMORY.md', 1.0));

  const result = mergeAndRankMemoryHits(hits, 6);

  assert.ok(result.length <= 6, `result must not exceed topK=6, got ${result.length}`);
  const fromA = result.filter((h) => h.path === 'memory/old-snapshot.md').length;
  const fromB = result.filter((h) => h.path === 'MEMORY.md').length;
  assert.ok(
    fromA <= 3,
    `dominant path may contribute at most ceil(6/2)=3, got ${fromA}`,
  );
  assert.ok(fromB >= 1, 'secondary path should contribute at least 1 hit');
  assert.equal(fromA + fromB, result.length);
});
