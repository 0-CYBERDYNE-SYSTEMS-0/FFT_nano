import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import test from 'node:test';

import { ensureMainWorkspaceBootstrap } from '../src/workspace-bootstrap.ts';

function makeTmpWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fft-nano-workspace-'));
}

function readText(filePath: string): string {
  return fs.readFileSync(filePath, 'utf-8');
}

test('fresh workspace seeds core files, BOOTSTRAP.md, and state bootstrapSeededAt', () => {
  const workspaceDir = makeTmpWorkspace();
  const state = ensureMainWorkspaceBootstrap({
    workspaceDir,
    now: () => new Date('2026-02-17T10:00:00.000Z'),
  });

  assert.ok(fs.existsSync(path.join(workspaceDir, 'AGENTS.md')));
  assert.ok(fs.existsSync(path.join(workspaceDir, 'USER.md')));
  assert.ok(fs.existsSync(path.join(workspaceDir, 'IDENTITY.md')));
  assert.ok(fs.existsSync(path.join(workspaceDir, 'MEMORY.md')));
  assert.ok(fs.existsSync(path.join(workspaceDir, 'BOOTSTRAP.md')));
  assert.equal(state.bootstrapSeededAt, '2026-02-17T10:00:00.000Z');
  assert.equal(state.onboardingCompletedAt, undefined);
});

test('legacy/onboarded workspace does not recreate BOOTSTRAP.md and marks onboarding complete', () => {
  const workspaceDir = makeTmpWorkspace();
  fs.mkdirSync(workspaceDir, { recursive: true });
  fs.writeFileSync(path.join(workspaceDir, 'USER.md'), '# USER\n\nPrimary operator: Alex.\n');
  fs.writeFileSync(path.join(workspaceDir, 'IDENTITY.md'), '# IDENTITY\n\nName: AlexBot\n');

  const state = ensureMainWorkspaceBootstrap({
    workspaceDir,
    now: () => new Date('2026-02-17T11:00:00.000Z'),
  });

  assert.equal(fs.existsSync(path.join(workspaceDir, 'BOOTSTRAP.md')), false);
  assert.equal(state.onboardingCompletedAt, '2026-02-17T11:00:00.000Z');
});

test('when onboarding is completed and BOOTSTRAP.md removed, reruns do not recreate it', () => {
  const workspaceDir = makeTmpWorkspace();
  ensureMainWorkspaceBootstrap({
    workspaceDir,
    now: () => new Date('2026-02-17T09:00:00.000Z'),
  });
  const bootstrapPath = path.join(workspaceDir, 'BOOTSTRAP.md');
  assert.ok(fs.existsSync(bootstrapPath));
  fs.unlinkSync(bootstrapPath);

  const state = ensureMainWorkspaceBootstrap({
    workspaceDir,
    now: () => new Date('2026-02-17T12:00:00.000Z'),
  });
  assert.equal(state.onboardingCompletedAt, '2026-02-17T12:00:00.000Z');
  assert.equal(fs.existsSync(bootstrapPath), false);

  const state2 = ensureMainWorkspaceBootstrap({
    workspaceDir,
    now: () => new Date('2026-02-17T13:00:00.000Z'),
  });
  assert.equal(fs.existsSync(bootstrapPath), false);
  assert.equal(state2.onboardingCompletedAt, '2026-02-17T12:00:00.000Z');
});

test('seeded USER template is generic and contains no install-specific personal info', () => {
  const workspaceDir = makeTmpWorkspace();
  ensureMainWorkspaceBootstrap({
    workspaceDir,
    now: () => new Date('2026-02-17T08:00:00.000Z'),
  });
  const userBody = readText(path.join(workspaceDir, 'USER.md'));

  assert.match(userBody, /\[set during onboarding\]/);
  assert.ok(!/scrim|wiggins/i.test(userBody));
});
