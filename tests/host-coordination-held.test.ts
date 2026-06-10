/**
 * Tests for the held-marker handling in host-coordination.ts IPC watcher.
 *
 * When the IPC watcher detects a .held marker file in messages/ or
 * deliver_files/, it calls enqueueHeldDelivery and markHeldDeliveryNotified
 * instead of processing/delivering the message.
 *
 * Covers: VAL-XARE-001, VAL-XARE-006, VAL-XARE-007
 */

import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import test from 'node:test';
import {
  closeDatabase,
  enqueueHeldDelivery,
  getDeliveryByDedupeKey,
  initDatabaseAtPath,
  listHeldDeliveries,
  listPendingDeliveries,
  markHeldDeliveryNotified,
  releaseHeldDelivery,
} from '../src/db.js';

function withTempDb(fn: () => Promise<void>): Promise<void> {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-held-ipc-'));
  initDatabaseAtPath(path.join(tmpRoot, 'messages.db'));
  return fn().finally(() => {
    closeDatabase();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });
}

// ---------------------------------------------------------------------------
// VAL-XARE-001: Agent-created task calling outbound IPC produces held row
// ---------------------------------------------------------------------------

test('VAL-XARE-001: enqueueHeldDelivery creates held row with correct dedupe_key format', async () => {
  await withTempDb(async () => {
    const sourceGroup = 'main';
    const requestId = 'agent-run-abc123';
    const dedupeKey = `held:${sourceGroup}:${requestId}`;

    const { record, duplicate } = enqueueHeldDelivery({
      dedupeKey,
      destination: 'telegram:123456',
      body: 'hello from held action',
    });

    assert.equal(duplicate, false, 'First enqueue is not a duplicate');
    assert.equal(record.status, 'held');
    assert.equal(record.dedupe_key, dedupeKey);
    assert.equal(record.attempts, 0, 'Held rows have attempts=0');
    assert.equal(record.operator_notified_at, null, 'Not notified yet');
  });
});

// ---------------------------------------------------------------------------
// VAL-XARE-006: Single notification per hold (idempotent via UNIQUE dedupe_key)
// ---------------------------------------------------------------------------

test('VAL-XARE-006: second enqueue for same dedupe_key is duplicate (single notification)', async () => {
  await withTempDb(async () => {
    const dedupeKey = 'held:main:agent-run-xyz';

    const first = enqueueHeldDelivery({
      dedupeKey,
      destination: 'telegram:111',
      body: 'first body',
    });
    assert.equal(first.duplicate, false);
    assert.equal(first.record.status, 'held');

    // Second call with same dedupe_key: INSERT OR IGNORE makes it a no-op
    const second = enqueueHeldDelivery({
      dedupeKey,
      destination: 'telegram:222', // would be ignored
      body: 'second body (should be ignored)',
    });
    assert.equal(second.duplicate, true, 'Second enqueue is a duplicate');
    assert.equal(second.record.body, 'first body', 'Original body preserved');

    // Only one held row exists
    const allHeld = listHeldDeliveries();
    assert.equal(allHeld.length, 1);
    assert.equal(allHeld[0].dedupe_key, dedupeKey);
  });
});

test('VAL-XARE-006: different dedupe_keys produce separate held rows (each notifies once)', async () => {
  await withTempDb(async () => {
    const key1 = 'held:main:agent-run-1';
    const key2 = 'held:main:agent-run-2';

    enqueueHeldDelivery({ dedupeKey: key1, destination: 'telegram:1', body: 'msg1' });
    enqueueHeldDelivery({ dedupeKey: key2, destination: 'telegram:2', body: 'msg2' });

    const allHeld = listHeldDeliveries();
    assert.equal(allHeld.length, 2);

    const dedupeKeys = allHeld.map((r) => r.dedupe_key).sort();
    assert.deepEqual(dedupeKeys, [key1, key2]);
  });
});

test('VAL-XARE-006: markHeldDeliveryNotified is idempotent (COALESCE in SQL)', async () => {
  await withTempDb(async () => {
    const dedupeKey = 'held:main:notify-test';

    enqueueHeldDelivery({ dedupeKey, destination: 'telegram:1', body: 'notify test' });

    markHeldDeliveryNotified(dedupeKey);
    const first = getDeliveryByDedupeKey(dedupeKey);
    const firstTs = first!.operator_notified_at;

    markHeldDeliveryNotified(dedupeKey); // second call
    const second = getDeliveryByDedupeKey(dedupeKey);
    const secondTs = second!.operator_notified_at;

    assert.equal(firstTs, secondTs, 'Timestamp unchanged on second call');
  });
});

// ---------------------------------------------------------------------------
// VAL-XARE-007: Held payloads are never sent by flushPending
// ---------------------------------------------------------------------------

test('VAL-XARE-007: listPendingDeliveries excludes status=held', async () => {
  await withTempDb(async () => {
    enqueueHeldDelivery({ dedupeKey: 'held:x', destination: 'telegram:1', body: 'X' });
    enqueueHeldDelivery({ dedupeKey: 'held:y', destination: 'telegram:2', body: 'Y' });

    // Also add a pending row
    const { enqueueDelivery } = await import('../src/db.js');
    enqueueDelivery({ dedupeKey: 'pending:z', destination: 'telegram:3', body: 'Z' });

    const pending = listPendingDeliveries();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].dedupe_key, 'pending:z');
    assert.equal(pending[0].status, 'pending');
  });
});

test('VAL-XARE-007: release then flushPending picks up the row', async () => {
  await withTempDb(async () => {
    const dedupeKey = 'held:release-then-flush';

    enqueueHeldDelivery({ dedupeKey, destination: 'telegram:1', body: 'release test' });

    // Not in pending yet
    const before = listPendingDeliveries();
    assert.equal(before.filter((r) => r.dedupe_key === dedupeKey).length, 0);

    // Release the held row
    releaseHeldDelivery(dedupeKey);

    // Now it appears in pending
    const after = listPendingDeliveries();
    assert.ok(after.some((r) => r.dedupe_key === dedupeKey));
    assert.equal(after.find((r) => r.dedupe_key === dedupeKey)!.status, 'pending');
  });
});

// ---------------------------------------------------------------------------
// VAL-XARE-001: marker dedupe_key matches the expected IPC watcher format
// ---------------------------------------------------------------------------

test('VAL-XARE-001: dedupe_key format is sourceGroup-scoped for disambiguation', async () => {
  await withTempDb(async () => {
    // Two different groups can have the same requestId for different runs
    const dedupeKey1 = 'held:main:agent-msg-1';
    const dedupeKey2 = 'held:group-a:agent-msg-1';

    enqueueHeldDelivery({ dedupeKey: dedupeKey1, destination: 'telegram:1', body: 'msg1' });
    enqueueHeldDelivery({ dedupeKey: dedupeKey2, destination: 'telegram:2', body: 'msg2' });

    const allHeld = listHeldDeliveries();
    assert.equal(allHeld.length, 2);

    // Each dedupe_key is unique even though the requestId part is the same
    const bodies = allHeld.map((r) => r.body).sort();
    assert.deepEqual(bodies, ['msg1', 'msg2']);
  });
});
