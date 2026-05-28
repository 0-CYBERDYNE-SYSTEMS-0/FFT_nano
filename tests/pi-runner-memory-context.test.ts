import test from 'node:test';
import assert from 'node:assert/strict';

import { shouldBuildRetrievedMemoryContext } from '../src/pi-runner.js';

test('retrieved memory context is built for main, scheduled, and subagent runs', () => {
  assert.equal(shouldBuildRetrievedMemoryContext({ isMain: true }), true);
  // Non-main chat turns still get no retrieved memory.
  assert.equal(shouldBuildRetrievedMemoryContext({ isMain: false }), false);
  // Cron tasks and subagents in non-main groups now get memory consistently.
  assert.equal(
    shouldBuildRetrievedMemoryContext({ isMain: false, isScheduledTask: true }),
    true,
  );
  assert.equal(
    shouldBuildRetrievedMemoryContext({ isMain: false, isSubagent: true }),
    true,
  );
});
