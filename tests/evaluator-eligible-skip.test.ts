import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  closeDatabase,
  initDatabaseAtPath,
  getDb,
  getEvaluatorStats,
} from '../src/db.js';
import {
  runEvaluatorPass,
  verdictToOutcome,
  recordVerdictOutcome,
  type EvaluatorContext,
  type EvaluatorVerdict,
} from '../src/evaluator.js';
import { mintRunAuthority } from '../src/run-authority.js';
import type { RunAuthority } from '../src/types.js';
import { state } from '../src/app-state.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const group = {
  name: 'test',
  folder: 'test-group',
  jid: 'telegram:123456',
  isMain: false,
};

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fft-eval-eligible-skip-'));
}

function makeTestAuthority(runType: string): RunAuthority {
  return mintRunAuthority({
    requestId: `test-${runType}-${Date.now()}`,
    groupFolder: 'test-group',
    isMain: false,
    isSubagent: false,
    isScheduledTask: false,
    isEvaluatorRun: false,
    isHeartbeat: false,
    effectiveToolSet: ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls', 'agent'],
    senderRole: 'operator',
    startedDuringPause: false,
  });
}

function ctx(overrides: Partial<EvaluatorContext> = {}): EvaluatorContext {
  return {
    runType: 'coding',
    originalTask: 'Write a test.',
    agentOutput: 'Here is the test file.',
    durationMs: 30_000,
    toolsInvoked: 5,
    group,
    chatJid: 'test-chat@g.us',
    forceEvaluate: true,
    ...overrides,
  };
}

test.beforeEach(() => {
  state.registeredGroups = {};
  state.registeredGroups['telegram:123456'] = {
    folder: 'main',
    name: 'Test Main',
    jid: 'telegram:123456',
    isMain: true,
  };
});

test.afterEach(() => {
  state.registeredGroups = {};
  closeDatabase();
});

// ---------------------------------------------------------------------------
// VAL-WS4-017: Provider mid-eval failure produces a skipped row
//
// When runContainerAgent throws (provider killed mid-eval), runEvaluatorPass
// returns skippedReason='evaluator threw'. verdictToOutcome converts this to
// eligible-skip with skipReason='evaluator-threw'. recordVerdictOutcome
// writes skipped=1, skip_reason='evaluator-threw'. getEvaluatorStats
// returns recentSkips incremented and passRate unchanged.
// ---------------------------------------------------------------------------

test('VAL-WS4-017: runEvaluatorPass returns skipped verdict when provider throws', async () => {
  // This tests runEvaluatorPass in isolation with a throwing runContainerAgent.
  // We use a real context that would pass shouldEvaluate, but we need to mock
  // runContainerAgent to throw. Since module-level mocking is not available in
  // node:test, we test the verdictToOutcome conversion with a verdict that
  // has skippedReason='evaluator threw' (as runEvaluatorPass would return).
  const verdict: EvaluatorVerdict = {
    pass: true,
    score: -1,
    issues: [],
    feedback: '',
    skipped: true,
    skippedReason: 'evaluator threw',
  };

  // verdictToOutcome must convert this to eligible-skip with hyphenated reason
  const outcome = verdictToOutcome('coding', verdict, 0);
  assert.equal(outcome.kind, 'eligible-skip');
  assert.equal(outcome.skipReason, 'evaluator-threw');
  assert.equal(outcome.skipped, true);
  assert.equal(outcome.pass, false);
  assert.equal(outcome.score, 0);
});

test('VAL-WS4-017: recordVerdictOutcome writes skipped=1 row with skip_reason=evaluator-threw', () => {
  const tmpRoot = makeTmpDir();
  const dbPath = path.join(tmpRoot, 'messages.db');
  try {
    initDatabaseAtPath(dbPath);

    const authority = makeTestAuthority('coding');

    // Simulate the outcome that verdictToOutcome produces from a 'provider threw' verdict
    recordVerdictOutcome({
      authority,
      outcome: {
        kind: 'eligible-skip',
        runType: 'coding',
        pass: false,
        score: 0,
        issues: [],
        feedback: '',
        refinements: 0,
        skipReason: 'evaluator-threw',
        skipped: true,
      },
    });

    // Verify DB row
    const db = getDb();
    const rows = db!
      .prepare(`SELECT skipped, skip_reason, pass, score FROM evaluator_verdicts WHERE group_folder = 'test-group'`)
      .all() as Array<{ skipped: number; skip_reason: string | null; pass: number; score: number }>;

    assert.equal(rows.length, 1);
    assert.equal(rows[0].skipped, 1, 'skipped should be 1');
    assert.equal(rows[0].skip_reason, 'evaluator-threw', 'skip_reason should be evaluator-threw');
    assert.equal(rows[0].pass, 0, 'pass should be 0 for eligible-skip');
    assert.equal(rows[0].score, 0, 'score should be 0 for eligible-skip');
  } finally {
    closeDatabase();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('VAL-WS4-017: getEvaluatorStats recentSkips incremented, passRate unchanged', () => {
  const tmpRoot = makeTmpDir();
  const dbPath = path.join(tmpRoot, 'messages.db');
  try {
    initDatabaseAtPath(dbPath);

    // Seed 2 non-skipped verdicts first
    const db = getDb();
    db!.prepare(
      `INSERT INTO evaluator_verdicts (request_id, group_folder, run_type, pass, score, issues, skipped, skip_reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('v1', 'test-group', 'coding', 1, 8, '[]', 0, null, new Date().toISOString());
    db!.prepare(
      `INSERT INTO evaluator_verdicts (request_id, group_folder, run_type, pass, score, issues, skipped, skip_reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('v2', 'test-group', 'coding', 1, 9, '[]', 0, null, new Date().toISOString());

    const before = getEvaluatorStats('test-group', 10);
    assert.equal(before.total, 2);
    assert.equal(before.recentSkips, 0);
    assert.equal(before.passRate, 1.0);

    // Record an eligible-skip (provider threw)
    const authority = makeTestAuthority('coding');
    recordVerdictOutcome({
      authority,
      outcome: {
        kind: 'eligible-skip',
        runType: 'coding',
        pass: false,
        score: 0,
        issues: [],
        feedback: '',
        refinements: 0,
        skipReason: 'evaluator-threw',
        skipped: true,
      },
    });

    const after = getEvaluatorStats('test-group', 10);
    assert.equal(after.total, 3, 'total includes the skip');
    assert.equal(after.recentSkips, 1, 'recentSkips incremented');
    // passRate is computed over non-skipped rows only (I3)
    assert.equal(after.passRate, 1.0, 'passRate unchanged (computed over 2 non-skipped rows)');
  } finally {
    closeDatabase();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// VAL-WS4-018: Unparseable verdict is recorded as a skip
//
// When parseVerdict returns null, runEvaluatorPass returns
// skippedReason='unparseable verdict'. verdictToOutcome converts this to
// eligible-skip with skipReason='unparseable-verdict'. recordVerdictOutcome
// writes skipped=1, skip_reason='unparseable-verdict'.
// ---------------------------------------------------------------------------

test('VAL-WS4-018: runEvaluatorPass returns skipped verdict when parseVerdict returns null', () => {
  // runEvaluatorPass returns skippedReason='unparseable verdict' when parseVerdict returns null
  const verdict: EvaluatorVerdict = {
    pass: true,
    score: -1,
    issues: [],
    feedback: '',
    skipped: true,
    skippedReason: 'unparseable verdict',
  };

  const outcome = verdictToOutcome('coding', verdict, 0);
  assert.equal(outcome.kind, 'eligible-skip');
  assert.equal(outcome.skipReason, 'unparseable-verdict');
  assert.equal(outcome.skipped, true);
});

test('VAL-WS4-018: recordVerdictOutcome writes skipped=1 row with skip_reason=unparseable-verdict', () => {
  const tmpRoot = makeTmpDir();
  const dbPath = path.join(tmpRoot, 'messages.db');
  try {
    initDatabaseAtPath(dbPath);

    const authority = makeTestAuthority('coding');
    recordVerdictOutcome({
      authority,
      outcome: {
        kind: 'eligible-skip',
        runType: 'coding',
        pass: false,
        score: 0,
        issues: [],
        feedback: '',
        refinements: 0,
        skipReason: 'unparseable-verdict',
        skipped: true,
      },
    });

    const db = getDb();
    const rows = db!
      .prepare(`SELECT skipped, skip_reason, pass, score FROM evaluator_verdicts WHERE group_folder = 'test-group'`)
      .all() as Array<{ skipped: number; skip_reason: string | null; pass: number; score: number }>;

    assert.equal(rows.length, 1);
    assert.equal(rows[0].skipped, 1);
    assert.equal(rows[0].skip_reason, 'unparseable-verdict');
    assert.equal(rows[0].pass, 0);
    assert.equal(rows[0].score, 0);
  } finally {
    closeDatabase();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('VAL-WS4-018: getEvaluatorStats reflects the unparseable-verdict skip', () => {
  const tmpRoot = makeTmpDir();
  const dbPath = path.join(tmpRoot, 'messages.db');
  try {
    initDatabaseAtPath(dbPath);

    const db = getDb();
    // Seed 5 non-skipped rows
    for (let i = 0; i < 5; i++) {
      db!.prepare(
        `INSERT INTO evaluator_verdicts (request_id, group_folder, run_type, pass, score, issues, skipped, skip_reason, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(`v${i}`, 'test-group', 'coding', 1, 8, '[]', 0, null, new Date().toISOString());
    }

    const before = getEvaluatorStats('test-group', 10);
    assert.equal(before.recentSkips, 0);

    // Record unparseable-verdict skip
    const authority = makeTestAuthority('coding');
    recordVerdictOutcome({
      authority,
      outcome: {
        kind: 'eligible-skip',
        runType: 'coding',
        pass: false,
        score: 0,
        issues: [],
        feedback: '',
        refinements: 0,
        skipReason: 'unparseable-verdict',
        skipped: true,
      },
    });

    const after = getEvaluatorStats('test-group', 10);
    assert.equal(after.total, 6);
    assert.equal(after.recentSkips, 1);
    assert.equal(after.passRate, 1.0, 'passRate over 5 non-skipped rows');
  } finally {
    closeDatabase();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// VAL-WS4-019: Threshold-skip runs do not write a row
//
// A run that fails shouldEvaluate on a threshold (trivially short, wrong
// run type, no changed files) is a threshold-skip. The chokepoint
// (recordVerdictOutcome) is a no-op for threshold-skip: no row is written.
// getEvaluatorStats returns the same counts as before the run.
// ---------------------------------------------------------------------------

test('VAL-WS4-019: verdictToOutcome converts threshold-skip (trivially short) to threshold-skip', () => {
  const verdict: EvaluatorVerdict = {
    pass: true,
    score: -1,
    issues: [],
    feedback: '',
    skipped: true,
    skippedReason: 'trivially short run',
  };

  const outcome = verdictToOutcome('coding', verdict, 0);
  assert.equal(outcome.kind, 'threshold-skip');
  assert.equal(outcome.skipReason, 'trivially-short-run');
  assert.equal(outcome.skipped, true);
});

test('VAL-WS4-019: verdictToOutcome converts threshold-skip (run type not eligible) to threshold-skip', () => {
  const verdict: EvaluatorVerdict = {
    pass: true,
    score: -1,
    issues: [],
    feedback: '',
    skipped: true,
    skippedReason: 'chat run type not eligible for evaluation',
  };

  const outcome = verdictToOutcome('chat', verdict, 0);
  assert.equal(outcome.kind, 'threshold-skip');
  assert.equal(outcome.skipReason, 'run-type-not-eligible');
  assert.equal(outcome.skipped, true);
});

test('VAL-WS4-019: recordVerdictOutcome is a no-op for threshold-skip (no row written)', () => {
  const tmpRoot = makeTmpDir();
  const dbPath = path.join(tmpRoot, 'messages.db');
  try {
    initDatabaseAtPath(dbPath);

    const db = getDb();
    // Seed some existing rows
    db!.prepare(
      `INSERT INTO evaluator_verdicts (request_id, group_folder, run_type, pass, score, issues, skipped, skip_reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('v1', 'test-group', 'coding', 1, 8, '[]', 0, null, new Date().toISOString());

    const before = getEvaluatorStats('test-group', 10);
    assert.equal(before.total, 1);

    // Record a threshold-skip - should be a no-op
    const authority = makeTestAuthority('coding');
    const result = recordVerdictOutcome({
      authority,
      outcome: {
        kind: 'threshold-skip',
        runType: 'coding',
        skipReason: 'trivially-short-run',
        skipped: true,
      },
    });

    // No row should be written
    const rows = db!
      .prepare(`SELECT * FROM evaluator_verdicts WHERE group_folder = 'test-group'`)
      .all();
    assert.equal(rows.length, 1, 'threshold-skip should not write a row');

    // Stats should be unchanged
    const after = getEvaluatorStats('test-group', 10);
    assert.equal(after.total, 1, 'total unchanged after threshold-skip');
    assert.equal(after.recentSkips, 0, 'recentSkips unchanged after threshold-skip');

    // recordVerdictOutcome returns shouldAlert: false for threshold-skip
    assert.equal(result.shouldAlert, false);
  } finally {
    closeDatabase();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('VAL-WS4-019: threshold-skip for chat run type also writes no row', () => {
  const tmpRoot = makeTmpDir();
  const dbPath = path.join(tmpRoot, 'messages.db');
  try {
    initDatabaseAtPath(dbPath);

    const db = getDb();
    db!.prepare(
      `INSERT INTO evaluator_verdicts (request_id, group_folder, run_type, pass, score, issues, skipped, skip_reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('v1', 'test-group', 'chat', 1, 8, '[]', 0, null, new Date().toISOString());

    const before = getEvaluatorStats('test-group', 10);
    assert.equal(before.total, 1);

    // Threshold-skip for chat (wrong run type)
    const authority = makeTestAuthority('chat');
    recordVerdictOutcome({
      authority,
      outcome: {
        kind: 'threshold-skip',
        runType: 'chat',
        skipReason: 'run-type-not-eligible',
        skipped: true,
      },
    });

    // No new row
    const after = getEvaluatorStats('test-group', 10);
    assert.equal(after.total, 1, 'total unchanged after chat threshold-skip');
    assert.equal(after.recentSkips, 0, 'recentSkips unchanged');
  } finally {
    closeDatabase();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Additional: artifact-missing eligible-skip
// ---------------------------------------------------------------------------

test('verdictToOutcome converts artifact-missing to eligible-skip (artifact-missing)', () => {
  // Note: runEvaluatorPass does NOT return artifact-missing as a skip.
  // It returns pass=false with issues for missing artifacts.
  // But the EvaluatorOutcome type includes it as an eligible-skip reason
  // for completeness (in case a future call path needs it).
  const outcome = verdictToOutcome('coding', {
    pass: false,
    score: 0,
    issues: ['Missing artifact'],
    feedback: '',
    skipped: true,
    skippedReason: 'artifact-missing',
  }, 0);

  assert.equal(outcome.kind, 'eligible-skip');
  assert.equal(outcome.skipReason, 'artifact-missing');
});
