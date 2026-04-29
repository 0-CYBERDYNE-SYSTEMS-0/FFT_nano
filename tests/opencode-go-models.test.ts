import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  ensureOpenCodeGoModels,
  OPENCODE_GO_DEEPSEEK_MODELS,
} from '../src/opencode-go-models.js';

test('ensureOpenCodeGoModels seeds DeepSeek V4 models without dropping existing models', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-opencode-go-'));
  const modelsPath = path.join(dir, 'models.json');
  fs.writeFileSync(
    modelsPath,
    JSON.stringify(
      {
        providers: {
          'opencode-go': {
            models: [{ id: 'custom-existing', name: 'Custom Existing' }],
          },
        },
      },
      null,
      2,
    ),
    'utf-8',
  );

  const result = ensureOpenCodeGoModels(dir);
  assert.equal(result.ok, true);
  assert.equal(result.changed, true);

  const body = JSON.parse(fs.readFileSync(modelsPath, 'utf-8'));
  const provider = body.providers['opencode-go'];
  assert.equal(provider.apiKey, 'OPENCODE_API_KEY');
  const ids = provider.models.map((model: { id: string }) => model.id);
  assert.ok(ids.includes('custom-existing'));
  for (const model of OPENCODE_GO_DEEPSEEK_MODELS) {
    assert.ok(ids.includes(model.id));
  }
});

