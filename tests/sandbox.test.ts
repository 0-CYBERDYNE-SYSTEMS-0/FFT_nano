import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveDockerVisibleCommand } from '../src/sandbox.js';

test('resolveDockerVisibleCommand prefers in-container pi binary for host absolute pi paths', () => {
  assert.equal(
    resolveDockerVisibleCommand('/Users/test/project/node_modules/.bin/pi'),
    'pi',
  );
  assert.equal(
    resolveDockerVisibleCommand('/opt/homebrew/bin/pi'),
    'pi',
  );
});

test('resolveDockerVisibleCommand keeps non-pi commands unchanged', () => {
  assert.equal(resolveDockerVisibleCommand('/usr/bin/env'), '/usr/bin/env');
  assert.equal(resolveDockerVisibleCommand('node'), 'node');
});

