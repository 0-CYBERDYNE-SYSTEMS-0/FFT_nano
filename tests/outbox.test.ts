import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  closeDatabase,
  enqueueDelivery,
  getDeliveryByDedupeKey,
  initDatabaseAtPath,
  listPendingDeliveries,
} from '../src/db.js';
import { createOutboxDeliverer } from '../src/outbox.js';

function withTempDb(fn: () => Promise<void>): Promise<void> {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-outbox-'));
  initDatabaseAtPath(path.join(tmpRoot, 'messages.db'));
  return fn().finally(() => {
    closeDatabase();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });
}

test('enqueueDelivery is idempotent on dedupe_key', async () => {
  await withTempDb(async () => {
    const first = enqueueDelivery({
      dedupeKey: 'cron:t1:1000',
      destination: 'telegram:1',
      body: 'result A',
    });
    assert.equal(first.duplicate, false);
    const second = enqueueDelivery({
      dedupeKey: 'cron:t1:1000',
      destination: 'telegram:1',
      body: 'result A (re-emitted)',
    });
    assert.equal(second.duplicate, true);
    // Body of the original row is preserved — the second enqueue was ignored.
    assert.equal(second.record.body, 'result A');
    assert.equal(getDeliveryByDedupeKey('cron:t1:1000')?.id, first.record.id);
  });
});

test('deliver sends once and never re-sends an already-delivered key', async () => {
  await withTempDb(async () => {
    const sends: Array<{ dest: string; body: string }> = [];
    const deliverer = createOutboxDeliverer({
      sendMessage: async (dest, body) => {
        sends.push({ dest, body });
        return true;
      },
    });

    const a = await deliverer.deliver({
      dedupeKey: 'final:run-1',
      destination: 'telegram:1',
      body: 'Run run-1 complete',
    });
    assert.equal(a, true);
    // Same logical message re-emitted (e.g. a resumed run): must not re-send.
    const b = await deliverer.deliver({
      dedupeKey: 'final:run-1',
      destination: 'telegram:1',
      body: 'Run run-1 complete',
    });
    assert.equal(b, true);
    assert.equal(sends.length, 1);
    assert.equal(getDeliveryByDedupeKey('final:run-1')?.status, 'delivered');
  });
});

test('a failed send stays pending and flushPending re-delivers (at-least-once)', async () => {
  await withTempDb(async () => {
    let online = false;
    const sends: string[] = [];
    const deliverer = createOutboxDeliverer({
      sendMessage: async (_dest, body) => {
        if (!online) return false;
        sends.push(body);
        return true;
      },
    });

    // First attempt fails (channel down).
    const first = await deliverer.deliver({
      dedupeKey: 'cron:t2:2000',
      destination: 'telegram:1',
      body: 'overnight report',
    });
    assert.equal(first, false);
    assert.equal(sends.length, 0);
    assert.equal(getDeliveryByDedupeKey('cron:t2:2000')?.status, 'pending');
    assert.equal(listPendingDeliveries().length, 1);

    // Channel recovers; flush delivers it exactly once.
    online = true;
    const flushed = await deliverer.flushPending();
    assert.deepEqual(flushed, { delivered: 1, stillPending: 0 });
    assert.equal(sends.length, 1);
    assert.equal(getDeliveryByDedupeKey('cron:t2:2000')?.status, 'delivered');

    // Subsequent flushes are no-ops — nothing pending, no re-send.
    const again = await deliverer.flushPending();
    assert.deepEqual(again, { delivered: 0, stillPending: 0 });
    assert.equal(sends.length, 1);
  });
});

test('delivery gives up after max_attempts and marks the entry failed', async () => {
  await withTempDb(async () => {
    const deliverer = createOutboxDeliverer({
      sendMessage: async () => false,
    });

    await deliverer.deliver({
      dedupeKey: 'cron:t3:3000',
      destination: 'telegram:1',
      body: 'never lands',
      maxAttempts: 3,
    });
    // 1 attempt used by deliver(); flush twice more to exhaust the cap.
    await deliverer.flushPending();
    await deliverer.flushPending();

    const record = getDeliveryByDedupeKey('cron:t3:3000');
    assert.equal(record?.attempts, 3);
    assert.equal(record?.status, 'failed');
    // Failed entries are no longer picked up by the flush.
    assert.equal(listPendingDeliveries().length, 0);
  });
});
