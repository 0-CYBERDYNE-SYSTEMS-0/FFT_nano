import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  shouldRunSkillManager,
  saveSkillManagerState,
  loadSkillManagerState,
  type SkillManagerConfig,
} from '../src/skill-lifecycle.js';
import { state } from '../src/app-state.js';
import { formatLearningDigest } from '../src/telegram-delivery.js';
import { closeDatabase, initDatabaseAtPath } from '../src/db.js';

function baseConfig(
  overrides: Partial<SkillManagerConfig> = {},
): SkillManagerConfig {
  return {
    enabled: true,
    intervalHours: 168,
    minIdleHours: 2,
    staleAfterDays: 30,
    archiveAfterDays: 90,
    backupEnabled: false,
    backupKeep: 5,
    ...overrides,
  };
}

function tmpSkillsDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'learning-pause-'));
}

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fft-learning-pause-'));
}

// Seed lastRunAt far enough in the past that the interval is satisfied, so the
// only remaining gate under test is the pause requirement.
function seedStaleRun(skillsDir: string, now: Date): void {
  const smState = loadSkillManagerState(skillsDir);
  smState.lastRunAt = new Date(now.getTime() - 200 * 60 * 60 * 1000).toISOString();
  saveSkillManagerState(skillsDir, smState);
}

test.describe('VAL-WS6-018: Curator loop short-circuits on pause', () => {
  test.beforeEach(() => {
    // Ensure learningPaused is false before each test
    state.learningPaused = false;
  });

  test.afterEach(() => {
    state.learningPaused = false;
  });

  test('shouldRunSkillManager returns false when learningPaused is true', () => {
    const skillsDir = tmpSkillsDir();
    try {
      const now = new Date('2026-05-29T12:00:00Z');
      seedStaleRun(skillsDir, now);
      const oldInbound = now.getTime() - 3 * 60 * 60 * 1000; // 3 hours ago

      // Without pause, should return true (idle gate passed)
      assert.equal(
        shouldRunSkillManager(skillsDir, baseConfig(), now, oldInbound),
        true,
        'Without pause, curator should run when idle is satisfied',
      );

      // With pause, should return false
      state.learningPaused = true;
      assert.equal(
        shouldRunSkillManager(skillsDir, baseConfig(), now, oldInbound),
        false,
        'With pause, curator should not run regardless of idle',
      );
    } finally {
      fs.rmSync(skillsDir, { recursive: true, force: true });
    }
  });

  test('shouldRunSkillManager returns true when learningPaused is false', () => {
    const skillsDir = tmpSkillsDir();
    try {
      const now = new Date('2026-05-29T12:00:00Z');
      seedStaleRun(skillsDir, now);
      const oldInbound = now.getTime() - 3 * 60 * 60 * 1000; // 3 hours ago

      // Without pause, should return true
      assert.equal(
        shouldRunSkillManager(skillsDir, baseConfig(), now, oldInbound),
        true,
      );
    } finally {
      fs.rmSync(skillsDir, { recursive: true, force: true });
    }
  });

  test('pause check comes before config.enabled check', () => {
    const skillsDir = tmpSkillsDir();
    try {
      const now = new Date('2026-05-29T12:00:00Z');
      seedStaleRun(skillsDir, now);
      const oldInbound = now.getTime() - 3 * 60 * 60 * 1000;

      // With pause, even if config.enabled is true, should return false
      state.learningPaused = true;
      assert.equal(
        shouldRunSkillManager(skillsDir, baseConfig({ enabled: true }), now, oldInbound),
        false,
        'Pause check should short-circuit before config.enabled',
      );
    } finally {
      fs.rmSync(skillsDir, { recursive: true, force: true });
    }
  });
});

test.describe('VAL-INV-I6-002: /learning summarizes the pause state', () => {
  let tmpRoot: string;
  let dbPath: string;

  test.beforeEach(() => {
    state.learningPaused = false;
    tmpRoot = makeTmpDir();
    dbPath = path.join(tmpRoot, 'messages.db');
    initDatabaseAtPath(dbPath);
  });

  test.afterEach(() => {
    state.learningPaused = false;
    closeDatabase();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  test('formatLearningDigest shows "Learning is active" when paused is false', () => {
    state.learningPaused = false;
    const digest = formatLearningDigest();
    assert.ok(
      digest.includes('Learning is active'),
      `Digest should contain "Learning is active" but got: ${digest}`,
    );
  });

  test('formatLearningDigest shows "Learning is paused" when paused is true', () => {
    state.learningPaused = true;
    const digest = formatLearningDigest();
    assert.ok(
      digest.includes('Learning is paused'),
      `Digest should contain "Learning is paused" but got: ${digest}`,
    );
  });

  test('formatLearningDigest includes pause status line', () => {
    state.learningPaused = false;
    const digest = formatLearningDigest();
    assert.ok(
      digest.includes('Pause status:'),
      `Digest should contain "Pause status:" but got: ${digest}`,
    );
  });
});
