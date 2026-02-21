import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EMPTY_NON_HEARTBEAT_OUTPUT_MESSAGE,
  applyNonHeartbeatEmptyOutputPolicy,
} from '../src/agent-empty-output.js';

test('non-heartbeat empty first run retries and returns second non-empty run', async () => {
  let retries = 0;
  const outcome = await applyNonHeartbeatEmptyOutputPolicy({
    isHeartbeatRun: false,
    firstRun: { result: '   ', streamed: false, ok: true },
    retryRun: async () => {
      retries += 1;
      return { result: 'Recovered response', streamed: false, ok: true };
    },
  });

  assert.equal(retries, 1);
  assert.equal(outcome.retried, true);
  assert.equal(outcome.finalRun.result, 'Recovered response');
});

test('non-heartbeat empty first + second runs return explicit fallback message', async () => {
  const outcome = await applyNonHeartbeatEmptyOutputPolicy({
    isHeartbeatRun: false,
    firstRun: { result: '', streamed: false, ok: true },
    retryRun: async () => ({ result: '   ', streamed: false, ok: true }),
  });

  assert.equal(outcome.retried, true);
  assert.equal(outcome.finalRun.result, EMPTY_NON_HEARTBEAT_OUTPUT_MESSAGE);
  assert.equal(outcome.finalRun.ok, true);
});

test('heartbeat runs stay silent and do not trigger empty-output retry policy', async () => {
  let retries = 0;
  const outcome = await applyNonHeartbeatEmptyOutputPolicy({
    isHeartbeatRun: true,
    firstRun: { result: '', streamed: false, ok: true },
    retryRun: async () => {
      retries += 1;
      return { result: 'should not run', streamed: false, ok: true };
    },
  });

  assert.equal(retries, 0);
  assert.equal(outcome.retried, false);
  assert.equal(outcome.finalRun.result, '');
});

