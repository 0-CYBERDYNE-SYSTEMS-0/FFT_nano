import test from 'node:test';
import assert from 'node:assert/strict';

import { shouldBuildRetrievedMemoryContext } from '../src/pi-runner.js';

test('retrieved memory context is built only for main runs', () => {
  assert.equal(shouldBuildRetrievedMemoryContext({ isMain: true }), true);
  assert.equal(shouldBuildRetrievedMemoryContext({ isMain: false }), false);
});
