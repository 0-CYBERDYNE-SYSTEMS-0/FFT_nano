import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ensureLocalProviderModels } from '../src/local-provider-models.js';

test('ensureLocalProviderModels falls back to curated MiniMax models when live probe fails', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-local-models-'));
  const modelsPath = path.join(dir, 'models.json');
  const existing = {
    providers: {
      minimax: {
        xFftNanoManaged: 'fft-nano-local-discovery',
        baseUrl: 'https://api.minimax.io/v1',
        api: 'openai-completions',
        apiKey: 'MINIMAX_API_KEY',
        models: [{ id: 'MiniMax-M2.5' }],
      },
    },
  };
  fs.writeFileSync(modelsPath, `${JSON.stringify(existing, null, 2)}\n`);

  const result = ensureLocalProviderModels(dir, {
    MINIMAX_API_KEY: 'secret',
  });

  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.ok((result.errors ?? []).some((msg) => msg.startsWith('minimax:')));

  const after = JSON.parse(fs.readFileSync(modelsPath, 'utf-8'));
  assert.equal(after.providers.minimax.baseUrl, 'https://api.minimax.io/anthropic');
  assert.equal(after.providers.minimax.api, 'anthropic-messages');
  assert.equal(after.providers.minimax.apiKey, '$MINIMAX_API_KEY');
  assert.ok(
    after.providers.minimax.models.length >= 8,
    'curated MiniMax list should be seeded when probe fails',
  );
  assert.ok(
    after.providers.minimax.models.every(
      (m: { api?: string; id: string }) => m.api === 'anthropic-messages',
    ),
  );
});

test('ensureLocalProviderModels preserves managed Moonshot models on discovery failure', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-kimi-models-'));
  const modelsPath = path.join(dir, 'models.json');
  const existing = {
    providers: {
      moonshotai: {
        xFftNanoManaged: 'fft-nano-local-discovery',
        baseUrl: 'https://api.moonshot.ai/v1',
        api: 'openai-completions',
        apiKey: 'MOONSHOT_API_KEY',
        models: [{ id: 'kimi-k2.6' }],
      },
    },
  };
  fs.writeFileSync(modelsPath, `${JSON.stringify(existing, null, 2)}\n`);

  const result = ensureLocalProviderModels(dir, {
    MOONSHOT_BASE_URL: 'http://127.0.0.1:9/v1',
    MOONSHOT_API_KEY: 'secret',
  });

  assert.equal(result.ok, true);
  // The moonshotai entry on disk is preserved (managed by us). With
  // curated-models-always semantics, the curated list is now merged in,
  // so the on-disk model list grows.
  const after = JSON.parse(fs.readFileSync(modelsPath, 'utf-8'));
  const moonshotIds = (after.providers.moonshotai?.models ?? []).map(
    (m: { id: string }) => m.id,
  );
  assert.ok(
    moonshotIds.includes('kimi-k2.6'),
    `expected kimi-k2.6 to be preserved: ${JSON.stringify(moonshotIds)}`,
  );
  assert.ok(
    moonshotIds.includes('kimi-k2-0711-preview'),
    `expected curated kimi-k2-0711-preview to be seeded: ${JSON.stringify(moonshotIds)}`,
  );
  assert.equal(after.providers.moonshotai.apiKey, '$MOONSHOT_API_KEY');
});

test('ensureLocalProviderModels registers discovered Moonshot models for Pi', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-moonshot-models-'));
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-fake-curl-'));
  const curlPath = path.join(binDir, 'curl');
  fs.writeFileSync(
    curlPath,
    [
      '#!/bin/sh',
      `printf '%s\\n%s' '{"data":[{"id":"kimi-k2.7-code"},{"id":"moonshot-v1-embedding"}]}' '200'`,
      '',
    ].join('\n'),
  );
  fs.chmodSync(curlPath, 0o755);

  const previousPath = process.env.PATH;
  process.env.PATH = `${binDir}${path.delimiter}${previousPath || ''}`;
  try {
    const result = ensureLocalProviderModels(dir, {
      MOONSHOT_API_KEY: 'secret',
    });

    assert.equal(result.ok, true);
    // Live discovery now merges with the curated moonshotai list.
    const discoveredIds = result.discovered.moonshotai ?? [];
    assert.ok(
      discoveredIds.includes('kimi-k2.7-code'),
      `expected kimi-k2.7-code in discovered: ${JSON.stringify(discoveredIds)}`,
    );
    assert.ok(
      discoveredIds.includes('kimi-k2-0711-preview'),
      `expected curated kimi-k2-0711-preview in discovered: ${JSON.stringify(discoveredIds)}`,
    );

    const after = JSON.parse(
      fs.readFileSync(path.join(dir, 'models.json'), 'utf-8'),
    );
    assert.equal(after.providers.moonshotai.baseUrl, 'https://api.moonshot.ai/v1');
    assert.equal(after.providers.moonshotai.apiKey, '$MOONSHOT_API_KEY');
    const moonshotIds = after.providers.moonshotai.models.map(
      (model: { id: string }) => model.id,
    );
    assert.ok(
      moonshotIds.includes('kimi-k2.7-code'),
      `expected kimi-k2.7-code to be present: ${JSON.stringify(moonshotIds)}`,
    );
    assert.ok(
      moonshotIds.includes('kimi-k2-0711-preview'),
      `expected curated kimi-k2-0711-preview to be present: ${JSON.stringify(moonshotIds)}`,
    );
    // moonshot-v1-embedding was filtered out by isLikelyChatModelId.
    assert.ok(
      !moonshotIds.includes('moonshot-v1-embedding'),
      `expected moonshot-v1-embedding to be filtered: ${JSON.stringify(moonshotIds)}`,
    );
  } finally {
    process.env.PATH = previousPath;
  }
});

test('ensureLocalProviderModels removes the legacy Moonshot override for Kimi Coding', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-legacy-kimi-models-'));
  const modelsPath = path.join(dir, 'models.json');
  fs.writeFileSync(
    modelsPath,
    `${JSON.stringify(
      {
        providers: {
          'kimi-coding': {
            xFftNanoManaged: 'fft-nano-local-discovery',
            baseUrl: 'https://api.moonshot.ai/v1',
            api: 'openai-completions',
            apiKey: 'KIMI_API_KEY',
            models: [{ id: 'kimi-k2.7-code' }],
          },
        },
      },
      null,
      2,
    )}\n`,
  );

  const result = ensureLocalProviderModels(dir, {});

  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  const after = JSON.parse(fs.readFileSync(modelsPath, 'utf-8'));
  // The legacy moonshot-AI-based kimi-coding entry is migrated in place to
  // the canonical api.kimi.com/coding baseUrl + anthropic-messages api.
  const kimi = after.providers['kimi-coding'];
  assert.ok(kimi, 'expected kimi-coding provider to be present');
  assert.equal(kimi.baseUrl, 'https://api.kimi.com/coding');
  assert.equal(kimi.apiKey, '$KIMI_API_KEY');
  const kimiIds = (kimi.models ?? []).map(
    (m: { id?: string } | string) => (typeof m === 'string' ? m : m.id),
  );
  assert.ok(
    kimiIds.includes('kimi-k2.7-code'),
    `expected legacy kimi-k2.7-code to be preserved: ${JSON.stringify(kimiIds)}`,
  );
  assert.ok(
    kimiIds.includes('kimi-for-coding'),
    `expected curated kimi-for-coding to be present: ${JSON.stringify(kimiIds)}`,
  );
});

test('ensureLocalProviderModels seeds curated providers even when keys are missing (catalog.json version)', () => {
  // Verifies that the new entries added to config/model-catalog.json
  // (anthropic, gemini, zai, kimi-coding, moonshotai, openai, stepfun)
  // all surface in models.json even without any keys configured, and
  // that Stepfun's full 12-model catalog is included.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-catalog-nokey-'));
  fs.writeFileSync(path.join(dir, 'models.json'), '{ "providers": {} }\n');

  const result = ensureLocalProviderModels(dir, {});

  assert.equal(result.ok, true);
  // No key -> no keyless providers should produce a hard error.
  assert.deepEqual(result.errors, []);

  for (const id of [
    'openai',
    'anthropic',
    'gemini',
    'openrouter',
    'opencode-zen',
    'zai',
    'minimax',
    'minimax-cn',
    'stepfun',
    'kimi-coding',
    'moonshotai',
  ]) {
    assert.ok(
      result.unconfiguredProviders.includes(id),
      `expected ${id} in unconfiguredProviders, got: ${JSON.stringify(result.unconfiguredProviders)}`,
    );
  }

  // Every curated provider must be present on disk with the right $KEY apiKey.
  const after = JSON.parse(fs.readFileSync(path.join(dir, 'models.json'), 'utf-8'));
  const expected = {
    openai: '$OPENAI_API_KEY',
    anthropic: '$ANTHROPIC_API_KEY',
    gemini: '$GEMINI_API_KEY',
    zai: '$ZAI_API_KEY',
    minimax: '$MINIMAX_API_KEY',
    'minimax-cn': '$MINIMAX_CN_API_KEY',
    stepfun: '$STEPFUN_API_KEY',
    'kimi-coding': '$KIMI_API_KEY',
    moonshotai: '$MOONSHOT_API_KEY',
  };
  for (const [id, env] of Object.entries(expected)) {
    const p = after.providers[id];
    assert.ok(p, `expected provider ${id} to be present in models.json`);
    assert.equal(
      p.apiKey,
      env,
      `expected ${id}.apiKey=${env}, got: ${p.apiKey}`,
    );
    assert.ok(
      Array.isArray(p.models) && p.models.length > 0,
      `expected ${id} to have a non-empty models list`,
    );
  }

  // Stepfun must expose the full catalog (12 models) even without a key.
  const stepfunIds = (after.providers.stepfun?.models ?? []).map((m) =>
    typeof m === 'string' ? m : m.id,
  );
  for (const required of [
    'step-3.7-flash',
    'step-3.5-flash-2603',
    'step-3.5-flash',
    'step-1-32k',
    'step-1-256k',
    'step-2-16k',
    'step-2-mini',
    'step-1-128k',
    'step-1v-32k',
    'step-1v-128k',
    'step-1o-vision-32k',
    'step-asr',
  ]) {
    assert.ok(
      stepfunIds.includes(required),
      `expected Stepfun model ${required} in seeded list: ${JSON.stringify(stepfunIds)}`,
    );
  }
});
