import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  applyProcessEnvUpdates,
  buildRuntimeProviderPresetUpdates,
  loadDotEnvMap,
  RUNTIME_PROVIDER_PRESET_ENV,
  resolveRuntimeConfigSnapshot,
  upsertDotEnv,
} from '../src/runtime-config.js';

test('resolveRuntimeConfigSnapshot supports minimax, kimi-coding, opencode-go, ollama, and lm-studio presets', () => {
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

  const opencodeGo = resolveRuntimeConfigSnapshot({
    PI_API: 'opencode-go',
    PI_MODEL: 'deepseek-v4-pro',
    OPENCODE_API_KEY: 'secret',
  });
  assert.equal(opencodeGo.providerPreset, 'opencode-go');
  assert.equal(opencodeGo.provider, 'opencode-go');
  assert.equal(opencodeGo.model, 'deepseek-v4-pro');
  assert.equal(opencodeGo.apiKeyEnv, 'OPENCODE_API_KEY');
  assert.equal(opencodeGo.apiKeyConfigured, true);

  const opencodeGoFallback = resolveRuntimeConfigSnapshot({
    PI_API: 'opencode-go',
    PI_MODEL: 'deepseek-v4-flash',
    PI_API_KEY: 'secret',
  });
  assert.equal(opencodeGoFallback.providerPreset, 'opencode-go');
  assert.equal(opencodeGoFallback.apiKeyConfigured, true);

  const ollama = resolveRuntimeConfigSnapshot({
    PI_API: 'ollama',
    PI_MODEL: 'qwen3.5:4b',
    PI_API_KEY: 'ollama',
    OPENAI_BASE_URL: 'http://localhost:11434/v1',
  });
  assert.equal(ollama.providerPreset, 'ollama');
  assert.equal(ollama.provider, 'ollama');
  assert.equal(ollama.apiKeyEnv, 'PI_API_KEY');
  assert.equal(ollama.apiKeyConfigured, true);
  assert.equal(ollama.endpointValue, 'http://localhost:11434/v1');

  const lmStudio = resolveRuntimeConfigSnapshot({
    [RUNTIME_PROVIDER_PRESET_ENV]: 'lm-studio',
    PI_API: 'openai',
    PI_MODEL: 'qwen2.5-coder-7b-instruct',
    PI_API_KEY: 'lm-studio',
    OPENAI_BASE_URL: 'http://127.0.0.1:1234/v1',
  });
  assert.equal(lmStudio.providerPreset, 'lm-studio');
  assert.equal(lmStudio.provider, 'lm-studio');
  assert.equal(lmStudio.apiKeyEnv, 'PI_API_KEY');
  assert.equal(lmStudio.apiKeyConfigured, true);
  assert.equal(lmStudio.endpointValue, 'http://127.0.0.1:1234/v1');
});

test('buildRuntimeProviderPresetUpdates applies local defaults for ollama and lm-studio', () => {
  const opencodeGoUpdates = buildRuntimeProviderPresetUpdates({
    preset: 'opencode-go',
    source: {},
  });
  assert.equal(opencodeGoUpdates[RUNTIME_PROVIDER_PRESET_ENV], 'opencode-go');
  assert.equal(opencodeGoUpdates.PI_API, 'opencode-go');
  assert.equal(opencodeGoUpdates.PI_MODEL, 'deepseek-v4-pro');

  const ollamaUpdates = buildRuntimeProviderPresetUpdates({
    preset: 'ollama',
    source: {},
    applyLocalDefaults: true,
  });
  assert.equal(ollamaUpdates[RUNTIME_PROVIDER_PRESET_ENV], 'ollama');
  assert.equal(ollamaUpdates.PI_API, 'ollama');
  assert.equal(ollamaUpdates.OPENAI_BASE_URL, 'http://localhost:11434/v1');
  assert.equal(ollamaUpdates.PI_BASE_URL, 'http://localhost:11434/v1');
  assert.equal(ollamaUpdates.PI_API_KEY, 'ollama');

  const lmStudioUpdates = buildRuntimeProviderPresetUpdates({
    preset: 'lm-studio',
    source: {},
    applyLocalDefaults: true,
  });
  assert.equal(lmStudioUpdates[RUNTIME_PROVIDER_PRESET_ENV], 'lm-studio');
  assert.equal(lmStudioUpdates.PI_API, 'openai');
  assert.equal(lmStudioUpdates.OPENAI_BASE_URL, 'http://127.0.0.1:1234/v1');
  assert.equal(lmStudioUpdates.PI_BASE_URL, 'http://127.0.0.1:1234/v1');
  assert.equal(lmStudioUpdates.PI_API_KEY, 'lm-studio');
});

test('buildRuntimeProviderPresetUpdates prefers the local preset key over a remote OpenAI key', () => {
  const lmStudioUpdates = buildRuntimeProviderPresetUpdates({
    preset: 'lm-studio',
    source: { OPENAI_API_KEY: 'real-openai-key' },
    applyLocalDefaults: true,
  });
  assert.equal(lmStudioUpdates.PI_API_KEY, 'lm-studio');
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
