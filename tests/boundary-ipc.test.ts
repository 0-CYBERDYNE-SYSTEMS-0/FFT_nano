import assert from 'node:assert/strict';
import test from 'node:test';

import {
  dispatchLegacyMessageEnvelope,
  translateLegacyMessageToHostEvent,
  wrapLegacyActionEnvelope,
  wrapLegacyMessageEnvelope,
} from '../src/runtime/boundary-ipc.js';

test('wrapLegacyMessageEnvelope preserves source and request identity', () => {
  const envelope = wrapLegacyMessageEnvelope(
    {
      type: 'message',
      chatJid: 'telegram:1',
      text: 'hello',
      requestId: 'run-1',
    },
    'group-a',
    '2026-03-21T00:00:00.000Z',
  );

  assert.ok(envelope);
  assert.equal(envelope?.kind, 'message');
  assert.equal(envelope?.sourceGroup, 'group-a');
  assert.equal(envelope?.requestId, 'run-1');
  assert.deepEqual(envelope?.payload, {
    type: 'message',
    chatJid: 'telegram:1',
    text: 'hello',
    requestId: 'run-1',
  });
});

test('translateLegacyMessageToHostEvent returns delivery event for authorized legacy messages', () => {
  const envelope = wrapLegacyMessageEnvelope(
    {
      type: 'message',
      chatJid: 'telegram:1',
      text: 'hello',
      requestId: 'run-1',
    },
    'group-a',
    '2026-03-21T00:00:00.000Z',
  );

  const event = translateLegacyMessageToHostEvent(
    envelope!,
    {
      'telegram:1': {
        name: 'Group A',
        folder: 'group-a',
        trigger: '@FarmFriend',
        added_at: '2026-03-21T00:00:00.000Z',
      },
    },
    false,
  );

  assert.ok(event);
  assert.equal(event?.kind, 'chat_delivery_requested');
  if (!event || event.kind !== 'chat_delivery_requested') return;
  assert.equal(event.chatJid, 'telegram:1');
  assert.equal(event.text, 'hello');
  assert.equal(event.requestId, 'run-1');
});

test('translateLegacyMessageToHostEvent ignores legacy draft files', () => {
  const envelope = wrapLegacyMessageEnvelope(
    {
      type: 'telegram_draft_update',
      chatJid: 'telegram:1',
      text: 'thinking',
      draftId: 42,
    },
    'group-a',
    '2026-03-21T00:00:00.000Z',
  );

  const event = translateLegacyMessageToHostEvent(
    envelope!,
    {
      'telegram:1': {
        name: 'Group A',
        folder: 'group-a',
        trigger: '@FarmFriend',
        added_at: '2026-03-21T00:00:00.000Z',
      },
    },
    false,
  );

  assert.equal(event, null);
});

test('dispatchLegacyMessageEnvelope awaits async delivery handlers', async () => {
  const envelope = wrapLegacyMessageEnvelope(
    {
      type: 'message',
      chatJid: 'telegram:1',
      text: 'hello',
      requestId: 'run-1',
    },
    'group-a',
    '2026-03-21T00:00:00.000Z',
  );

  let releaseDelivery: (() => void) | undefined;
  let delivered = false;
  const deliveryGate = new Promise<void>((resolve) => {
    releaseDelivery = resolve;
  });

  const resultPromise = dispatchLegacyMessageEnvelope(
    envelope!,
    {
      'telegram:1': {
        name: 'Group A',
        folder: 'group-a',
        trigger: '@FarmFriend',
        added_at: '2026-03-21T00:00:00.000Z',
      },
    },
    false,
    async () => {
      await deliveryGate;
      delivered = true;
    },
  );

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(delivered, false);

  releaseDelivery?.();
  const result = await resultPromise;
  assert.equal(delivered, true);
  assert.equal(result, 'delivered');
});

test('dispatchLegacyMessageEnvelope propagates delivery failures', async () => {
  const envelope = wrapLegacyMessageEnvelope(
    {
      type: 'message',
      chatJid: 'telegram:1',
      text: 'hello',
      requestId: 'run-1',
    },
    'group-a',
    '2026-03-21T00:00:00.000Z',
  );

  await assert.rejects(
    dispatchLegacyMessageEnvelope(
      envelope!,
      {
        'telegram:1': {
          name: 'Group A',
          folder: 'group-a',
          trigger: '@FarmFriend',
          added_at: '2026-03-21T00:00:00.000Z',
        },
      },
      false,
      async () => {
        throw new Error('delivery failed');
      },
    ),
    /delivery failed/,
  );
});

test('wrapLegacyActionEnvelope captures result path metadata for boundary writes', () => {
  const envelope = wrapLegacyActionEnvelope(
    {
      type: 'memory_action',
      action: 'memory_search',
      params: { query: 'soil' },
      requestId: 'req-1',
    },
    'group-a',
    '/tmp/group-a/action_results/req-1.json',
    '2026-03-21T00:00:00.000Z',
  );

  assert.ok(envelope);
  assert.equal(envelope?.kind, 'action');
  assert.equal(envelope?.requestId, 'req-1');
  assert.equal(envelope?.resultPath, '/tmp/group-a/action_results/req-1.json');
});
