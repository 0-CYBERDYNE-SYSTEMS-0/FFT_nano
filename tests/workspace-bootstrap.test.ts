import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import test from 'node:test';

import {
  ensureMainWorkspaceBootstrap,
  getMainWorkspaceOnboardingStatus,
  isMainWorkspaceOnboardingPending,
} from '../src/workspace-bootstrap.ts';

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

  assert.ok(fs.existsSync(path.join(workspaceDir, 'NANO.md')));
  assert.ok(fs.existsSync(path.join(workspaceDir, 'SOUL.md')));
  assert.ok(fs.existsSync(path.join(workspaceDir, 'TODOS.md')));
  assert.ok(fs.existsSync(path.join(workspaceDir, 'MEMORY.md')));
  assert.ok(fs.existsSync(path.join(workspaceDir, 'BOOTSTRAP.md')));
  assert.ok(fs.existsSync(path.join(workspaceDir, 'knowledge', 'README.md')));
  assert.ok(
    fs.existsSync(
      path.join(workspaceDir, 'knowledge', 'schema', 'qualia-schema.md'),
    ),
  );
  assert.ok(
    fs.existsSync(path.join(workspaceDir, 'knowledge', 'wiki', 'index.md')),
  );
  assert.equal(state.bootstrapSeededAt, '2026-02-17T10:00:00.000Z');
  assert.equal(state.bootstrapGateEligibleAt, '2026-02-17T10:00:00.000Z');
  assert.equal(state.onboardingCompletedAt, undefined);
  assert.equal(isMainWorkspaceOnboardingPending(workspaceDir), true);
});

test('fresh workspace keeps operational guidance in NANO.md and persona guidance in SOUL.md', () => {
  const workspaceDir = makeTmpWorkspace();
  ensureMainWorkspaceBootstrap({
    workspaceDir,
    now: () => new Date('2026-02-17T10:00:00.000Z'),
  });

  const nanoBody = readText(path.join(workspaceDir, 'NANO.md'));
  const soulBody = readText(path.join(workspaceDir, 'SOUL.md'));

  assert.match(nanoBody, /Session context order:/);
  assert.match(nanoBody, /Memory policy:/);
  assert.match(nanoBody, /Execution stance:/);
  assert.doesNotMatch(
    nanoBody,
    /You are concise, practical, and technically rigorous\./,
  );

  assert.match(
    soulBody,
    /Tone: concise, practical, technically rigorous|technically rigorous/i,
  );
  assert.doesNotMatch(soulBody, /Session context order:/);
  assert.doesNotMatch(soulBody, /Memory policy:/);
});

test('legacy/onboarded workspace does not recreate BOOTSTRAP.md and marks onboarding complete', () => {
  const workspaceDir = makeTmpWorkspace();
  fs.mkdirSync(workspaceDir, { recursive: true });
  fs.writeFileSync(
    path.join(workspaceDir, 'SOUL.md'),
    '# SOUL\n\nCustom profile.\n',
  );
  fs.writeFileSync(
    path.join(workspaceDir, 'TODOS.md'),
    '# TODOS.md = MISSION CONTROL: Custom\n',
  );

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

test('legacy bootstrap state without gate marker is pending but not gate-eligible', () => {
  const workspaceDir = makeTmpWorkspace();
  fs.mkdirSync(path.join(workspaceDir, '.fft_nano'), { recursive: true });
  fs.writeFileSync(
    path.join(workspaceDir, 'BOOTSTRAP.md'),
    '# BOOTSTRAP\n\nLegacy pending onboarding.\n',
  );
  fs.writeFileSync(
    path.join(workspaceDir, '.fft_nano', 'workspace-state.json'),
    JSON.stringify(
      {
        version: 1,
        bootstrapSeededAt: '2026-02-01T10:00:00.000Z',
      },
      null,
      2,
    ),
  );

  const status = getMainWorkspaceOnboardingStatus(workspaceDir);
  assert.equal(status.pending, true);
  assert.equal(status.gateEligible, false);
});

test('seeded TODOS mission-control template is generic and contains no install-specific personal info', () => {
  const workspaceDir = makeTmpWorkspace();
  ensureMainWorkspaceBootstrap({
    workspaceDir,
    now: () => new Date('2026-02-17T08:00:00.000Z'),
  });
  const todosBody = readText(path.join(workspaceDir, 'TODOS.md'));

  assert.match(todosBody, /MISSION CONTROL/i);
  assert.ok(!/scrim|wiggins/i.test(todosBody));
});
