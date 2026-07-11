import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  getProviderFallbackCandidates,
  runContainerAgent,
} from '../src/pi-runner.ts';
import type { RegisteredGroup } from '../src/types.ts';

const providerCredentialEnvNames = [
  'PI_API_KEY',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'GEMINI_API_KEY',
  'OPENROUTER_API_KEY',
  'OPENCODE_API_KEY',
  'OPENCODE_GO_API_KEY',
  'ZAI_API_KEY',
  'MINIMAX_API_KEY',
  'MINIMAX_CN_API_KEY',
  'STEPFUN_API_KEY',
  'KIMI_API_KEY',
] as const;

function writeCredentialFallbackPiExecutable(dir: string): string {
  const executablePath = path.join(dir, 'credential-fallback-pi.js');
  fs.writeFileSync(
    executablePath,
    `#!/usr/bin/env node
const args = process.argv.slice(2);
const providerIndex = args.indexOf('--provider');
const modelIndex = args.indexOf('--model');
const provider = providerIndex === -1 ? '' : (args[providerIndex + 1] || '');
const model = modelIndex === -1 ? '' : (args[modelIndex + 1] || '');

if (provider === 'stepfun') {
  process.stdout.write(JSON.stringify({
    type: 'message_end',
    message: {
      role: 'assistant',
      stopReason: 'error',
      errorMessage: '401 invalid api key',
    },
  }) + '\\n');
  setTimeout(() => process.exit(0), 10);
  return;
}

if (provider === 'anthropic') {
  process.stdout.write(JSON.stringify({
    type: 'message_end',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: 'fallback:' + model }],
    },
  }) + '\\n');
  setTimeout(() => process.exit(0), 10);
  return;
}

process.stderr.write('unexpected provider: ' + provider + '\\n');
setTimeout(() => process.exit(1), 10);
`,
    'utf8',
  );
  fs.chmodSync(executablePath, 0o755);
  return executablePath;
}

test('getProviderFallbackCandidates prioritizes configured order before credential-backed providers', () => {
  assert.deepEqual(
    getProviderFallbackCandidates({
      primaryProvider: 'stepfun',
      configuredOrder: ['zai'],
      credentialedProviders: ['anthropic', 'zai', 'gemini'],
    }),
    ['zai', 'anthropic', 'gemini'],
  );
});

test('runContainerAgent falls back after Pi reports an auth rejection with exit code zero', async (t) => {
  const previousSandboxOverride =
    process.env.FFT_NANO_ALLOW_UNSANDBOXED_HEADLESS;
  const previousCredentials = new Map(
    providerCredentialEnvNames.map((name) => [name, process.env[name]]),
  );
  process.env.FFT_NANO_ALLOW_UNSANDBOXED_HEADLESS = '1';
  for (const name of providerCredentialEnvNames) delete process.env[name];
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-pi-fallback-'));
  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-workspace-'));
  const groupFolder = `testrun_fallback_${Date.now().toString(36)}`;
  const groupDir = path.join(process.cwd(), 'groups', groupFolder);
  const ipcDir = path.join(process.cwd(), 'data', 'ipc', groupFolder);
  const piDir = path.join(process.cwd(), 'data', 'pi', groupFolder);
  const fakePiPath = writeCredentialFallbackPiExecutable(tempDir);

  t.after(() => {
    if (previousSandboxOverride === undefined) {
      delete process.env.FFT_NANO_ALLOW_UNSANDBOXED_HEADLESS;
    } else {
      process.env.FFT_NANO_ALLOW_UNSANDBOXED_HEADLESS = previousSandboxOverride;
    }
    for (const [name, value] of previousCredentials) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.rmSync(workspaceDir, { recursive: true, force: true });
    fs.rmSync(groupDir, { recursive: true, force: true });
    fs.rmSync(ipcDir, { recursive: true, force: true });
    fs.rmSync(piDir, { recursive: true, force: true });
  });

  const group: RegisteredGroup = {
    name: 'Fallback Test Group',
    folder: groupFolder,
    trigger: '@FarmFriend',
    added_at: '2026-07-10T00:00:00.000Z',
  };
  const providerSwitches: string[] = [];

  const output = await runContainerAgent(
    group,
    {
      prompt: 'reply once',
      groupFolder,
      chatJid: 'telegram:test',
      isMain: false,
      assistantName: 'FarmFriend',
      requestId: 'req-provider-auth-fallback',
      noContinue: true,
      provider: 'stepfun',
      model: 'step-3.7-flash',
      secrets: {
        STEPFUN_API_KEY: 'expired-key',
        ANTHROPIC_API_KEY: 'working-key',
      },
      workspaceDirOverride: workspaceDir,
      piExecutableOverride: fakePiPath,
      suppressPreviewStreaming: true,
      lifecyclePolicyOverride: {
        hardTimeoutMs: 5_000,
        staleAfterMs: null,
        toolActiveStaleMs: null,
        waitStateStaleMs: null,
        allowFreshSessionFallback: false,
      },
    },
    undefined,
    undefined,
    undefined,
    (event) => {
      if (event.kind === 'retry_provider_switch') {
        providerSwitches.push(`${event.fromProvider}->${event.toProvider}`);
      }
    },
  );

  assert.equal(output.status, 'success');
  assert.equal(output.result, 'fallback:claude-3-5-sonnet-latest');
  assert.deepEqual(providerSwitches, ['stepfun->anthropic']);
});
