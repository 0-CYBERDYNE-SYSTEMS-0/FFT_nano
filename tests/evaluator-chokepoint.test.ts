import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';

import {
  closeDatabase,
  initDatabaseAtPath,
  getDb,
  getDeliveryByDedupeKey,
} from '../src/db.js';
import {
  recordVerdictOutcome,
  verdictToOutcome,
  type EvaluatorOutcome,
} from '../src/evaluator.js';
import { mintRunAuthority } from '../src/run-authority.js';
import type { RunAuthority } from '../src/types.js';
import { state } from '../src/app-state.js';

test.afterEach(() => {
  closeDatabase();
});

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fft-eval-chokepoint-'));
}

/** Build a RunAuthority for testing with a custom runType */
function makeTestAuthority(runType: string): RunAuthority {
  return mintRunAuthority({
    requestId: `test-${runType}-${Date.now()}`,
    groupFolder: 'test-group',
    isMain: false,
    isSubagent: false,
    isScheduledTask: false,
    effectiveToolSet: ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls', 'agent'],
    senderRole: 'operator',
  });
}

// ---------------------------------------------------------------------------
// VAL-WS4-003: recordVerdictOutcome discriminates verdict / eligible-skip / threshold-skip
// ---------------------------------------------------------------------------

test('VAL-WS4-003: recordVerdictOutcome discriminates verdict / eligible-skip / threshold-skip', (t) => {
  const tmpRoot = makeTmpDir();
  const dbPath = path.join(tmpRoot, 'messages.db');
  try {
    initDatabaseAtPath(dbPath);

    const authority = makeTestAuthority('coding');

    // CASE 1: verdict → row with skipped=0
    const verdictOutcome: EvaluatorOutcome = {
      kind: 'verdict',
      runType: 'coding',
      pass: true,
      score: 8,
      issues: [],
      feedback: 'Good work',
      refinements: 0,
      skipped: false,
    };
    recordVerdictOutcome({ authority, outcome: verdictOutcome });

    // CASE 2: eligible-skip → row with skipped=1 and skip_reason
    const eligibleSkipOutcome: EvaluatorOutcome = {
      kind: 'eligible-skip',
      runType: 'coding',
      pass: false,
      score: 0,
      issues: [],
      feedback: '',
      refinements: 0,
      skipReason: 'evaluator-threw',
      skipped: true,
    };
    recordVerdictOutcome({ authority, outcome: eligibleSkipOutcome });

    // CASE 3: threshold-skip → no row written
    const thresholdSkipOutcome: EvaluatorOutcome = {
      kind: 'threshold-skip',
      runType: 'coding',
      skipReason: 'trivially-short-run',
      skipped: true,
    };
    recordVerdictOutcome({ authority, outcome: thresholdSkipOutcome });

    // Verify database state using direct DB access
    const db = getDb();
    const rows = db!
      .prepare(
        `SELECT request_id, skipped, skip_reason, pass, score FROM evaluator_verdicts WHERE group_folder = 'test-group'`,
      )
      .all() as Array<{
        request_id: string | null;
        skipped: number;
        skip_reason: string | null;
        pass: number;
        score: number;
      }>;

    assert.equal(rows.length, 2, 'threshold-skip should not write a row');

    const verdictRow = rows.find((r) => r.skipped === 0);
    assert.ok(verdictRow, 'verdict row should exist');
    assert.equal(verdictRow!.pass, 1);
    assert.equal(verdictRow!.score, 8);

    const skipRow = rows.find((r) => r.skipped === 1);
    assert.ok(skipRow, 'eligible-skip row should exist');
    assert.equal(skipRow!.pass, 0);
    assert.equal(skipRow!.score, 0);
    assert.equal(skipRow!.skip_reason, 'evaluator-threw');
  } finally {
    closeDatabase();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('VAL-WS4-007: hypothetical runType foo cannot silently skip recording through the chokepoint', () => {
  const tmpRoot = makeTmpDir();
  const dbPath = path.join(tmpRoot, 'messages.db');
  try {
    initDatabaseAtPath(dbPath);

    const authority = makeTestAuthority('foo');

    // verdict with runType 'foo'
    const verdictOutcome: EvaluatorOutcome = {
      kind: 'verdict',
      runType: 'foo' as any, // hypothetical future run type
      pass: true,
      score: 7,
      issues: [],
      feedback: 'OK',
      refinements: 0,
      skipped: false,
    };
    recordVerdictOutcome({ authority, outcome: verdictOutcome });

    // eligible-skip with runType 'foo'
    const skipOutcome: EvaluatorOutcome = {
      kind: 'eligible-skip',
      runType: 'foo' as any,
      pass: false,
      score: 0,
      issues: [],
      feedback: '',
      refinements: 0,
      skipReason: 'evaluator-error',
      skipped: true,
    };
    recordVerdictOutcome({ authority, outcome: skipOutcome });

    // threshold-skip with runType 'foo' → no row
    const thresholdOutcome: EvaluatorOutcome = {
      kind: 'threshold-skip',
      runType: 'foo' as any,
      skipReason: 'empty-output',
      skipped: true,
    };
    recordVerdictOutcome({ authority, outcome: thresholdOutcome });

    // Verify
    const db = getDb();
    const rows = db!
      .prepare(
        `SELECT request_id, skipped, skip_reason, run_type FROM evaluator_verdicts WHERE group_folder = 'test-group'`,
      )
      .all() as Array<{ run_type: string; skipped: number; skip_reason: string | null }>;

    assert.equal(rows.length, 2, 'threshold-skip must not write a row');

    // Both rows should have run_type 'foo'
    assert.ok(rows.every((r) => r.run_type === 'foo'), 'run_type should be preserved');
  } finally {
    closeDatabase();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('verdictToOutcome converts verdict with skipped=true (eligible) to eligible-skip', () => {
  const verdict = {
    pass: false,
    score: -1,
    issues: [],
    feedback: '',
    skipped: true,
    skippedReason: 'evaluator threw',
  };

  const outcome = verdictToOutcome('cron', verdict, 0);

  assert.equal(outcome.kind, 'eligible-skip');
  assert.equal(outcome.skipReason, 'evaluator-threw');
  assert.equal(outcome.skipped, true);
});

test('verdictToOutcome converts verdict with skipped=true (threshold) to threshold-skip', () => {
  const verdict = {
    pass: true,
    score: -1,
    issues: [],
    feedback: '',
    skipped: true,
    skippedReason: 'trivially short run',
  };

  const outcome = verdictToOutcome('cron', verdict, 0);

  assert.equal(outcome.kind, 'threshold-skip');
  assert.equal(outcome.skipReason, 'trivially-short-run');
  assert.equal(outcome.skipped, true);
});

test('verdictToOutcome converts verdict with skipped=false to verdict', () => {
  const verdict = {
    pass: true,
    score: 8,
    issues: [],
    feedback: 'Good',
    skipped: false,
  };

  const outcome = verdictToOutcome('coding', verdict, 2);

  assert.equal(outcome.kind, 'verdict');
  assert.equal(outcome.pass, true);
  assert.equal(outcome.score, 8);
  assert.equal(outcome.refinements, 2);
  assert.equal(outcome.skipped, false);
});

// ---------------------------------------------------------------------------
// VAL-WS4-010: Degraded-signal alert fires once per 24h per group
// ---------------------------------------------------------------------------

/**
 * Seed evaluator_verdicts rows directly into the DB for testing.
 * Each row has: request_id, group_folder, run_type, pass, score, issues, skipped, skip_reason, created_at
 */
function seedVerdictRows(
  db: Database.Database,
  rows: Array<{
    requestId: string;
    groupFolder: string;
    runType: string;
    pass: number;
    score: number;
    skipped: number;
    skipReason?: string;
    createdAt?: Date;
  }>,
): void {
  for (const row of rows) {
    db.prepare(
      `INSERT INTO evaluator_verdicts (request_id, group_folder, run_type, pass, score, issues, skipped, skip_reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      row.requestId,
      row.groupFolder,
      row.runType,
      row.pass,
      row.score,
      '[]',
      row.skipped,
      row.skipReason ?? null,
      (row.createdAt ?? new Date()).toISOString(),
    );
  }
}

/**
 * Set up state.registeredGroups with a main group so findMainChatJid() returns a valid JID.
 */
function setupMainGroupState(): void {
  // Clear any existing state and set up a main group
  state.registeredGroups = {};
  state.registeredGroups['telegram:123456789'] = {
    folder: 'main',
    name: 'Test Main',
    jid: 'telegram:123456789',
  };
}

test('VAL-WS4-010: 6 of 10 rows skipped returns shouldAlert:true and writes delivery_outbox row', () => {
  const tmpRoot = makeTmpDir();
  const dbPath = path.join(tmpRoot, 'messages.db');
  try {
    initDatabaseAtPath(dbPath);

    // Set up main group state so findMainChatJid() works
    setupMainGroupState();

    const groupFolder = 'test-group';

    // Seed 9 rows: 4 non-skipped verdicts + 5 skipped (5 of 9 = 55%, but < 50% of 10)
    // After adding the 10th skip, we'll have 6 of 10 skipped (> 50%)
    seedVerdictRows(getDb()!, [
      // 4 non-skipped (pass)
      { requestId: 'v1', groupFolder, runType: 'coding', pass: 1, score: 8, skipped: 0 },
      { requestId: 'v2', groupFolder, runType: 'coding', pass: 1, score: 9, skipped: 0 },
      { requestId: 'v3', groupFolder, runType: 'coding', pass: 0, score: 4, skipped: 0 },
      { requestId: 'v4', groupFolder, runType: 'coding', pass: 1, score: 7, skipped: 0 },
      // 5 skipped (but only 5 of 9 = 55%, still need 1 more to trigger with 10 rows)
      { requestId: 's1', groupFolder, runType: 'coding', pass: 0, score: 0, skipped: 1, skipReason: 'evaluator-threw' },
      { requestId: 's2', groupFolder, runType: 'coding', pass: 0, score: 0, skipped: 1, skipReason: 'evaluator-threw' },
      { requestId: 's3', groupFolder, runType: 'coding', pass: 0, score: 0, skipped: 1, skipReason: 'evaluator-error' },
      { requestId: 's4', groupFolder, runType: 'coding', pass: 0, score: 0, skipped: 1, skipReason: 'unparseable-verdict' },
      { requestId: 's5', groupFolder, runType: 'coding', pass: 0, score: 0, skipped: 1, skipReason: 'evaluator-threw' },
    ]);

    const authority = makeTestAuthority('coding');

    // Record an eligible-skip - this will be the 10th row
    // After this: 6 skipped out of 10 (> 50%) → shouldAlert: true
    const eligibleSkipOutcome: EvaluatorOutcome = {
      kind: 'eligible-skip',
      runType: 'coding',
      pass: false,
      score: 0,
      issues: [],
      feedback: '',
      refinements: 0,
      skipReason: 'evaluator-threw',
      skipped: true,
    };

    const result = recordVerdictOutcome({ authority, outcome: eligibleSkipOutcome });

    assert.equal(result.shouldAlert, true, 'shouldAlert should be true when 6+ of 10 rows are skipped');

    // Verify delivery_outbox row was written with the correct dedupe_key
    const outboxRow = getDeliveryByDedupeKey(`eval-degraded:${groupFolder}`);
    assert.ok(outboxRow, 'delivery_outbox row should be written for degraded signal alert');
    assert.equal(outboxRow!.status, 'pending');
    assert.ok(outboxRow!.body.includes('evaluation is degraded'), 'body should contain degraded phrase');
    assert.ok(outboxRow!.body.includes(groupFolder), 'body should contain group name');
  } finally {
    state.registeredGroups = {};
    closeDatabase();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('VAL-WS4-010: Second skip streak within 24h does not write a second delivery_outbox row', () => {
  const tmpRoot = makeTmpDir();
  const dbPath = path.join(tmpRoot, 'messages.db');
  try {
    initDatabaseAtPath(dbPath);
    setupMainGroupState();

    const groupFolder = 'test-group';

    // Seed 10 rows with 6 skipped to trigger the alert
    seedVerdictRows(getDb()!, [
      { requestId: 'v1', groupFolder, runType: 'coding', pass: 1, score: 8, skipped: 0 },
      { requestId: 'v2', groupFolder, runType: 'coding', pass: 1, score: 9, skipped: 0 },
      { requestId: 'v3', groupFolder, runType: 'coding', pass: 1, score: 7, skipped: 0 },
      { requestId: 'v4', groupFolder, runType: 'coding', pass: 1, score: 8, skipped: 0 },
      { requestId: 's1', groupFolder, runType: 'coding', pass: 0, score: 0, skipped: 1, skipReason: 'evaluator-threw' },
      { requestId: 's2', groupFolder, runType: 'coding', pass: 0, score: 0, skipped: 1, skipReason: 'evaluator-threw' },
      { requestId: 's3', groupFolder, runType: 'coding', pass: 0, score: 0, skipped: 1, skipReason: 'evaluator-error' },
      { requestId: 's4', groupFolder, runType: 'coding', pass: 0, score: 0, skipped: 1, skipReason: 'unparseable-verdict' },
      { requestId: 's5', groupFolder, runType: 'coding', pass: 0, score: 0, skipped: 1, skipReason: 'evaluator-threw' },
      { requestId: 's6', groupFolder, runType: 'coding', pass: 0, score: 0, skipped: 1, skipReason: 'evaluator-threw' },
    ]);

    // First call triggers the alert
    let authority = makeTestAuthority('coding');
    const eligibleSkipOutcome: EvaluatorOutcome = {
      kind: 'eligible-skip',
      runType: 'coding',
      pass: false,
      score: 0,
      issues: [],
      feedback: '',
      refinements: 0,
      skipReason: 'evaluator-threw',
      skipped: true,
    };

    const result1 = recordVerdictOutcome({ authority, outcome: eligibleSkipOutcome });
    assert.equal(result1.shouldAlert, true, 'first call should trigger alert');

    // Verify the outbox row exists
    const outboxRow = getDeliveryByDedupeKey(`eval-degraded:${groupFolder}`);
    assert.ok(outboxRow, 'outbox row should exist after first alert');

    // Second eligible-skip should NOT write another row (UNIQUE constraint)
    // The 11th row would have 7 skipped of 11 (still > 50%), but the dedupe_key already exists
    const result2 = recordVerdictOutcome({ authority, outcome: eligibleSkipOutcome });

    // shouldAlert might still be true (stats still show > 5 skips) but the UNIQUE
    // constraint prevents a second row from being written
    // The actual implementation checks the dedupe via enqueueDelivery which uses INSERT OR IGNORE
    // So we verify only ONE outbox row exists
    const outboxRows = getDb()!
      .prepare(`SELECT * FROM delivery_outbox WHERE dedupe_key = ?`)
      .all(`eval-degraded:${groupFolder}`);

    assert.equal(outboxRows.length, 1, 'only one delivery_outbox row should exist (UNIQUE constraint)');
  } finally {
    state.registeredGroups = {};
    closeDatabase();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('VAL-WS4-010: Below threshold (5 of 10 skipped) returns shouldAlert:false', () => {
  const tmpRoot = makeTmpDir();
  const dbPath = path.join(tmpRoot, 'messages.db');
  try {
    initDatabaseAtPath(dbPath);
    setupMainGroupState();

    const groupFolder = 'test-group';

    // Seed 9 rows: 5 non-skipped + 4 skipped
    // Then add 1 more skipped → 5 skipped / 10 total = 50% (NOT > 50%)
    seedVerdictRows(getDb()!, [
      { requestId: 'v1', groupFolder, runType: 'coding', pass: 1, score: 8, skipped: 0 },
      { requestId: 'v2', groupFolder, runType: 'coding', pass: 1, score: 9, skipped: 0 },
      { requestId: 'v3', groupFolder, runType: 'coding', pass: 1, score: 7, skipped: 0 },
      { requestId: 'v4', groupFolder, runType: 'coding', pass: 0, score: 4, skipped: 0 },
      { requestId: 'v5', groupFolder, runType: 'coding', pass: 1, score: 8, skipped: 0 },
      // 5 non-skipped
      { requestId: 's1', groupFolder, runType: 'coding', pass: 0, score: 0, skipped: 1, skipReason: 'evaluator-threw' },
      { requestId: 's2', groupFolder, runType: 'coding', pass: 0, score: 0, skipped: 1, skipReason: 'evaluator-threw' },
      { requestId: 's3', groupFolder, runType: 'coding', pass: 0, score: 0, skipped: 1, skipReason: 'evaluator-error' },
      { requestId: 's4', groupFolder, runType: 'coding', pass: 0, score: 0, skipped: 1, skipReason: 'unparseable-verdict' },
      // 4 skipped → total 9 rows
    ]);

    const authority = makeTestAuthority('coding');
    const eligibleSkipOutcome: EvaluatorOutcome = {
      kind: 'eligible-skip',
      runType: 'coding',
      pass: false,
      score: 0,
      issues: [],
      feedback: '',
      refinements: 0,
      skipReason: 'evaluator-threw',
      skipped: true,
    };

    // After adding the 10th row (skipped): 5 non-skipped + 5 skipped / 10 = 50%
    // > 50% is false, so shouldAlert should be false
    const result = recordVerdictOutcome({ authority, outcome: eligibleSkipOutcome });
    assert.equal(result.shouldAlert, false, 'shouldAlert should be false when exactly 5 of 10 rows are skipped (50%, not >50%)');
  } finally {
    state.registeredGroups = {};
    closeDatabase();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// VAL-WS4-011: Alert dedupe is per group, not global
// ---------------------------------------------------------------------------

test('VAL-WS4-011: Group A and Group B alerts are independent', () => {
  const tmpRoot = makeTmpDir();
  const dbPath = path.join(tmpRoot, 'messages.db');
  try {
    initDatabaseAtPath(dbPath);
    setupMainGroupState();

    const groupA = 'test-group-A';
    const groupB = 'test-group-B';

    // Seed group A: 4 non-skipped + 6 skipped = 6 of 10 skipped (>50% → trigger)
    seedVerdictRows(getDb()!, [
      { requestId: 'Av1', groupFolder: groupA, runType: 'coding', pass: 1, score: 8, skipped: 0 },
      { requestId: 'Av2', groupFolder: groupA, runType: 'coding', pass: 1, score: 9, skipped: 0 },
      { requestId: 'Av3', groupFolder: groupA, runType: 'coding', pass: 1, score: 7, skipped: 0 },
      { requestId: 'Av4', groupFolder: groupA, runType: 'coding', pass: 1, score: 8, skipped: 0 },
      { requestId: 'As1', groupFolder: groupA, runType: 'coding', pass: 0, score: 0, skipped: 1, skipReason: 'evaluator-threw' },
      { requestId: 'As2', groupFolder: groupA, runType: 'coding', pass: 0, score: 0, skipped: 1, skipReason: 'evaluator-threw' },
      { requestId: 'As3', groupFolder: groupA, runType: 'coding', pass: 0, score: 0, skipped: 1, skipReason: 'evaluator-error' },
      { requestId: 'As4', groupFolder: groupA, runType: 'coding', pass: 0, score: 0, skipped: 1, skipReason: 'unparseable-verdict' },
      { requestId: 'As5', groupFolder: groupA, runType: 'coding', pass: 0, score: 0, skipped: 1, skipReason: 'evaluator-threw' },
      { requestId: 'As6', groupFolder: groupA, runType: 'coding', pass: 0, score: 0, skipped: 1, skipReason: 'evaluator-threw' },
    ]);

    // Seed group B: 4 non-skipped + 6 skipped = 6 of 10 skipped (>50% → trigger)
    seedVerdictRows(getDb()!, [
      { requestId: 'Bv1', groupFolder: groupB, runType: 'coding', pass: 1, score: 8, skipped: 0 },
      { requestId: 'Bv2', groupFolder: groupB, runType: 'coding', pass: 1, score: 9, skipped: 0 },
      { requestId: 'Bv3', groupFolder: groupB, runType: 'coding', pass: 1, score: 7, skipped: 0 },
      { requestId: 'Bv4', groupFolder: groupB, runType: 'coding', pass: 1, score: 8, skipped: 0 },
      { requestId: 'Bs1', groupFolder: groupB, runType: 'coding', pass: 0, score: 0, skipped: 1, skipReason: 'evaluator-threw' },
      { requestId: 'Bs2', groupFolder: groupB, runType: 'coding', pass: 0, score: 0, skipped: 1, skipReason: 'evaluator-threw' },
      { requestId: 'Bs3', groupFolder: groupB, runType: 'coding', pass: 0, score: 0, skipped: 1, skipReason: 'evaluator-error' },
      { requestId: 'Bs4', groupFolder: groupB, runType: 'coding', pass: 0, score: 0, skipped: 1, skipReason: 'unparseable-verdict' },
      { requestId: 'Bs5', groupFolder: groupB, runType: 'coding', pass: 0, score: 0, skipped: 1, skipReason: 'evaluator-threw' },
      { requestId: 'Bs6', groupFolder: groupB, runType: 'coding', pass: 0, score: 0, skipped: 1, skipReason: 'evaluator-threw' },
    ]);

    // Create authorities with correct group folders
    const authorityA: RunAuthority = {
      ...makeTestAuthority('coding'),
      requestId: `test-coding-A-${Date.now()}`,
      groupFolder: groupA,
    };

    const authorityB: RunAuthority = {
      ...makeTestAuthority('coding'),
      requestId: `test-coding-B-${Date.now()}`,
      groupFolder: groupB,
    };

    const eligibleSkipOutcome: EvaluatorOutcome = {
      kind: 'eligible-skip',
      runType: 'coding',
      pass: false,
      score: 0,
      issues: [],
      feedback: '',
      refinements: 0,
      skipReason: 'evaluator-threw',
      skipped: true,
    };

    // Trigger alert for group A
    const resultA = recordVerdictOutcome({ authority: authorityA, outcome: eligibleSkipOutcome });
    assert.equal(resultA.shouldAlert, true, 'Group A should trigger alert');

    // Trigger alert for group B
    const resultB = recordVerdictOutcome({ authority: authorityB, outcome: eligibleSkipOutcome });
    assert.equal(resultB.shouldAlert, true, 'Group B should trigger alert (independent of Group A)');

    // Verify both groups have their own outbox rows with distinct dedupe_keys
    const outboxRowA = getDeliveryByDedupeKey(`eval-degraded:${groupA}`);
    const outboxRowB = getDeliveryByDedupeKey(`eval-degraded:${groupB}`);

    assert.ok(outboxRowA, 'Group A should have an outbox row');
    assert.ok(outboxRowB, 'Group B should have an outbox row');
    assert.notEqual(outboxRowA!.dedupe_key, outboxRowB!.dedupe_key, 'dedupe_keys should be distinct per group');

    // Verify both rows exist in the database
    const allOutboxRows = getDb()!
      .prepare(`SELECT * FROM delivery_outbox WHERE dedupe_key LIKE 'eval-degraded:%'`)
      .all();

    assert.equal(allOutboxRows.length, 2, 'both groups should have their own outbox rows');
  } finally {
    state.registeredGroups = {};
    closeDatabase();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
