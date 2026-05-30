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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sm-idle-'));
}

// Seed lastRunAt far enough in the past that the interval is satisfied, so the
// only remaining gate under test is the idle requirement.
function seedStaleRun(skillsDir: string, now: Date): void {
  const state = loadSkillManagerState(skillsDir);
  state.lastRunAt = new Date(now.getTime() - 200 * 60 * 60 * 1000).toISOString();
  saveSkillManagerState(skillsDir, state);
}

test('idle gate blocks the curator when there was recent inbound activity', () => {
  const skillsDir = tmpSkillsDir();
  try {
    const now = new Date('2026-05-29T12:00:00Z');
    seedStaleRun(skillsDir, now);
    // Inbound 30 minutes ago — inside the 2h idle window → blocked.
    const recentInbound = now.getTime() - 30 * 60 * 1000;
    assert.equal(
      shouldRunSkillManager(skillsDir, baseConfig(), now, recentInbound),
      false,
    );
  } finally {
    fs.rmSync(skillsDir, { recursive: true, force: true });
  }
});

test('idle gate allows the curator once the host has been idle long enough', () => {
  const skillsDir = tmpSkillsDir();
  try {
    const now = new Date('2026-05-29T12:00:00Z');
    seedStaleRun(skillsDir, now);
    // Inbound 3 hours ago — past the 2h idle window → allowed.
    const oldInbound = now.getTime() - 3 * 60 * 60 * 1000;
    assert.equal(
      shouldRunSkillManager(skillsDir, baseConfig(), now, oldInbound),
      true,
    );
  } finally {
    fs.rmSync(skillsDir, { recursive: true, force: true });
  }
});

test('idle gate is a no-op when lastInboundAt is unset', () => {
  const skillsDir = tmpSkillsDir();
  try {
    const now = new Date('2026-05-29T12:00:00Z');
    seedStaleRun(skillsDir, now);
    assert.equal(shouldRunSkillManager(skillsDir, baseConfig(), now), true);
  } finally {
    fs.rmSync(skillsDir, { recursive: true, force: true });
  }
});

test('minIdleHours=0 disables the idle gate entirely', () => {
  const skillsDir = tmpSkillsDir();
  try {
    const now = new Date('2026-05-29T12:00:00Z');
    seedStaleRun(skillsDir, now);
    const recentInbound = now.getTime() - 60 * 1000;
    assert.equal(
      shouldRunSkillManager(
        skillsDir,
        baseConfig({ minIdleHours: 0 }),
        now,
        recentInbound,
      ),
      true,
    );
  } finally {
    fs.rmSync(skillsDir, { recursive: true, force: true });
  }
});
