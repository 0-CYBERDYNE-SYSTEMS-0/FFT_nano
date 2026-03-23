import assert from 'node:assert/strict';
import test from 'node:test';

import {
  computeBlockStreamDelivery,
  computePersistentPreviewDelivery,
  finalizePersistentPreviewDelivery,
  finalizeBlockStreamDelivery,
  getTelegramPreviewRunKey,
  resolveTelegramStreamCompletionState,
  TelegramPreviewRegistry,
  updateTelegramDraftPreview,
  updateTelegramPreview,
} from '../src/telegram-streaming.js';

test('updateTelegramPreview sends then edits one visible preview message', async () => {
  const registry = new TelegramPreviewRegistry(60_000);
  const sent: string[] = [];
  const edited: Array<{ messageId: number; text: string }> = [];
  const bot = {
    sendStreamMessage: async (_chatJid: string, text: string) => {
      sent.push(text);
      return 777;
    },
    editStreamMessage: async (_chatJid: string, messageId: number, text: string) => {
      edited.push({ messageId, text });
    },
  };

  const longText = 'This is a message with enough characters to pass debouncing';
  const longerText = 'This is an updated message with enough characters for editing';

  const first = await updateTelegramPreview({
    bot,
    registry,
    chatJid: 'telegram:1',
    requestId: 'run-1',
    text: longText,
  });
  const second = await updateTelegramPreview({
    bot,
    registry,
    chatJid: 'telegram:1',
    requestId: 'run-1',
    text: longerText,
  });
  const duplicate = await updateTelegramPreview({
    bot,
    registry,
    chatJid: 'telegram:1',
    requestId: 'run-1',
    text: longerText,
  });

  assert.equal(first.sent, true);
  assert.equal(second.sent, true);
  assert.equal(duplicate.sent, false);
  assert.deepEqual(sent, [longText]);
  assert.deepEqual(edited, [{ messageId: 777, text: longerText }]);
});

test('updateTelegramPreview retries with backoff before disabling after repeated failures', async () => {
  const registry = new TelegramPreviewRegistry(60_000);
  let calls = 0;
  const bot = {
    sendStreamMessage: async () => {
      calls += 1;
      throw new Error('boom');
    },
    editStreamMessage: async () => {
      throw new Error('unreachable');
    },
  };

  const makeCall = (text: string) =>
    updateTelegramPreview({
      bot,
      registry,
      chatJid: 'telegram:1',
      requestId: 'run-2',
      text,
    });

  const first = await makeCall('This is a message long enough to pass the debounce threshold');
  assert.equal(first.sent, false);
  assert.equal(first.disabled, false, 'first failure should back off, not disable');
  assert.equal(typeof first.error, 'string');
  assert.equal(calls, 1);

  const backoff = await makeCall('This is another message long enough to pass debounce check');
  assert.equal(backoff.sent, false);
  assert.equal(backoff.disabled, true, 'within backoff window, should report disabled');
  assert.equal(backoff.error, undefined);
  assert.equal(calls, 1, 'should not retry during backoff');
});

test('updateTelegramPreview permanently disables after 4 consecutive failures', async () => {
  const registry = new TelegramPreviewRegistry(60_000);
  let calls = 0;
  const bot = {
    sendStreamMessage: async () => {
      calls += 1;
      throw new Error('boom');
    },
    editStreamMessage: async () => {
      throw new Error('unreachable');
    },
  };

  for (let i = 0; i < 4; i++) {
    registry.prune(Date.now() + 60_000);
    await updateTelegramPreview({
      bot,
      registry,
      chatJid: 'telegram:1',
      requestId: 'run-3',
      text: `attempt ${i} with enough characters to bypass debounce threshold check`,
    });
  }

  assert.equal(calls, 4);
  assert.equal(registry.isDisabled(getTelegramPreviewRunKey('telegram:1', 'run-3')), true);
});

test('updateTelegramPreview clears failure count on success', async () => {
  const registry = new TelegramPreviewRegistry(60_000);
  let failCount = 0;
  const bot = {
    sendStreamMessage: async (_chatJid: string, text: string) => {
      if (text.startsWith('fail')) {
        failCount++;
        throw new Error('boom');
      }
      return 888;
    },
    editStreamMessage: async () => {},
  };

  await updateTelegramPreview({
    bot,
    registry,
    chatJid: 'telegram:1',
    requestId: 'run-4',
    text: 'fail — this text is long enough to pass the debounce threshold',
  });
  assert.equal(failCount, 1);

  registry.prune(Date.now() + 60_000);
  const success = await updateTelegramPreview({
    bot,
    registry,
    chatJid: 'telegram:1',
    requestId: 'run-4',
    text: 'works — this text is long enough to pass the debounce threshold',
  });
  assert.equal(success.sent, true);
  assert.equal(success.disabled, false);
});

test('updateTelegramPreview skips initial send when text is below minimum character threshold', async () => {
  const registry = new TelegramPreviewRegistry(60_000);
  let sent = 0;
  const bot = {
    sendStreamMessage: async () => {
      sent++;
      return 999;
    },
    editStreamMessage: async () => {},
  };

  const short = await updateTelegramPreview({
    bot,
    registry,
    chatJid: 'telegram:1',
    requestId: 'run-5',
    text: 'Hi',
  });
  assert.equal(short.sent, false);
  assert.equal(short.disabled, false);
  assert.equal(sent, 0);

  const long = await updateTelegramPreview({
    bot,
    registry,
    chatJid: 'telegram:1',
    requestId: 'run-5',
    text: 'This message is long enough to pass the debounce threshold now',
  });
  assert.equal(long.sent, true);
  assert.equal(sent, 1);
});

test('updateTelegramDraftPreview sends native draft updates without using message edits', async () => {
  const registry = new TelegramPreviewRegistry(60_000);
  const drafts: Array<{ draftId: number; text: string }> = [];
  const bot = {
    sendMessageDraft: async (_chatJid: string, draftId: number, text: string) => {
      drafts.push({ draftId, text });
    },
  };

  const first = await updateTelegramDraftPreview({
    bot,
    registry,
    chatJid: 'telegram:1',
    requestId: 'run-draft',
    draftId: 321,
    text: 'This is a native Telegram draft preview with enough characters',
  });
  const second = await updateTelegramDraftPreview({
    bot,
    registry,
    chatJid: 'telegram:1',
    requestId: 'run-draft',
    draftId: 321,
    text: 'This is a native Telegram draft preview with enough characters and more',
  });
  const duplicate = await updateTelegramDraftPreview({
    bot,
    registry,
    chatJid: 'telegram:1',
    requestId: 'run-draft',
    draftId: 321,
    text: 'This is a native Telegram draft preview with enough characters and more',
  });

  assert.equal(first.sent, true);
  assert.equal(second.sent, true);
  assert.equal(duplicate.sent, false);
  assert.deepEqual(drafts, [
    { draftId: 321, text: 'This is a native Telegram draft preview with enough characters' },
    {
      draftId: 321,
      text: 'This is a native Telegram draft preview with enough characters and more',
    },
  ]);
});

test('resolveTelegramStreamCompletionState returns active preview state', () => {
  const registry = new TelegramPreviewRegistry(60_000);
  const runKey = getTelegramPreviewRunKey('telegram:1', 'run-3');
  registry.setPreviewState(runKey, {
    messageId: 444,
    lastText: 'preview',
    updatedAt: 1000,
  });

  const resolved = resolveTelegramStreamCompletionState({
    externallyCompleted: false,
    previewState: registry.consumePreviewState(runKey),
  });

  assert.equal(resolved.effectiveStreamed, true);
  assert.deepEqual(resolved.messagePreviewState, {
    messageId: 444,
    lastText: 'preview',
    updatedAt: 1000,
  });
});

test('computePersistentPreviewDelivery appends only new suffix for monotonic growth', () => {
  const result = computePersistentPreviewDelivery({
    previousText: 'hello world',
    nextText: 'hello world and more',
  });

  assert.deepEqual(result, {
    deliveryText: ' and more',
    nextStateText: 'hello world and more',
  });
});

test('computePersistentPreviewDelivery emits a snapshot block when stream rewrites text', () => {
  const result = computePersistentPreviewDelivery({
    previousText: 'draft one',
    nextText: 'draft two with rewrite',
  });

  assert.match(result.deliveryText || '', /Updated draft:/);
  assert.match(result.deliveryText || '', /draft two with rewrite/);
  assert.equal(result.nextStateText, 'draft two with rewrite');
});

test('computePersistentPreviewDelivery does not splice overlapping rewrite fragments', () => {
  const result = computePersistentPreviewDelivery({
    previousText: 'prefix overlap marker',
    nextText: 'marker rewritten transcript',
  });

  assert.equal(result.deliveryText, 'Updated draft:\nmarker rewritten transcript');
  assert.equal(result.nextStateText, 'marker rewritten transcript');
});

test('finalizePersistentPreviewDelivery emits only the missing final suffix and marks completion', () => {
  const result = finalizePersistentPreviewDelivery({
    previousText: 'partial answer',
    finalText: 'partial answer complete',
  });

  assert.deepEqual(result, {
    deliveryText: ' complete',
    nextStateText: 'partial answer complete',
    completed: true,
  });
});

test('finalizePersistentPreviewDelivery treats matching final text as already completed', () => {
  const result = finalizePersistentPreviewDelivery({
    previousText: 'final answer',
    finalText: 'final answer',
  });

  assert.deepEqual(result, {
    deliveryText: null,
    nextStateText: 'final answer',
    completed: true,
  });
});

test('computeBlockStreamDelivery buffers until threshold then emits paragraph-sized chunk', () => {
  const first = computeBlockStreamDelivery({
    nextText: `${'A'.repeat(500)}\n\n${'B'.repeat(150)}`,
    now: 1_000,
  });
  assert.deepEqual(first.deliveryTexts, []);

  const second = computeBlockStreamDelivery({
    previousState: first.nextState,
    nextText: `${'A'.repeat(500)}\n\n${'B'.repeat(150)}\n\n${'C'.repeat(220)}`,
    now: 2_100,
  });

  assert.equal(second.deliveryTexts.length, 1);
  assert.match(second.deliveryTexts[0] || '', /A{100}/);
  assert.match(second.deliveryTexts[0] || '', /C{100}/);
});

test('computeBlockStreamDelivery flushes pending text and emits snapshot on rewrite', () => {
  const result = computeBlockStreamDelivery({
    previousState: {
      mode: 'block',
      lastText: 'draft one with suffix',
      pendingText: ' with suffix',
      updatedAt: 1_000,
      lastSentAt: 1_000,
    },
    nextText: 'draft two rewritten',
    now: 1_500,
  });

  assert.deepEqual(result.deliveryTexts, [' with suffix', 'Updated draft:\ndraft two rewritten']);
});

test('finalizeBlockStreamDelivery flushes pending text and marks completion when final matches stream', () => {
  const result = finalizeBlockStreamDelivery({
    state: {
      mode: 'block',
      lastText: 'final answer complete',
      pendingText: ' complete',
      updatedAt: 1_000,
      lastSentAt: 1_000,
    },
    finalText: 'final answer complete',
    now: 3_000,
  });

  assert.deepEqual(result.deliveryTexts, [' complete']);
  assert.equal(result.completed, true);
  assert.equal(result.nextState, null);
});
