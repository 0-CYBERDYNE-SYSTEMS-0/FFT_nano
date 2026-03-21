import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getTelegramPreviewRunKey,
  resolveTelegramStreamCompletionState,
  TelegramPreviewRegistry,
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

  const first = await updateTelegramPreview({
    bot,
    registry,
    chatJid: 'telegram:1',
    requestId: 'run-1',
    text: 'hello',
  });
  const second = await updateTelegramPreview({
    bot,
    registry,
    chatJid: 'telegram:1',
    requestId: 'run-1',
    text: 'hello again',
  });
  const duplicate = await updateTelegramPreview({
    bot,
    registry,
    chatJid: 'telegram:1',
    requestId: 'run-1',
    text: 'hello again',
  });

  assert.equal(first.sent, true);
  assert.equal(second.sent, true);
  assert.equal(duplicate.sent, false);
  assert.deepEqual(sent, ['hello']);
  assert.deepEqual(edited, [{ messageId: 777, text: 'hello again' }]);
});

test('updateTelegramPreview disables failed runs and skips retry', async () => {
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

  const first = await updateTelegramPreview({
    bot,
    registry,
    chatJid: 'telegram:1',
    requestId: 'run-2',
    text: 'hello',
  });
  const second = await updateTelegramPreview({
    bot,
    registry,
    chatJid: 'telegram:1',
    requestId: 'run-2',
    text: 'hello again',
  });

  assert.equal(first.sent, false);
  assert.equal(first.disabled, true);
  assert.equal(typeof first.error, 'string');
  assert.equal(second.sent, false);
  assert.equal(second.disabled, true);
  assert.equal(second.error, undefined);
  assert.equal(calls, 1);
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
