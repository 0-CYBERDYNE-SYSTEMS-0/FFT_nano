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

test('translateLegacyMessageToHostEvent returns run_progress event for authorized progress payloads', () => {
  const envelope = wrapLegacyMessageEnvelope(
    {
      type: 'run_progress',
      chatJid: 'telegram:1',
      requestId: 'run-1',
      text: 'Skill manager status: Inspecting skills.',
      phase: 'tool_running',
      detail: 'skill_view',
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
    (chatJid) => `session:${chatJid}`,
  );

  assert.ok(event);
  assert.equal(event?.kind, 'run_progress');
  if (!event || event.kind !== 'run_progress') return;
  assert.equal(event.chatJid, 'telegram:1');
  assert.equal(event.runId, 'run-1');
  assert.equal(event.sessionKey, 'session:telegram:1');
  assert.equal(event.phase, 'tool_running');
  assert.equal(event.text, 'Skill manager status: Inspecting skills.');
  assert.equal(event.detail, 'skill_view');
});

test('translateLegacyMessageToHostEvent rejects invalid run_progress payloads', () => {
  const registeredGroups = {
    'telegram:1': {
      name: 'Group A',
      folder: 'group-a',
      trigger: '@FarmFriend',
      added_at: '2026-03-21T00:00:00.000Z',
    },
  };

  for (const payload of [
    { type: 'run_progress', chatJid: 'telegram:1', text: 'missing id' },
    { type: 'run_progress', chatJid: 'telegram:1', requestId: 'run-1' },
    {
      type: 'run_progress',
      chatJid: 'telegram:1',
      requestId: 'run-1',
      text: 'bad phase',
      phase: 'completed',
    },
  ]) {
    const envelope = wrapLegacyMessageEnvelope(
      payload,
      'group-a',
      '2026-03-21T00:00:00.000Z',
    );
    assert.equal(
      translateLegacyMessageToHostEvent(envelope!, registeredGroups, false),
      null,
    );
  }
});

test('translateLegacyMessageToHostEvent blocks non-main cross-group run_progress payloads', () => {
  const envelope = wrapLegacyMessageEnvelope(
    {
      type: 'run_progress',
      chatJid: 'telegram:1',
      requestId: 'run-1',
      text: 'Librarian status: Reviewing captures.',
    },
    'group-b',
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

test('translateLegacyMessageToHostEvent rejects raw evaluator verdict JSON messages', () => {
  const verdictJson = JSON.stringify({
    pass: false,
    score: 1,
    issues: ['Agent served a URL that returned 404 File Not Found'],
    feedback: 'Task failed verification.',
  });
  const envelope = wrapLegacyMessageEnvelope(
    {
      type: 'message',
      chatJid: 'telegram:1',
      text: verdictJson,
      requestId: 'eval-run-1',
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

test('translateLegacyMessageToHostEvent rejects evaluator verdict variants', () => {
  const variants = [
    JSON.stringify({
      pass: false,
      score: '1',
      issues: ['missing artifact'],
      feedback: 'retry',
    }),
    '```json\n{"pass":false,"score":1,"issues":["missing artifact"],"feedback":"retry"}\n```',
    JSON.stringify({
      verdict: {
        pass: false,
        score: 1,
        issues: ['missing artifact'],
        feedback: 'retry',
      },
    }),
    '{"pass":false}\n{"pass":false,"score":1,"issues":["missing artifact"],"feedback":"retry"}',
    'pass:false score:1 issues:["missing artifact"] feedback:"retry"',
  ];
  for (const text of variants) {
    const envelope = wrapLegacyMessageEnvelope(
      {
        type: 'message',
        chatJid: 'telegram:1',
        text,
        requestId: 'eval-run-variant',
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
  }
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
