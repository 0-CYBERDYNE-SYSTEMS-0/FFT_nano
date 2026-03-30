import assert from 'node:assert/strict';
import test from 'node:test';

import {
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

test('consumePreviewState is atomic - second consume returns null (VAL-STATE-001)', () => {
  const registry = new TelegramPreviewRegistry(60_000);
  const runKey = getTelegramPreviewRunKey('telegram:1', 'run-atomic');

  // Set up preview state
  registry.setPreviewState(runKey, {
    messageId: 555,
    lastText: 'atomic test',
    updatedAt: 2000,
  });

  // First consume should return the state
  const firstConsume = registry.consumePreviewState(runKey);
  assert.notEqual(firstConsume, null);
  assert.equal(firstConsume?.messageId, 555);
  assert.equal(firstConsume?.lastText, 'atomic test');

  // Second consume should return null (state already consumed)
  const secondConsume = registry.consumePreviewState(runKey);
  assert.equal(secondConsume, null, 'Second consume should return null - state already consumed');

  // Verify state is completely gone
  const thirdConsume = registry.consumePreviewState(runKey);
  assert.equal(thirdConsume, null, 'Third consume should also return null');
});
