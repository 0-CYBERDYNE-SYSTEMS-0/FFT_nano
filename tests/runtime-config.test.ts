import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  applyProcessEnvUpdates,
  loadDotEnvMap,
  resolveRuntimeConfigSnapshot,
  upsertDotEnv,
} from '../src/runtime-config.js';

test('resolveRuntimeConfigSnapshot supports minimax and kimi-coding presets', () => {
  const minimax = resolveRuntimeConfigSnapshot({
    PI_API: 'minimax',
    PI_MODEL: 'MiniMax-M2.1',
    MINIMAX_API_KEY: 'secret',
  });
  assert.equal(minimax.providerPreset, 'minimax');
  assert.equal(minimax.apiKeyEnv, 'MINIMAX_API_KEY');
  assert.equal(minimax.apiKeyConfigured, true);

  const kimi = resolveRuntimeConfigSnapshot({
    PI_API: 'kimi-coding',
    PI_MODEL: 'kimi-k2-thinking',
    KIMI_API_KEY: 'secret',
  });
  assert.equal(kimi.providerPreset, 'kimi-coding');
  assert.equal(kimi.apiKeyEnv, 'KIMI_API_KEY');
  assert.equal(kimi.apiKeyConfigured, true);
});

test('resolveRuntimeConfigSnapshot falls back to manual provider state', () => {
  const snapshot = resolveRuntimeConfigSnapshot({
    PI_API: 'custom-provider',
    PI_MODEL: 'custom-model',
    PI_API_KEY: 'secret',
    PI_BASE_URL: 'http://localhost:11434/v1',
  });
  assert.equal(snapshot.providerPreset, 'manual');
  assert.equal(snapshot.apiKeyEnv, 'PI_API_KEY');
  assert.equal(snapshot.endpointEnv, 'PI_BASE_URL');
  assert.equal(snapshot.endpointValue, 'http://localhost:11434/v1');
});

test('upsertDotEnv updates, appends, and removes keys without dropping comments', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-runtime-config-'));
  const envPath = path.join(dir, '.env');
  fs.writeFileSync(
    envPath,
    ['# comment', 'PI_API=openai', 'PI_MODEL=gpt-4o-mini', 'OPENAI_API_KEY=old', ''].join('\n'),
    'utf-8',
  );

  upsertDotEnv(envPath, {
    PI_MODEL: 'gpt-5-mini',
    OPENAI_API_KEY: undefined,
    OPENAI_BASE_URL: 'http://localhost:11434/v1',
  });

  const body = fs.readFileSync(envPath, 'utf-8');
  assert.match(body, /^# comment$/m);
  assert.match(body, /^PI_API=openai$/m);
  assert.match(body, /^PI_MODEL=gpt-5-mini$/m);
  assert.doesNotMatch(body, /^OPENAI_API_KEY=/m);
  assert.match(body, /^OPENAI_BASE_URL=http:\/\/localhost:11434\/v1$/m);
  const envMap = loadDotEnvMap(envPath);
  assert.equal(envMap.PI_MODEL, 'gpt-5-mini');
  assert.equal(envMap.OPENAI_BASE_URL, 'http://localhost:11434/v1');
});

test('applyProcessEnvUpdates sets and clears keys', () => {
  const original = process.env.OPENAI_BASE_URL;
  try {
    applyProcessEnvUpdates({ OPENAI_BASE_URL: 'http://localhost:11434/v1' });
    assert.equal(process.env.OPENAI_BASE_URL, 'http://localhost:11434/v1');
    applyProcessEnvUpdates({ OPENAI_BASE_URL: undefined });
    assert.equal(process.env.OPENAI_BASE_URL, undefined);
  } finally {
    if (original === undefined) delete process.env.OPENAI_BASE_URL;
    else process.env.OPENAI_BASE_URL = original;
  }
});
