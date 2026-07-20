import assert from 'node:assert/strict';
import test from 'node:test';

import { state } from '../src/app-state.js';
import type { TelegramBot } from '../src/telegram.js';
import {
  deleteTelegramPreviewMessage as deleteWiredTelegramPreview,
  finalizeTelegramPreviewMessage as finalizeWiredTelegramPreview,
} from '../src/wiring.js';

test('wiring forwards every Telegram preview message ID to delivery helpers', async () => {
  const originalTelegramBot = state.telegramBot;
  const deleted: number[] = [];
  const edited: number[] = [];
  state.telegramBot = {
    editStreamMessage: async (_chatJid, messageId) => {
      edited.push(messageId);
    },
    deleteMessage: async (_chatJid, messageId) => {
      deleted.push(messageId);
    },
  } as TelegramBot;

  try {
    await deleteWiredTelegramPreview('telegram:1', 41, [41, 42]);
    const finalized = await finalizeWiredTelegramPreview(
      'telegram:1',
      41,
      '# Final',
      [41, 42],
    );
    assert.equal(finalized, true);
  } finally {
    state.telegramBot = originalTelegramBot;
  }

  assert.deepEqual(edited, [41]);
  assert.deepEqual(deleted, [41, 42, 42]);
});
