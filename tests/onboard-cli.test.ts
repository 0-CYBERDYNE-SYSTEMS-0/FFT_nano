import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import test from 'node:test';

import { parseOnboardArgs, runOnboarding } from '../src/onboard-cli.ts';

function makeTmpWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fft-onboard-'));
}

function nonInteractiveBase(workspace: string) {
  return {
    workspace,
    envPath: path.join(workspace, '.env'),
    nonInteractive: true as const,
    acceptRisk: true,
    authChoice: 'skip' as const,
    skipChannels: true,
    skipSkills: true,
    skipHealth: true,
    skipUi: true,
    force: false,
    json: false,
  };
}

test('runOnboarding writes USER/IDENTITY and preserves BOOTSTRAP for first-run ritual', async () => {
  const workspace = makeTmpWorkspace();
  const result = await runOnboarding({
    ...nonInteractiveBase(workspace),
    operator: 'Alex',
    assistantName: 'OpenClaw',
  });

  assert.equal(result.workspace, workspace);
  assert.match(fs.readFileSync(path.join(workspace, 'USER.md'), 'utf-8'), /Primary operator: Alex\./);
  assert.match(fs.readFileSync(path.join(workspace, 'IDENTITY.md'), 'utf-8'), /Name: OpenClaw/);
  assert.match(
    fs.readFileSync(path.join(workspace, 'SOUL.md'), 'utf-8'),
    /You are OpenClaw, a pragmatic and technically rigorous copilot for Alex\./,
  );
  assert.equal(fs.existsSync(path.join(workspace, 'BOOTSTRAP.md')), true);

  const state = JSON.parse(
    fs.readFileSync(path.join(workspace, '.fft_nano', 'workspace-state.json'), 'utf-8'),
  ) as { onboardingCompletedAt?: string; bootstrapSeededAt?: string };
  assert.equal(state.onboardingCompletedAt, undefined);
  assert.ok(state.bootstrapSeededAt);
});

test('runOnboarding with --force is deterministic for same inputs', async () => {
  const workspace = makeTmpWorkspace();
  await runOnboarding({
    ...nonInteractiveBase(workspace),
    operator: 'Scrim',
    assistantName: 'OpenClaw',
  });

  const firstState = fs.readFileSync(
    path.join(workspace, '.fft_nano', 'workspace-state.json'),
    'utf-8',
  );
  await runOnboarding({
    ...nonInteractiveBase(workspace),
    operator: 'Scrim',
    assistantName: 'OpenClaw',
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
      ...nonInteractiveBase(workspace),
    }),
    /Non-interactive onboarding requires --operator <name>/,
  );
});

test('runOnboarding non-interactive does not overwrite customized files without force', async () => {
  const workspace = makeTmpWorkspace();
  await runOnboarding({
    ...nonInteractiveBase(workspace),
    operator: 'Alex',
    assistantName: 'OpenClaw',
  });

  const userPath = path.join(workspace, 'USER.md');
  const identityPath = path.join(workspace, 'IDENTITY.md');
  const soulPath = path.join(workspace, 'SOUL.md');
  fs.writeFileSync(userPath, '# USER\n\nPrimary operator: Custom Operator.\n', 'utf-8');
  fs.writeFileSync(identityPath, '# IDENTITY\n\nName: CustomBot\n', 'utf-8');
  fs.writeFileSync(soulPath, '# SOUL\n\nCustom soul profile.\n', 'utf-8');

  await runOnboarding({
    ...nonInteractiveBase(workspace),
    operator: 'Different Name',
    assistantName: 'DifferentBot',
  });

  assert.equal(
    fs.readFileSync(userPath, 'utf-8'),
    '# USER\n\nPrimary operator: Custom Operator.\n',
  );
  assert.equal(fs.readFileSync(identityPath, 'utf-8'), '# IDENTITY\n\nName: CustomBot\n');
  assert.equal(fs.readFileSync(soulPath, 'utf-8'), '# SOUL\n\nCustom soul profile.\n');
});

test('runOnboarding applies explicit assistant name to default scaffold without force', async () => {
  const workspace = makeTmpWorkspace();
  await runOnboarding({
    ...nonInteractiveBase(workspace),
    operator: 'Alex',
    assistantName: 'AgriBot',
  });

  assert.match(fs.readFileSync(path.join(workspace, 'IDENTITY.md'), 'utf-8'), /Name: AgriBot/);
});

test('runOnboarding non-interactive requires --accept-risk', async () => {
  const workspace = makeTmpWorkspace();
  await assert.rejects(
    runOnboarding({
      ...nonInteractiveBase(workspace),
      acceptRisk: false,
      operator: 'Alex',
      assistantName: 'OpenClaw',
    }),
    /requires explicit risk acknowledgement/i,
  );
});

test('runOnboarding non-interactive local auth provider writes provider env', async () => {
  const workspace = makeTmpWorkspace();
  const envPath = path.join(workspace, '.env');
  await runOnboarding({
    ...nonInteractiveBase(workspace),
    envPath,
    operator: 'Alex',
    assistantName: 'OpenClaw',
    authChoice: 'openai',
    apiKey: 'test-key',
    model: 'gpt-4.1-mini',
    gatewayPort: 29999,
  });
  const envBody = fs.readFileSync(envPath, 'utf-8');
  assert.match(envBody, /^PI_API=openai$/m);
  assert.match(envBody, /^PI_MODEL=gpt-4.1-mini$/m);
  assert.match(envBody, /^OPENAI_API_KEY=test-key$/m);
  assert.match(envBody, /^FFT_NANO_TUI_PORT=29999$/m);
});

test('runOnboarding local LM Studio choice writes local endpoint defaults without requiring an API key', async () => {
  const workspace = makeTmpWorkspace();
  const envPath = path.join(workspace, '.env');
  await runOnboarding({
    ...nonInteractiveBase(workspace),
    envPath,
    operator: 'Alex',
    assistantName: 'OpenClaw',
    authChoice: 'lm-studio',
    model: 'qwen2.5-coder-7b-instruct',
  });
  const envBody = fs.readFileSync(envPath, 'utf-8');
  assert.match(envBody, /^FFT_NANO_RUNTIME_PROVIDER_PRESET=lm-studio$/m);
  assert.match(envBody, /^PI_API=openai$/m);
  assert.match(envBody, /^PI_MODEL=qwen2.5-coder-7b-instruct$/m);
  assert.match(envBody, /^OPENAI_BASE_URL=http:\/\/127\.0\.0\.1:1234\/v1$/m);
  assert.match(envBody, /^PI_BASE_URL=http:\/\/127\.0\.0\.1:1234\/v1$/m);
  assert.match(envBody, /^PI_API_KEY=lm-studio$/m);
});

test('runOnboarding defaults local runtime to docker and persists it', async () => {
  const workspace = makeTmpWorkspace();
  const envPath = path.join(workspace, '.env');
  const result = await runOnboarding({
    ...nonInteractiveBase(workspace),
    envPath,
    operator: 'Alex',
    assistantName: 'OpenClaw',
  });
  const envBody = fs.readFileSync(envPath, 'utf-8');
  assert.equal(result.runtime, 'docker');
  assert.match(envBody, /^CONTAINER_RUNTIME=docker$/m);
});

test('runOnboarding host runtime writes host opt-in env flags', async () => {
  const workspace = makeTmpWorkspace();
  const envPath = path.join(workspace, '.env');
  const result = await runOnboarding({
    ...nonInteractiveBase(workspace),
    envPath,
    operator: 'Alex',
    assistantName: 'OpenClaw',
    runtime: 'host',
  });
  const envBody = fs.readFileSync(envPath, 'utf-8');
  assert.equal(result.runtime, 'host');
  assert.match(envBody, /^CONTAINER_RUNTIME=host$/m);
  assert.match(envBody, /^FFT_NANO_ALLOW_HOST_RUNTIME=1$/m);
});

test('parseOnboardArgs parses and validates --runtime', () => {
  const parsed = parseOnboardArgs([
    '--workspace',
    '/tmp/ws',
    '--runtime',
    'host',
    '--operator',
    'A',
    '--assistant-name',
    'B',
  ]);
  assert.equal(parsed.runtime, 'host');
  assert.throws(
    () => parseOnboardArgs(['--workspace', '/tmp/ws', '--runtime', 'invalid']),
    /Invalid --runtime/i,
  );
});

test('parseOnboardArgs accepts local model auth choices', () => {
  const lmStudio = parseOnboardArgs([
    '--workspace',
    '/tmp/ws',
    '--auth-choice',
    'lm-studio',
    '--operator',
    'A',
    '--assistant-name',
    'B',
  ]);
  assert.equal(lmStudio.authChoice, 'lm-studio');

  const ollama = parseOnboardArgs([
    '--workspace',
    '/tmp/ws',
    '--auth-choice',
    'ollama',
    '--operator',
    'A',
    '--assistant-name',
    'B',
  ]);
  assert.equal(ollama.authChoice, 'ollama');
});
