import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { StreamConsumer } from '../../src/streaming/stream-consumer.js';
import type { PlatformAdapter } from '../../src/streaming/platform-adapter.js';

function createMockAdapter(
  overrides?: Partial<PlatformAdapter>,
): PlatformAdapter & {
  sent: Array<{ chatId: string; content: string }>;
  edits: Array<{ chatId: string; messageId: string; content: string }>;
  deletes: Array<{ chatId: string; messageId: string }>;
  drafts: Array<{ chatId: string; draftId: number; content: string }>;
} {
  let messageCounter = 0;
  const sent: Array<{ chatId: string; content: string }> = [];
  const edits: Array<{ chatId: string; messageId: string; content: string }> =
    [];
  const deletes: Array<{ chatId: string; messageId: string }> = [];
  const drafts: Array<{ chatId: string; draftId: number; content: string }> =
    [];

  return {
    sent,
    edits,
    deletes,
    drafts,
    async send(chatId, content) {
      sent.push({ chatId, content });
      messageCounter++;
      return { success: true, messageId: String(messageCounter) };
    },
    async editMessage(chatId, messageId, content) {
      edits.push({ chatId, messageId, content });
      return { success: true, messageId };
    },
    async deleteMessage(chatId, messageId) {
      deletes.push({ chatId, messageId });
    },
    async sendDraft(chatId, draftId, content) {
      drafts.push({ chatId, draftId, content });
      return { success: true, messageId: String(draftId) };
    },
    supportsDraftStreaming() {
      return true;
    },
    ...overrides,
  };
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 10));
}

describe('StreamConsumer', () => {
  test('first onDelta sends a new message, subsequent calls edit', async () => {
    const adapter = createMockAdapter();
    const consumer = new StreamConsumer({
      chatId: 'chat1',
      runId: 'run1',
      adapter,
      deliveryMode: 'stream',
      verboseMode: 'off',
    });

    await consumer.onDelta(
      'Hello, this is a long enough message to pass threshold',
    );
    await flush();

    assert.equal(adapter.sent.length, 1);
    assert.equal(
      adapter.sent[0].content,
      'Hello, this is a long enough message to pass threshold',
    );

    await consumer.onDelta(
      'Hello, this is updated text that is also long enough',
    );
    await flush();

    assert.equal(adapter.edits.length, 1);
    assert.equal(adapter.edits[0].messageId, '1');

    consumer.stop();
  });

  test('skips delta when text is shorter than MIN_PREVIEW_CHARS and no message exists', async () => {
    const adapter = createMockAdapter();
    const consumer = new StreamConsumer({
      chatId: 'chat1',
      runId: 'run1',
      adapter,
      deliveryMode: 'stream',
      verboseMode: 'off',
    });

    await consumer.onDelta('Hi');
    await flush();

    assert.equal(adapter.sent.length, 0);
    consumer.stop();
  });

  test('delivery mode off prevents all sends', async () => {
    const adapter = createMockAdapter();
    const consumer = new StreamConsumer({
      chatId: 'chat1',
      runId: 'run1',
      adapter,
      deliveryMode: 'off',
      verboseMode: 'off',
    });

    await consumer.onDelta('This is a long message that would normally send');
    await flush();

    assert.equal(adapter.sent.length, 0);
    assert.equal(adapter.drafts.length, 0);
    consumer.stop();
  });

  test('delivery mode append sends durable blocks without editing', async () => {
    const adapter = createMockAdapter();
    const consumer = new StreamConsumer({
      chatId: 'telegram:1',
      runId: 'run-append',
      adapter,
      deliveryMode: 'append',
      verboseMode: 'off',
    });

    await consumer.onDelta(
      'First durable preview block with enough text to send',
    );
    await flush();
    await consumer.onDelta(
      'First durable preview block with enough text to send and a second retained block',
    );
    await flush();

    assert.deepEqual(adapter.sent, [
      {
        chatId: 'telegram:1',
        content: 'First durable preview block with enough text to send',
      },
      {
        chatId: 'telegram:1',
        content: 'and a second retained block',
      },
    ]);
    assert.equal(adapter.edits.length, 0);
    assert.equal(adapter.drafts.length, 0);

    const result = await consumer.finish('Final answer delivered separately');
    assert.equal(result.previewState, null);
  });

  test('delivery mode append diffs rapid queued snapshots after prior sends finish', async () => {
    const adapter = createMockAdapter();
    const consumer = new StreamConsumer({
      chatId: 'telegram:1',
      runId: 'run-append-queued',
      adapter,
      deliveryMode: 'append',
      verboseMode: 'off',
    });

    await consumer.onDelta('Queued durable block with enough initial text');
    await consumer.onDelta(
      'Queued durable block with enough initial text plus later text',
    );
    await flush();

    assert.deepEqual(
      adapter.sent.map((message) => message.content),
      ['Queued durable block with enough initial text', 'plus later text'],
    );
    assert.equal(adapter.edits.length, 0);
    consumer.stop();
  });

  test('delivery mode draft sends native drafts instead of durable preview messages', async () => {
    const adapter = createMockAdapter();
    const consumer = new StreamConsumer({
      chatId: 'telegram:1',
      runId: 'run-draft',
      adapter,
      draftId: 321,
      deliveryMode: 'draft',
      verboseMode: 'off',
    });

    await consumer.onDelta('This is a native draft preview with enough text');
    await flush();
    await consumer.onDelta(
      'This is an updated native draft preview with enough text',
    );
    await flush();
    await consumer.onDelta(
      'This is an updated native draft preview with enough text',
    );
    await flush();

    assert.equal(adapter.sent.length, 0);
    assert.equal(adapter.edits.length, 0);
    assert.deepEqual(adapter.drafts, [
      {
        chatId: 'telegram:1',
        draftId: 321,
        content: 'This is a native draft preview with enough text',
      },
      {
        chatId: 'telegram:1',
        draftId: 321,
        content: 'This is an updated native draft preview with enough text',
      },
    ]);

    const result = await consumer.finish(
      'This final answer is delivered separately',
    );
    assert.equal(result.previewState, null);
  });

  test('delivery mode draft keeps verbose tool progress in the native draft', async () => {
    const adapter = createMockAdapter();
    const consumer = new StreamConsumer({
      chatId: 'telegram:1',
      runId: 'run-draft-tools',
      adapter,
      draftId: 654,
      deliveryMode: 'draft',
      verboseMode: 'all',
    });

    consumer.onToolEvent({ toolName: 'Bash', status: 'start' });
    await flush();

    assert.equal(adapter.sent.length, 0);
    assert.equal(adapter.edits.length, 0);
    assert.equal(adapter.drafts.length, 1);
    assert.equal(adapter.drafts[0].draftId, 654);
    assert.match(adapter.drafts[0].content, /Bash/);
    consumer.stop();
  });

  test('duplicate text does not trigger an edit', async () => {
    const adapter = createMockAdapter();
    const consumer = new StreamConsumer({
      chatId: 'chat1',
      runId: 'run1',
      adapter,
      deliveryMode: 'stream',
      verboseMode: 'off',
    });

    const text = 'Hello, this is a long enough test message';
    await consumer.onDelta(text);
    await flush();
    await consumer.onDelta(text);
    await flush();

    assert.equal(adapter.sent.length, 1);
    assert.equal(adapter.edits.length, 0);
    consumer.stop();
  });

  test('failure on send records failure and consumer still works after success', async () => {
    let callCount = 0;
    const adapter = createMockAdapter({
      async send(chatId, content) {
        callCount++;
        if (callCount === 1) {
          return { success: false, messageId: '', error: 'rate limited' };
        }
        return { success: true, messageId: '99' };
      },
    });

    const consumer = new StreamConsumer({
      chatId: 'chat1',
      runId: 'run1',
      adapter,
      deliveryMode: 'stream',
      verboseMode: 'off',
    });

    await consumer.onDelta('First attempt that is long enough to trigger send');
    await flush();
    assert.equal(callCount, 1);

    // Backoff is active so immediate retry is skipped
    await consumer.onDelta('Second attempt also long enough to trigger a send');
    await flush();
    assert.equal(callCount, 1, 'should be backed off');

    // After backoff expires (1s), next delta should succeed
    await new Promise((resolve) => setTimeout(resolve, 1100));
    await consumer.onDelta('Third attempt after backoff expires now');
    await flush();
    assert.equal(callCount, 2);
    assert.ok(consumer.getPreviewState());

    consumer.stop();
  });

  test('finish returns preview state', async () => {
    const adapter = createMockAdapter();
    const consumer = new StreamConsumer({
      chatId: 'chat1',
      runId: 'run1',
      adapter,
      deliveryMode: 'stream',
      verboseMode: 'off',
    });

    await consumer.onDelta('This is the current preview text here');
    await flush();

    const result = await consumer.finish(
      'This is the final text for the message',
    );
    assert.equal(result.completed, true);
    assert.ok(result.previewState);
    assert.equal(result.previewState.messageId, '1');
    assert.equal(
      result.previewState.lastText,
      'This is the final text for the message',
    );
  });

  test('finish with no message returns null previewState', async () => {
    const adapter = createMockAdapter();
    const consumer = new StreamConsumer({
      chatId: 'chat1',
      runId: 'run1',
      adapter,
      deliveryMode: 'off',
      verboseMode: 'off',
    });

    const result = await consumer.finish();
    assert.equal(result.previewState, null);
  });

  test('abort is non-destructive: never deletes the content bubble', async () => {
    const adapter = createMockAdapter();
    const consumer = new StreamConsumer({
      chatId: 'chat1',
      runId: 'run1',
      adapter,
      deliveryMode: 'stream',
      verboseMode: 'off',
      heartbeatMs: 0,
    });

    await consumer.onDelta('Preview text that is long enough to trigger send');
    await flush();

    await consumer.abort();

    // The content the user was reading must survive a recoverable interruption.
    assert.equal(adapter.deletes.length, 0);
    assert.ok(consumer.getPreviewState());
    assert.equal(consumer.getPreviewState()?.messageId, '1');
  });

  // ── Two-block delivery (stream mode) ───────────────────────────────────────

  test('two-block: status text never overwrites the content bubble', async () => {
    const adapter = createMockAdapter();
    // Threshold 0 forces the Activity bubble to spawn immediately so we can
    // prove status and content occupy DIFFERENT messages.
    const consumer = new StreamConsumer({
      chatId: 'chat1',
      runId: 'run1',
      adapter,
      deliveryMode: 'stream',
      verboseMode: 'off',
      heartbeatMs: 0,
      activitySpawnThresholdMs: 0,
    });

    await consumer.onDelta('This is the real streamed answer content here');
    consumer.handleProgress({ kind: 'thinking', at: Date.now() });
    await flush();

    // Two distinct bubbles: content (msg 1) + activity (msg 2).
    assert.equal(adapter.sent.length, 2);
    const statusEditsOnContent = adapter.edits.filter(
      (e) => e.messageId === '1' && e.content.includes('status:'),
    );
    assert.equal(
      statusEditsOnContent.length,
      0,
      'status text must never be edited into the content bubble',
    );
    consumer.stop();
  });

  test('two-block: quick turns spawn no activity bubble', async () => {
    const adapter = createMockAdapter();
    // Default 2.5s threshold; run is brand new, so status fired now must NOT
    // spawn an activity bubble before the run completes.
    const consumer = new StreamConsumer({
      chatId: 'chat1',
      runId: 'run1',
      adapter,
      deliveryMode: 'stream',
      verboseMode: 'off',
      heartbeatMs: 0,
    });

    await consumer.onDelta('Quick answer that resolves immediately right now');
    consumer.handleProgress({ kind: 'thinking', at: Date.now() });
    await flush();
    await consumer.finish('Quick answer that resolves immediately right now');

    assert.equal(adapter.sent.length, 1, 'quick turn must stay one bubble');
    consumer.stop();
  });

  test('two-block: collapseActivity leaves a receipt and never deletes', async () => {
    const adapter = createMockAdapter();
    const consumer = new StreamConsumer({
      chatId: 'chat1',
      runId: 'run1',
      adapter,
      deliveryMode: 'stream',
      verboseMode: 'off',
      heartbeatMs: 0,
      activitySpawnThresholdMs: 0,
    });

    consumer.handleProgress({ kind: 'thinking', at: Date.now() });
    await flush();
    await consumer.collapseActivity('✓ Done · 2 tools');

    assert.equal(adapter.deletes.length, 0, 'collapse must never delete');
    const lastEdit = adapter.edits[adapter.edits.length - 1];
    assert.ok(lastEdit && lastEdit.content === '✓ Done · 2 tools');
  });

  test('two-block: activity send failure does not throttle answer delivery', async () => {
    const adapter = createMockAdapter({
      async send(chatId, content) {
        if (content.includes('status:')) {
          return { success: false, messageId: '', error: 'activity failed' };
        }
        return {
          success: true,
          messageId: String(adapter.sent.length + 1),
        };
      },
    });
    const consumer = new StreamConsumer({
      chatId: 'chat1',
      runId: 'run1',
      adapter,
      deliveryMode: 'stream',
      verboseMode: 'off',
      heartbeatMs: 0,
      activitySpawnThresholdMs: 0,
    });

    await consumer.onDelta('This is the real streamed answer content here');
    consumer.handleProgress({ kind: 'thinking', at: Date.now() });
    await flush();
    await consumer.onDelta(
      'This is the updated streamed answer content after activity failed',
    );
    await flush();

    assert.equal(adapter.edits.length, 1);
    assert.equal(adapter.edits[0].messageId, '1');
    assert.equal(
      adapter.edits[0].content,
      'This is the updated streamed answer content after activity failed',
    );
    consumer.stop();
  });

  test('two-block: verbose tool progress uses the activity bubble', async () => {
    const adapter = createMockAdapter();
    const consumer = new StreamConsumer({
      chatId: 'chat1',
      runId: 'run1',
      adapter,
      deliveryMode: 'stream',
      verboseMode: 'all',
      heartbeatMs: 0,
      activitySpawnThresholdMs: 0,
    });

    consumer.onToolEvent({
      toolName: 'Bash',
      status: 'start',
      args: JSON.stringify({ command: 'npm test' }),
    });
    await flush();
    await consumer.onDelta('This is the real streamed answer content here');
    await flush();

    assert.equal(adapter.sent.length, 2);
    assert.match(adapter.sent[0].content, /Tool progress/);
    assert.match(adapter.sent[0].content, /Bash/);
    assert.equal(
      adapter.sent[1].content,
      'This is the real streamed answer content here\n\nTools: 🔥 Bash',
    );
    assert.equal(adapter.edits.length, 0);
    consumer.stop();
  });

  test('onDelta after finish is ignored', async () => {
    const adapter = createMockAdapter();
    const consumer = new StreamConsumer({
      chatId: 'chat1',
      runId: 'run1',
      adapter,
      deliveryMode: 'stream',
      verboseMode: 'off',
    });

    await consumer.finish();
    await consumer.onDelta('This should be ignored even though it is long');
    await flush();

    assert.equal(adapter.sent.length, 0);
  });

  test('tool trail appends to delta text', async () => {
    const adapter = createMockAdapter();
    const consumer = new StreamConsumer({
      chatId: 'chat1',
      runId: 'run1',
      adapter,
      deliveryMode: 'stream',
      verboseMode: 'all',
    });

    consumer.onToolEvent({ toolName: 'Bash', status: 'start' });
    consumer.onToolEvent({ toolName: 'Read', status: 'start' });

    await consumer.onDelta('Working on the task right now...');
    await flush();

    assert.equal(adapter.sent.length >= 1, true);
    const lastContent =
      adapter.sent[adapter.sent.length - 1]?.content ||
      adapter.edits[adapter.edits.length - 1]?.content ||
      '';
    assert.ok(lastContent.includes('Tools:'));
    assert.ok(lastContent.includes('Bash'));
    assert.ok(lastContent.includes('Read'));
    consumer.stop();
  });

  test('handleProgress emits TUI events', async () => {
    const tuiEvents: Array<{ kind: string; phase?: string }> = [];
    const adapter = createMockAdapter();
    const consumer = new StreamConsumer({
      chatId: 'chat1',
      runId: 'run1',
      adapter,
      deliveryMode: 'off',
      verboseMode: 'off',
      heartbeatMs: 0,
      onTuiEvent: (event) => tuiEvents.push(event),
    });

    consumer.handleProgress({
      kind: 'spawn',
      at: Date.now(),
      pid: 1,
      resumed: false,
    });
    consumer.handleProgress({ kind: 'thinking', at: Date.now() });

    assert.ok(tuiEvents.some((e) => e.phase === 'spawn'));
    assert.ok(tuiEvents.some((e) => e.phase === 'thinking'));
    consumer.stop();
  });

  test('heartbeat emits periodic status updates', async () => {
    const tuiEvents: Array<{ kind: string; text?: string }> = [];
    const adapter = createMockAdapter();
    const consumer = new StreamConsumer({
      chatId: 'chat1',
      runId: 'run1',
      adapter,
      deliveryMode: 'off',
      verboseMode: 'off',
      heartbeatMs: 50,
      onTuiEvent: (event) => tuiEvents.push(event),
    });

    consumer.handleProgress({ kind: 'thinking', at: Date.now() });

    await new Promise((resolve) => setTimeout(resolve, 120));

    const heartbeats = tuiEvents.filter((e) => e.text?.includes('Still'));
    assert.ok(
      heartbeats.length >= 1,
      `expected heartbeat events, got ${heartbeats.length}`,
    );
    consumer.stop();
  });
});
