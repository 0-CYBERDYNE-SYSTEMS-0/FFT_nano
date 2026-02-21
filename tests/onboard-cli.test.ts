import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import test from 'node:test';

import { runOnboarding } from '../src/onboard-cli.ts';

function makeTmpWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fft-onboard-'));
}

test('runOnboarding writes USER/IDENTITY and completes BOOTSTRAP lifecycle', async () => {
  const workspace = makeTmpWorkspace();
  const result = await runOnboarding({
    workspace,
    operator: 'Alex',
    assistantName: 'FarmFriend',
    nonInteractive: true,
    force: false,
  });

  assert.equal(result.workspace, workspace);
  assert.match(fs.readFileSync(path.join(workspace, 'USER.md'), 'utf-8'), /Primary operator: Alex\./);
  assert.match(fs.readFileSync(path.join(workspace, 'IDENTITY.md'), 'utf-8'), /Name: FarmFriend/);
  assert.equal(fs.existsSync(path.join(workspace, 'BOOTSTRAP.md')), false);

  const state = JSON.parse(
    fs.readFileSync(path.join(workspace, '.fft_nano', 'workspace-state.json'), 'utf-8'),
  ) as { onboardingCompletedAt?: string };
  assert.ok(state.onboardingCompletedAt);
});

test('runOnboarding with --force is deterministic for same inputs', async () => {
  const workspace = makeTmpWorkspace();
  await runOnboarding({
    workspace,
    operator: 'Scrim',
    assistantName: 'FarmFriend',
    nonInteractive: true,
    force: false,
  });

  const firstState = fs.readFileSync(
    path.join(workspace, '.fft_nano', 'workspace-state.json'),
    'utf-8',
  );
  await runOnboarding({
    workspace,
    operator: 'Scrim',
    assistantName: 'FarmFriend',
    nonInteractive: true,
    force: true,
  });
  const secondState = fs.readFileSync(
    path.join(workspace, '.fft_nano', 'workspace-state.json'),
    'utf-8',
  );

  assert.equal(secondState, firstState);
  assert.match(fs.readFileSync(path.join(workspace, 'USER.md'), 'utf-8'), /Primary operator: Scrim\./);
});

test('runOnboarding non-interactive requires explicit operator and assistant name', async () => {
  const workspace = makeTmpWorkspace();
  await assert.rejects(
    runOnboarding({
      workspace,
      nonInteractive: true,
      force: false,
    }),
    /Non-interactive onboarding requires --operator <name>/,
  );
});

test('runOnboarding non-interactive does not overwrite customized files without force', async () => {
  const workspace = makeTmpWorkspace();
  await runOnboarding({
    workspace,
    operator: 'Alex',
    assistantName: 'FarmFriend',
    nonInteractive: true,
    force: false,
  });

  const userPath = path.join(workspace, 'USER.md');
  const identityPath = path.join(workspace, 'IDENTITY.md');
  fs.writeFileSync(userPath, '# USER\n\nPrimary operator: Custom Operator.\n', 'utf-8');
  fs.writeFileSync(identityPath, '# IDENTITY\n\nName: CustomBot\n', 'utf-8');

  await runOnboarding({
    workspace,
    operator: 'Different Name',
    assistantName: 'DifferentBot',
    nonInteractive: true,
    force: false,
  });

  assert.equal(
    fs.readFileSync(userPath, 'utf-8'),
    '# USER\n\nPrimary operator: Custom Operator.\n',
  );
  assert.equal(fs.readFileSync(identityPath, 'utf-8'), '# IDENTITY\n\nName: CustomBot\n');
});

test('runOnboarding applies explicit assistant name to default scaffold without force', async () => {
  const workspace = makeTmpWorkspace();
  await runOnboarding({
    workspace,
    operator: 'Alex',
    assistantName: 'AgriBot',
    nonInteractive: true,
    force: false,
  });

  assert.match(fs.readFileSync(path.join(workspace, 'IDENTITY.md'), 'utf-8'), /Name: AgriBot/);
});
