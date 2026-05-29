import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'fs';
import os from 'os';
import path from 'path';

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
