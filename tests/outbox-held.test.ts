import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  closeDatabase,
  enqueueDelivery,
  enqueueHeldDelivery,
  getDeliveryByDedupeKey,
  initDatabaseAtPath,
  listHeldDeliveries,
  listPendingDeliveries,
  releaseHeldDelivery,
  markHeldDeliveryNotified,
} from '../src/db.js';

function withTempDb(fn: () => Promise<void>): Promise<void> {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-outbox-held-'));
  initDatabaseAtPath(path.join(tmpRoot, 'messages.db'));
  return fn().finally(() => {
    closeDatabase();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });
}

test('enqueueHeldDelivery creates a held row', async () => {
  await withTempDb(async () => {
    const { record, duplicate } = enqueueHeldDelivery({
      dedupeKey: 'held:test:1',
      destination: 'telegram:123',
      body: 'held message',
    });

    assert.equal(duplicate, false);
    assert.equal(record.status, 'held');
    assert.equal(record.attempts, 0);
    assert.equal(record.operator_notified_at, null);
    assert.equal(record.dedupe_key, 'held:test:1');
  });
});

test('enqueueHeldDelivery is idempotent on dedupe_key', async () => {
  await withTempDb(async () => {
    const first = enqueueHeldDelivery({
      dedupeKey: 'held:test:2',
      destination: 'telegram:123',
      body: 'first body',
    });
    assert.equal(first.duplicate, false);
    assert.equal(first.record.status, 'held');

    const second = enqueueHeldDelivery({
      dedupeKey: 'held:test:2',
      destination: 'telegram:123',
      body: 'second body (ignored)',
    });
    assert.equal(second.duplicate, true);
    // Original body is preserved
    assert.equal(second.record.body, 'first body');
    assert.equal(getDeliveryByDedupeKey('held:test:2')?.body, 'first body');
  });
});

test('listHeldDeliveries returns held rows', async () => {
  await withTempDb(async () => {
    enqueueHeldDelivery({ dedupeKey: 'held:a', destination: 'telegram:1', body: 'A' });
    enqueueHeldDelivery({ dedupeKey: 'held:b', destination: 'telegram:2', body: 'B' });
    enqueueDelivery({ dedupeKey: 'pending:x', destination: 'telegram:3', body: 'X' });

    const held = listHeldDeliveries();
    assert.equal(held.length, 2);
    assert.ok(held.every((r) => r.status === 'held'));
  });
});

test('listPendingDeliveries does NOT include held rows', async () => {
  await withTempDb(async () => {
    enqueueHeldDelivery({ dedupeKey: 'held:y', destination: 'telegram:1', body: 'Y' });
    enqueueDelivery({ dedupeKey: 'pending:z', destination: 'telegram:2', body: 'Z' });

    const pending = listPendingDeliveries();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].dedupe_key, 'pending:z');
    assert.equal(pending[0].status, 'pending');
  });
});

test('releaseHeldDelivery flips held to pending', async () => {
  await withTempDb(async () => {
    enqueueHeldDelivery({ dedupeKey: 'held:release', destination: 'telegram:1', body: 'to release' });

    const released = releaseHeldDelivery('held:release');
    assert.ok(released);
    assert.equal(released.status, 'pending');

    // Now it should appear in pending deliveries
    const pending = listPendingDeliveries();
    assert.ok(pending.some((r) => r.dedupe_key === 'held:release'));
  });
});

test('releaseHeldDelivery is idempotent (already released = no-op)', async () => {
  await withTempDb(async () => {
    enqueueHeldDelivery({ dedupeKey: 'held:idempotent', destination: 'telegram:1', body: 'idempotent test' });
    releaseHeldDelivery('held:idempotent');
    releaseHeldDelivery('held:idempotent'); // second call

    const record = getDeliveryByDedupeKey('held:idempotent');
    assert.equal(record?.status, 'pending');
  });
});

test('markHeldDeliveryNotified sets operator_notified_at', async () => {
  await withTempDb(async () => {
    enqueueHeldDelivery({ dedupeKey: 'held:notify', destination: 'telegram:1', body: 'notify me' });

    const before = getDeliveryByDedupeKey('held:notify');
    assert.equal(before?.operator_notified_at, null);

    markHeldDeliveryNotified('held:notify');

    const after = getDeliveryByDedupeKey('held:notify');
    assert.notEqual(after?.operator_notified_at, null);
    assert.ok(after?.operator_notified_at!.length > 0);
  });
});

test('markHeldDeliveryNotified is idempotent (sets once)', async () => {
  await withTempDb(async () => {
    enqueueHeldDelivery({ dedupeKey: 'held:notify2', destination: 'telegram:1', body: 'notify me 2' });

    markHeldDeliveryNotified('held:notify2');
    const first = getDeliveryByDedupeKey('held:notify2')?.operator_notified_at;

    // Second call should not change anything (COALESCE in SQL)
    markHeldDeliveryNotified('held:notify2');
    const second = getDeliveryByDedupeKey('held:notify2')?.operator_notified_at;

    assert.equal(first, second);
  });
});

test('flushPending does not touch held rows (VAL-XARE-007 proxy)', async () => {
  await withTempDb(async () => {
    enqueueHeldDelivery({ dedupeKey: 'held:flush', destination: 'telegram:1', body: 'do not flush' });

    const { record } = enqueueHeldDelivery({ dedupeKey: 'held:flush', destination: 'telegram:1', body: 'do not flush' });
    // dedupe already exists - no new row
    assert.equal(record.status, 'held');

    // listPendingDeliveries should not return held rows
    const pending = listPendingDeliveries();
    assert.equal(pending.filter((r) => r.dedupe_key === 'held:flush').length, 0);

    const held = getDeliveryByDedupeKey('held:flush');
    assert.equal(held?.status, 'held');
  });
});
