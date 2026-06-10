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
} from '../src/db.js';
import {
  recordVerdictOutcome,
  verdictToOutcome,
  type EvaluatorOutcome,
} from '../src/evaluator.js';
import { mintRunAuthority } from '../src/run-authority.js';
import type { RunAuthority } from '../src/types.js';

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
  assert.equal(outcome.skipReason, 'evaluator threw');
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
  assert.equal(outcome.skipReason, 'trivially short run');
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
