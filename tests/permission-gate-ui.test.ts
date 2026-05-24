import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cancelPendingConfirmationsForChat,
  createPendingConfirmation,
  getExpiredConfirmation,
  resolvePendingConfirmation,
} from '../src/permission-gate-ui.js';

test('cancelPendingConfirmationsForChat denies and marks request expired', async () => {
  const requestId = `pg-test-${Date.now().toString(36)}`;
  const { promise } = createPendingConfirmation(
    requestId,
    'telegram:1',
    60_000,
  );

  assert.equal(cancelPendingConfirmationsForChat('telegram:1'), 1);
  assert.deepEqual(await promise, { confirmed: false });
  assert.equal(
    resolvePendingConfirmation(requestId, { confirmed: true }),
    false,
  );
  assert.equal(getExpiredConfirmation(requestId)?.reason, 'cancelled');
});
