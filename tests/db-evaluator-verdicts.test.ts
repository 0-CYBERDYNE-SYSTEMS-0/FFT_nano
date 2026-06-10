import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';

import {
  closeDatabase,
  getEvaluatorStats,
  initDatabaseAtPath,
  recordEvaluatorVerdict,
} from '../src/db.js';

test('evaluator verdicts persist and produce rolling pass-rate + recent issues', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-eval-verdicts-'));
  const dbPath = path.join(tmpRoot, 'messages.db');
  try {
    initDatabaseAtPath(dbPath);

    // No history → empty stats.
    const empty = getEvaluatorStats('main');
    assert.equal(empty.total, 0);
    assert.equal(empty.passRate, 0);
    assert.deepEqual(empty.recentIssues, []);

    recordEvaluatorVerdict({
      groupFolder: 'main',
      runType: 'coding',
      pass: false,
      score: 3,
      issues: ['tests failed', 'missing error handling'],
      refinements: 1,
    });
    recordEvaluatorVerdict({
      groupFolder: 'main',
      runType: 'coding',
      pass: true,
      score: 9,
      issues: [],
    });
    // A different group must not bleed into main's stats.
    recordEvaluatorVerdict({
      groupFolder: 'other',
      runType: 'subagent',
      pass: false,
      score: 1,
      issues: ['unrelated'],
    });

    const stats = getEvaluatorStats('main');
    assert.equal(stats.total, 2);
    assert.equal(stats.passes, 1);
    assert.equal(stats.passRate, 0.5);
    assert.ok(stats.recentIssues.includes('tests failed'));
    assert.ok(!stats.recentIssues.includes('unrelated'));
  } finally {
    closeDatabase();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('evaluator stats survive a restart (persisted to disk)', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-eval-verdicts-'));
  const dbPath = path.join(tmpRoot, 'messages.db');
  try {
    initDatabaseAtPath(dbPath);
    recordEvaluatorVerdict({
      groupFolder: 'main',
      runType: 'coding',
      pass: true,
      score: 8,
      issues: [],
    });
    closeDatabase();

    initDatabaseAtPath(dbPath);
    const stats = getEvaluatorStats('main');
    assert.equal(stats.total, 1);
    assert.equal(stats.passes, 1);
  } finally {
    closeDatabase();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('getEvaluatorStats ranks failing-run issues above passing-run notes', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-eval-verdicts-'));
  const dbPath = path.join(tmpRoot, 'messages.db');
  try {
    initDatabaseAtPath(dbPath);
    recordEvaluatorVerdict({
      groupFolder: 'main',
      runType: 'coding',
      pass: true,
      score: 8,
      issues: ['cosmetic-note'],
    });
    await sleep(5);
    recordEvaluatorVerdict({
      groupFolder: 'main',
      runType: 'coding',
      pass: false,
      score: 3,
      issues: ['blocking-bug'],
    });

    const stats = getEvaluatorStats('main');
    assert.equal(
      stats.recentIssues[0],
      'blocking-bug',
      'a failing-run issue must outrank a recent passing-run note',
    );
  } finally {
    closeDatabase();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('getEvaluatorStats decays a stale one-off issue out of the set', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-eval-verdicts-'));
  const dbPath = path.join(tmpRoot, 'messages.db');
  try {
    initDatabaseAtPath(dbPath);
    // Old, single passing-run note — should decay below the score floor.
    recordEvaluatorVerdict({
      groupFolder: 'main',
      runType: 'coding',
      pass: true,
      score: 8,
      issues: ['stale-passing-note'],
    });
    await sleep(5);
    // Many newer failing verdicts with a persistent issue.
    for (let i = 0; i < 14; i += 1) {
      recordEvaluatorVerdict({
        groupFolder: 'main',
        runType: 'coding',
        pass: false,
        score: 3,
        issues: ['real-recurring-bug'],
      });
      await sleep(2);
    }

    const stats = getEvaluatorStats('main', 20);
    assert.ok(
      stats.recentIssues.includes('real-recurring-bug'),
      'a persistently recurring failure must be surfaced',
    );
    assert.ok(
      !stats.recentIssues.includes('stale-passing-note'),
      'an old one-off passing note must decay out',
    );
  } finally {
    closeDatabase();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('VAL-WS4-008: EvaluatorStats carries recentSkips', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-eval-verdicts-'));
  const dbPath = path.join(tmpRoot, 'messages.db');
  try {
    initDatabaseAtPath(dbPath);

    // Empty stats should have recentSkips: 0
    const empty = getEvaluatorStats('main');
    assert.equal(empty.recentSkips, 0, 'recentSkips should be 0 for empty stats');

    // Insert some non-skipped verdicts
    recordEvaluatorVerdict({
      groupFolder: 'main',
      runType: 'coding',
      pass: true,
      score: 8,
      issues: [],
    });
    recordEvaluatorVerdict({
      groupFolder: 'main',
      runType: 'coding',
      pass: false,
      score: 3,
      issues: [],
    });

    // Verify recentSkips: 0 for non-skipped rows
    const stats1 = getEvaluatorStats('main');
    assert.equal(stats1.recentSkips, 0, 'recentSkips should be 0 for non-skipped rows');
    assert.equal(stats1.total, 2);

    // Insert skipped rows directly via SQL to test recentSkips count
    const db2 = new Database(dbPath);
    db2.prepare(
      `INSERT INTO evaluator_verdicts (request_id, group_folder, run_type, pass, score, issues, skipped, skip_reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('skipped-1', 'main', 'coding', 0, 0, '[]', 1, 'evaluator-threw', new Date().toISOString());
    db2.prepare(
      `INSERT INTO evaluator_verdicts (request_id, group_folder, run_type, pass, score, issues, skipped, skip_reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('skipped-2', 'main', 'coding', 0, 0, '[]', 1, 'unparseable-verdict', new Date().toISOString());
    db2.close();

    // recentSkips should now be 2
    const stats2 = getEvaluatorStats('main', 10);
    assert.equal(stats2.recentSkips, 2, 'recentSkips should count skipped rows in window');
    assert.equal(stats2.total, 4, 'total includes all rows');
  } finally {
    closeDatabase();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('VAL-WS4-009: passRate excludes skipped rows', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-eval-verdicts-'));
  const dbPath = path.join(tmpRoot, 'messages.db');
  try {
    initDatabaseAtPath(dbPath);

    // Insert 2 passing non-skipped and 1 failing non-skipped
    recordEvaluatorVerdict({
      groupFolder: 'main',
      runType: 'coding',
      pass: true,
      score: 9,
      issues: [],
    });
    recordEvaluatorVerdict({
      groupFolder: 'main',
      runType: 'coding',
      pass: true,
      score: 8,
      issues: [],
    });
    recordEvaluatorVerdict({
      groupFolder: 'main',
      runType: 'coding',
      pass: false,
      score: 3,
      issues: [],
    });

    // Insert skipped rows directly
    const db2 = new Database(dbPath);
    db2.prepare(
      `INSERT INTO evaluator_verdicts (request_id, group_folder, run_type, pass, score, issues, skipped, skip_reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('skip-1', 'main', 'coding', 0, 0, '[]', 1, 'evaluator-threw', new Date().toISOString());
    db2.prepare(
      `INSERT INTO evaluator_verdicts (request_id, group_folder, run_type, pass, score, issues, skipped, skip_reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('skip-2', 'main', 'coding', 0, 0, '[]', 1, 'unparseable-verdict', new Date().toISOString());
    db2.close();

    const stats = getEvaluatorStats('main', 20);
    // total = 5 (3 non-skipped + 2 skipped)
    // totalNonSkipped = 3
    // passes (non-skipped pass=1) = 2
    // passRate = 2/3
    assert.equal(stats.total, 5, 'total includes all rows');
    assert.equal(stats.recentSkips, 2, 'recentSkips should be 2');
    assert.equal(stats.passes, 2, 'passes counts non-skipped pass=1 rows');
    assert.equal(stats.passRate, 2 / 3, 'passRate is computed over non-skipped rows only');
  } finally {
    closeDatabase();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('VAL-WS4-009: all-skipped window returns passRate=0 and recentSkips=N', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-eval-verdicts-'));
  const dbPath = path.join(tmpRoot, 'messages.db');
  try {
    initDatabaseAtPath(dbPath);

    // Insert all skipped rows
    const db2 = new Database(dbPath);
    for (let i = 0; i < 5; i++) {
      db2.prepare(
        `INSERT INTO evaluator_verdicts (request_id, group_folder, run_type, pass, score, issues, skipped, skip_reason, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(`skip-${i}`, 'main', 'coding', 0, 0, '[]', 1, 'evaluator-threw', new Date().toISOString());
    }
    db2.close();

    const stats = getEvaluatorStats('main', 20);
    assert.equal(stats.total, 5, 'total counts all rows');
    assert.equal(stats.recentSkips, 5, 'recentSkips should be 5');
    assert.equal(stats.passes, 0, 'passes should be 0 when all rows are skipped');
    assert.equal(stats.passRate, 0, 'passRate should be 0 when totalNonSkipped is 0');
  } finally {
    closeDatabase();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('VAL-INV-I3-002: pass is read from column, not from issues prose', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-eval-verdicts-'));
  const dbPath = path.join(tmpRoot, 'messages.db');
  try {
    initDatabaseAtPath(dbPath);

    // Insert a row with pass=1, score=7 but misleading issues text
    const db2 = new Database(dbPath);
    db2.prepare(
      `INSERT INTO evaluator_verdicts (request_id, group_folder, run_type, pass, score, issues, skipped, skip_reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'misleading-prose',
      'main',
      'coding',
      1, // pass = 1 (verdict says pass)
      7, // score = 7
      JSON.stringify(['failed', 'tests broken']), // misleading prose
      0,
      null,
      new Date().toISOString(),
    );
    db2.close();

    // getEvaluatorStats should return pass=1 from the column
    const stats = getEvaluatorStats('main');
    assert.equal(stats.passes, 1, 'passes should be 1 from column, not from issues prose');
    assert.equal(stats.passRate, 1, 'passRate should be 1.0 since pass=1');
    assert.ok(stats.recentIssues.includes('failed'), 'issues text is still captured correctly');
  } finally {
    closeDatabase();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
