import assert from 'node:assert/strict';
import test from 'node:test';

import { getPiApiKeyOverride } from '../src/provider-auth.js';

test('getPiApiKeyOverride allows PI_API_KEY for opencode-go preset', () => {
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

