import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ensureLocalProviderModels } from '../src/local-provider-models.js';

test('ensureLocalProviderModels preserves managed providers on discovery failure', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-local-models-'));
  const modelsPath = path.join(dir, 'models.json');
  const existing = {
    providers: {
      minimax: {
        xFftNanoManaged: 'fft-nano-local-discovery',
        baseUrl: 'https://api.minimax.io/v1',
        api: 'openai-completions',
        apiKey: '$MINIMAX_API_KEY',
        models: [{ id: 'MiniMax-M2.5' }],
      },
    },
  };
  fs.writeFileSync(modelsPath, `${JSON.stringify(existing, null, 2)}\n`);

  const result = ensureLocalProviderModels(dir, {
    MINIMAX_BASE_URL: 'http://127.0.0.1:9/v1',
    MINIMAX_API_KEY: 'secret',
  });

  assert.equal(result.ok, true);
  assert.equal(result.changed, false);

  const after = JSON.parse(fs.readFileSync(modelsPath, 'utf-8'));
  assert.deepEqual(after.providers.minimax.models, [{ id: 'MiniMax-M2.5' }]);
  assert.equal(after.providers.minimax.apiKey, '$MINIMAX_API_KEY');
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
        apiKey: '$MOONSHOT_API_KEY',
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
  assert.equal(result.changed, false);
  assert.deepEqual(result.discovered.moonshotai, undefined);

  const after = JSON.parse(fs.readFileSync(modelsPath, 'utf-8'));
  assert.deepEqual(after.providers.moonshotai.models, [{ id: 'kimi-k2.6' }]);
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
    assert.deepEqual(result.discovered.moonshotai, ['kimi-k2.7-code']);

    const after = JSON.parse(
      fs.readFileSync(path.join(dir, 'models.json'), 'utf-8'),
    );
    assert.equal(after.providers.moonshotai.baseUrl, 'https://api.moonshot.ai/v1');
    assert.equal(after.providers.moonshotai.apiKey, '$MOONSHOT_API_KEY');
    assert.deepEqual(
      after.providers.moonshotai.models.map(
        (model: { id: string }) => model.id,
      ),
      ['kimi-k2.7-code'],
    );
    assert.equal(after.providers['kimi-coding'], undefined);
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
            apiKey: '$KIMI_API_KEY',
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
  assert.equal(after.providers['kimi-coding'], undefined);
});
