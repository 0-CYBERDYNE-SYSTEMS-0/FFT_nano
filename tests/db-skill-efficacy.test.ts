import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  closeDatabase,
  getDb,
  getSkillEfficacy,
  initDatabaseAtPath,
  recordEvaluatorVerdict,
  recordLearningInjection,
} from '../src/db.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fft-skill-efficacy-'));
}

// ---------------------------------------------------------------------------
// VAL-WS5-006: getSkillEfficacy returns nothing under the sample floor
// ---------------------------------------------------------------------------

test('VAL-WS5-006: getSkillEfficacy returns no efficacy row for a skill with fewer than 5 matching rows', () => {
  const tmpRoot = makeTmpDir();
  const dbPath = path.join(tmpRoot, 'messages.db');
  try {
    initDatabaseAtPath(dbPath);

    // Seed 4 learning_injections rows for skill 'test-skill' with different request_ids
    // and corresponding evaluator_verdicts
    const requestIds = ['req-a', 'req-b', 'req-c', 'req-d'];
    for (const reqId of requestIds) {
      recordLearningInjection({
        requestId: reqId,
        groupFolder: 'group-A',
        kind: 'skill',
        item: 'test-skill',
      });
      recordEvaluatorVerdict({
        requestId: reqId,
        groupFolder: 'group-A',
        runType: 'coding',
        pass: true,
        score: 8,
        issues: [],
      });
    }

    const result = getSkillEfficacy('group-A');
    assert.equal(
      result.has('test-skill'),
      false,
      'Skill with 4 rows should not have an efficacy entry (under sample floor of 5)',
    );
  } finally {
    closeDatabase();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// VAL-WS5-007: getSkillEfficacy returns correct rates above the floor
// ---------------------------------------------------------------------------

test('VAL-WS5-007: getSkillEfficacy returns runsWith:8, passRateWith:0.625, groupBaseline for a skill with 8 rows and 5 passes', () => {
  const tmpRoot = makeTmpDir();
  const dbPath = path.join(tmpRoot, 'messages.db');
  try {
    initDatabaseAtPath(dbPath);

    // Seed 8 rows: 5 passing (pass=1), 3 failing (pass=0)
    const passFlags = [1, 1, 1, 1, 1, 0, 0, 0];
    for (let i = 0; i < 8; i++) {
      const reqId = `req-${i}`;
      recordLearningInjection({
        requestId: reqId,
        groupFolder: 'group-B',
        kind: 'skill',
        item: 'skill-X',
      });
      recordEvaluatorVerdict({
        requestId: reqId,
        groupFolder: 'group-B',
        runType: 'coding',
        pass: passFlags[i] === 1,
        score: passFlags[i] === 1 ? 8 : 3,
        issues: [],
      });
    }

    const result = getSkillEfficacy('group-B');
    assert.equal(
      result.has('skill-X'),
      true,
      'Skill with 8 rows should have an efficacy entry (above sample floor of 5)',
    );

    const efficacy = result.get('skill-X')!;
    assert.equal(
      efficacy.runsWith,
      8,
      `runsWith should be 8, got ${efficacy.runsWith}`,
    );
    assert.equal(
      efficacy.passRateWith,
      5 / 8,
      `passRateWith should be 0.625, got ${efficacy.passRateWith}`,
    );
    // groupBaseline is the overall group passRate: 5 passes / 8 total = 0.625
    assert.equal(
      efficacy.groupBaseline,
      0.625,
      `groupBaseline should be 0.625, got ${efficacy.groupBaseline}`,
    );
  } finally {
    closeDatabase();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('VAL-WS5-007: passRateWith is computed over non-skipped joined rows only (skipped rows excluded from numerator and denominator)', () => {
  const tmpRoot = makeTmpDir();
  const dbPath = path.join(tmpRoot, 'messages.db');
  try {
    initDatabaseAtPath(dbPath);

    // 6 rows: 4 non-skipped passes, 1 non-skipped fail, 1 skipped
    // Expected passRateWith = 4 / 5 = 0.8
    const verdicts = [
      { pass: true, skipped: false },
      { pass: true, skipped: false },
      { pass: true, skipped: false },
      { pass: true, skipped: false },
      { pass: false, skipped: false },
      { pass: true, skipped: true }, // excluded from both numerator and denominator
    ];

    for (let i = 0; i < verdicts.length; i++) {
      const reqId = `req-${i}`;
      recordLearningInjection({
        requestId: reqId,
        groupFolder: 'group-C',
        kind: 'skill',
        item: 'skill-Y',
      });
      recordEvaluatorVerdict({
        requestId: reqId,
        groupFolder: 'group-C',
        runType: 'coding',
        pass: verdicts[i].pass,
        score: 7,
        issues: [],
        skipped: verdicts[i].skipped,
        skipReason: verdicts[i].skipped ? 'evaluator threw' : undefined,
      });
    }

    const result = getSkillEfficacy('group-C');
    assert.equal(result.has('skill-Y'), true, 'Skill with 6 rows (5 non-skipped) should have an entry');

    const efficacy = result.get('skill-Y')!;
    assert.equal(efficacy.runsWith, 5, `runsWith should be 5 (non-skipped only), got ${efficacy.runsWith}`);
    assert.equal(
      efficacy.passRateWith,
      0.8,
      `passRateWith should be 4/5=0.8, got ${efficacy.passRateWith}`,
    );
  } finally {
    closeDatabase();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('VAL-WS5-007: groupBaseline comes from getEvaluatorStats(groupFolder).passRate — uses overall group passRate, not skill-subset passRate', () => {
  const tmpRoot = makeTmpDir();
  const dbPath = path.join(tmpRoot, 'messages.db');
  try {
    initDatabaseAtPath(dbPath);

    // Seed evaluator verdicts for the group:
    // - 5 for skill-Z: 3 pass, 2 fail  => skill passRate = 0.6
    // - 5 for OTHER skill: 5 pass, 0 fail => other passRate = 1.0
    // Overall group passRate = 8/10 = 0.8
    for (let i = 0; i < 5; i++) {
      recordLearningInjection({
        requestId: `req-sz-${i}`,
        groupFolder: 'group-D',
        kind: 'skill',
        item: 'skill-Z',
      });
      recordEvaluatorVerdict({
        requestId: `req-sz-${i}`,
        groupFolder: 'group-D',
        runType: 'coding',
        pass: i < 3, // first 3 pass, last 2 fail
        score: 7,
        issues: [],
      });
    }
    for (let i = 0; i < 5; i++) {
      recordLearningInjection({
        requestId: `req-ot-${i}`,
        groupFolder: 'group-D',
        kind: 'skill',
        item: 'other-skill',
      });
      recordEvaluatorVerdict({
        requestId: `req-ot-${i}`,
        groupFolder: 'group-D',
        runType: 'coding',
        pass: true, // all 5 pass
        score: 8,
        issues: [],
      });
    }

    const result = getSkillEfficacy('group-D');
    const skillZ = result.get('skill-Z')!;
    const otherSkill = result.get('other-skill')!;

    // groupBaseline should be the same for both skills: overall group passRate = 8/10 = 0.8
    assert.equal(
      skillZ.groupBaseline,
      0.8,
      `skill-Z groupBaseline should be 0.8, got ${skillZ.groupBaseline}`,
    );
    assert.equal(
      otherSkill.groupBaseline,
      0.8,
      `other-skill groupBaseline should be 0.8, got ${otherSkill.groupBaseline}`,
    );
  } finally {
    closeDatabase();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// VAL-WS5-008: getSkillEfficacy is per-group (group A's rows not visible to group B)
// ---------------------------------------------------------------------------

test('VAL-WS5-008: getSkillEfficacy is per-group — group A rows are not visible to group B call', () => {
  const tmpRoot = makeTmpDir();
  const dbPath = path.join(tmpRoot, 'messages.db');
  try {
    initDatabaseAtPath(dbPath);

    // Seed 6 rows for skill-X in group-A with pass rate 1.0
    for (let i = 0; i < 6; i++) {
      recordLearningInjection({
        requestId: `req-ga-${i}`,
        groupFolder: 'group-A',
        kind: 'skill',
        item: 'skill-X',
      });
      recordEvaluatorVerdict({
        requestId: `req-ga-${i}`,
        groupFolder: 'group-A',
        runType: 'coding',
        pass: true,
        score: 9,
        issues: [],
      });
    }

    // Seed 6 rows for skill-X in group-B with pass rate 0.5
    for (let i = 0; i < 6; i++) {
      recordLearningInjection({
        requestId: `req-gb-${i}`,
        groupFolder: 'group-B',
        kind: 'skill',
        item: 'skill-X',
      });
      recordEvaluatorVerdict({
        requestId: `req-gb-${i}`,
        groupFolder: 'group-B',
        runType: 'coding',
        pass: i < 3, // first 3 pass, last 3 fail
        score: 7,
        issues: [],
      });
    }

    const resultA = getSkillEfficacy('group-A');
    const resultB = getSkillEfficacy('group-B');

    // group-A: all 6 pass -> passRateWith = 1.0
    assert.equal(resultA.has('skill-X'), true, 'group-A should have skill-X');
    assert.equal(resultA.get('skill-X')!.passRateWith, 1.0);
    assert.equal(resultA.get('skill-X')!.runsWith, 6);

    // group-B: 3 of 6 pass -> passRateWith = 0.5
    assert.equal(resultB.has('skill-X'), true, 'group-B should have skill-X');
    assert.equal(resultB.get('skill-X')!.passRateWith, 0.5);
    assert.equal(resultB.get('skill-X')!.runsWith, 6);

    // groupBaseline values reflect each group's own evaluator stats
    assert.equal(
      resultA.get('skill-X')!.groupBaseline,
      1.0,
      'group-A baseline should be 1.0 (all passing)',
    );
    assert.equal(
      resultB.get('skill-X')!.groupBaseline,
      0.5,
      'group-B baseline should be 0.5 (3/6 passing)',
    );
  } finally {
    closeDatabase();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// VAL-WS5-009: getSkillEfficacy is a read-only helper
// ---------------------------------------------------------------------------

test('VAL-WS5-009: getSkillEfficacy does not mutate learning_injections table', () => {
  const tmpRoot = makeTmpDir();
  const dbPath = path.join(tmpRoot, 'messages.db');
  try {
    initDatabaseAtPath(dbPath);

    // Seed 6 rows
    for (let i = 0; i < 6; i++) {
      recordLearningInjection({
        requestId: `req-ro-${i}`,
        groupFolder: 'group-RO',
        kind: 'skill',
        item: 'skill-RO',
      });
      recordEvaluatorVerdict({
        requestId: `req-ro-${i}`,
        groupFolder: 'group-RO',
        runType: 'coding',
        pass: true,
        score: 8,
        issues: [],
      });
    }

    const db = getDb()!;
    const beforeCount = (
      db
        .prepare(`SELECT COUNT(*) as c FROM learning_injections`)
        .get() as { c: number }
    ).c;

    // Call getSkillEfficacy
    getSkillEfficacy('group-RO');

    const afterCount = (
      db
        .prepare(`SELECT COUNT(*) as c FROM learning_injections`)
        .get() as { c: number }
    ).c;

    assert.equal(
      afterCount,
      beforeCount,
      `learning_injections row count should be unchanged: before=${beforeCount}, after=${afterCount}`,
    );
  } finally {
    closeDatabase();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('VAL-WS5-009: getSkillEfficacy does not mutate evaluator_verdicts table', () => {
  const tmpRoot = makeTmpDir();
  const dbPath = path.join(tmpRoot, 'messages.db');
  try {
    initDatabaseAtPath(dbPath);

    for (let i = 0; i < 6; i++) {
      recordLearningInjection({
        requestId: `req-ro2-${i}`,
        groupFolder: 'group-RO2',
        kind: 'skill',
        item: 'skill-RO2',
      });
      recordEvaluatorVerdict({
        requestId: `req-ro2-${i}`,
        groupFolder: 'group-RO2',
        runType: 'coding',
        pass: true,
        score: 8,
        issues: [],
      });
    }

    const db = getDb()!;
    const beforeCount = (
      db
        .prepare(`SELECT COUNT(*) as c FROM evaluator_verdicts`)
        .get() as { c: number }
    ).c;

    // Call getSkillEfficacy multiple times
    getSkillEfficacy('group-RO2');
    getSkillEfficacy('group-RO2');

    const afterCount = (
      db
        .prepare(`SELECT COUNT(*) as c FROM evaluator_verdicts`)
        .get() as { c: number }
    ).c;

    assert.equal(
      afterCount,
      beforeCount,
      `evaluator_verdicts row count should be unchanged: before=${beforeCount}, after=${afterCount}`,
    );
  } finally {
    closeDatabase();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// VAL-WS5-007 / VAL-INV-I3-002: efficacy join reads pass from column, not JSONL prose
// (pass=1, score=7 with misleading 'failed' issues text returns passRateWith 1.0)
// ---------------------------------------------------------------------------

test('VAL-WS5-007 + VAL-INV-I3-002: getSkillEfficacy reads pass from the pass column, not from JSONL prose — misleading issues text does not affect passRateWith', () => {
  const tmpRoot = makeTmpDir();
  const dbPath = path.join(tmpRoot, 'messages.db');
  try {
    initDatabaseAtPath(dbPath);

    // 5 rows: all have pass=1 (ground truth), but issues text contains 'failed'/'error'
    for (let i = 0; i < 5; i++) {
      const reqId = `req-truth-${i}`;
      recordLearningInjection({
        requestId: reqId,
        groupFolder: 'group-truth',
        kind: 'skill',
        item: 'skill-truth',
      });
      // The JSON issues contain misleading prose, but pass=1 is the ground truth
      recordEvaluatorVerdict({
        requestId: reqId,
        groupFolder: 'group-truth',
        runType: 'coding',
        pass: true, // ground truth from artifact verification (I3)
        score: 7,
        issues: ['critical: this approach completely failed', 'error: the implementation was wrong'],
      });
    }

    const result = getSkillEfficacy('group-truth');
    const efficacy = result.get('skill-truth')!;

    // All 5 rows have pass=1, so passRateWith should be 1.0
    // (not influenced by the misleading 'failed'/'error' text in issues)
    assert.equal(
      efficacy.passRateWith,
      1.0,
      `passRateWith should be 1.0 (ground truth pass=1), got ${efficacy.passRateWith}`,
    );
    assert.equal(efficacy.runsWith, 5);
  } finally {
    closeDatabase();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
