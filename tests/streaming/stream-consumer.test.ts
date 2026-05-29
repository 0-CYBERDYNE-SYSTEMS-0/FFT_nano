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

  test('abort deletes preview message', async () => {
    const adapter = createMockAdapter();
    const consumer = new StreamConsumer({
      chatId: 'chat1',
      runId: 'run1',
      adapter,
      deliveryMode: 'stream',
      verboseMode: 'off',
    });

    await consumer.onDelta('Preview text that is long enough to trigger send');
    await flush();

    await consumer.abort();

    assert.equal(adapter.deletes.length, 1);
    assert.equal(adapter.deletes[0].messageId, '1');
    assert.equal(consumer.getPreviewState(), null);
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
