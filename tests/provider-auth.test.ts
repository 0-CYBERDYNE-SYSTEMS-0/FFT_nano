import assert from 'node:assert/strict';
import test from 'node:test';

import { getPiApiKeyOverride } from '../src/provider-auth.js';

test('getPiApiKeyOverride prefers OPENCODE_API_KEY for opencode-go preset', () => {
  assert.equal(
    getPiApiKeyOverride(
      {},
      {
        PI_API: 'opencode-go',
        PI_API_KEY: 'stale-key',
        OPENCODE_API_KEY: 'opencode-key',
        FFT_NANO_RUNTIME_PROVIDER_PRESET: 'opencode-go',
      },
    ),
    'opencode-key',
  );
});

test('getPiApiKeyOverride allows PI_API_KEY fallback for opencode-go preset', () => {
  assert.equal(
    getPiApiKeyOverride(
      {},
      {
        PI_API: 'opencode-go',
        PI_API_KEY: 'secret',
        FFT_NANO_RUNTIME_PROVIDER_PRESET: 'opencode-go',
      },
    ),
    'secret',
  );
});

test('getPiApiKeyOverride keeps PI_API_KEY for lm-studio openai preset', () => {
  assert.equal(
    getPiApiKeyOverride(
      {},
      {
        PI_API: 'openai',
        PI_API_KEY: 'lm-studio',
        OPENAI_API_KEY: 'real-openai-key',
        FFT_NANO_RUNTIME_PROVIDER_PRESET: 'lm-studio',
      },
    ),
    'lm-studio',
  );
});

test('getPiApiKeyOverride uses PI_API selected provider without explicit input provider', () => {
  assert.equal(
    getPiApiKeyOverride(
      {},
      {
        PI_API: 'opencode-go',
        OPENCODE_API_KEY: 'opencode-key',
      },
    ),
    'opencode-key',
  );
});
