import assert from 'node:assert/strict';
import test from 'node:test';

import { StreamConsumer } from '../src/streaming/stream-consumer.js';
import type { PlatformAdapter } from '../src/streaming/platform-adapter.js';

function createAdapter(): PlatformAdapter & {
  sent: Array<{ content: string }>;
  edits: Array<{ content: string }>;
} {
  let n = 0;
  const sent: Array<{ content: string }> = [];
  const edits: Array<{ content: string }> = [];
  return {
    sent,
    edits,
    async send(_chatId, content) {
      n += 1;
      sent.push({ content });
      return { success: true, messageId: String(n) };
    },
    async editMessage(_chatId, _messageId, content) {
      edits.push({ content });
      return { success: true, messageId: String(n || 1) };
    },
    async deleteMessage() {},
  };
}

test('status mode does not stream monologue deltas', async () => {
  const adapter = createAdapter();
  const consumer = new StreamConsumer({
    chatId: 'telegram:1',
    runId: 'run-status-1',
    adapter,
    deliveryMode: 'status',
    verboseMode: 'off',
    activitySpawnThresholdMs: 0,
    heartbeatMs: 0,
  });

  await consumer.onDelta('Hello this is a long monologue about the work.');
  await consumer.onDelta(
    'Hello this is a long monologue about the work. More text.',
  );
  await consumer.finish('Short final summary path=/tmp/x.html');

  assert.equal(adapter.sent.length, 0);
  assert.equal(
    consumer.getPreviewState(),
    null,
    'status mode should not create a content preview bubble',
  );
});

test('status mode still accepts milestone status text', async () => {
  const adapter = createAdapter();
  const consumer = new StreamConsumer({
    chatId: 'telegram:1',
    runId: 'run-status-2',
    adapter,
    deliveryMode: 'status',
    verboseMode: 'off',
    activitySpawnThresholdMs: 0,
    heartbeatMs: 0,
  });

  consumer.handleProgress({ kind: 'spawn', resumed: false } as any);
  // allow activity chain to flush
  await new Promise((r) => setTimeout(r, 30));

  assert.ok(
    adapter.sent.length >= 1 || adapter.edits.length >= 1,
    'spawn milestone should surface as activity',
  );
  await consumer.finish();
});

test('stream mode blocks dump deltas from preview', async () => {
  const adapter = createAdapter();
  const consumer = new StreamConsumer({
    chatId: 'telegram:1',
    runId: 'run-stream-dump',
    adapter,
    deliveryMode: 'stream',
    verboseMode: 'off',
    activitySpawnThresholdMs: 0,
    heartbeatMs: 0,
  });

  const dump = [
    '<tool_call>',
    '<function=write>',
    '<parameter=content>',
    '<!DOCTYPE html><html><body>',
    ...Array.from({ length: 50 }, (_, i) => `<div class="x${i}">block</div>`),
    '</body></html>',
    '</parameter>',
  ].join('\n');

  await consumer.onDelta(dump);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(
    adapter.sent.length,
    0,
    'tool-call dump must not open a stream bubble',
  );
  await consumer.finish('ok summary');
});
