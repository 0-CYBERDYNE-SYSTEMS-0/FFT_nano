import assert from 'node:assert/strict';
import test from 'node:test';

import { state } from '../src/app-state.js';
import { OUTBOUND_DUMP_FALLBACK } from '../src/outbound-text-guard.js';
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

test('wiring redacts a Telegram preview when deletion fails', async () => {
  const originalTelegramBot = state.telegramBot;
  const edited: Array<{
    messageId: number;
    text: string;
    maxAttempts?: number;
  }> = [];
  state.telegramBot = {
    editStreamMessage: async (_chatJid, messageId, text, options) => {
      edited.push({
        messageId,
        text,
        maxAttempts: options?.maxAttempts,
      });
    },
    deleteMessage: async () => {
      throw new Error('delete denied');
    },
  } as TelegramBot;

  try {
    await deleteWiredTelegramPreview('telegram:1', 41);
  } finally {
    state.telegramBot = originalTelegramBot;
  }

  assert.deepEqual(edited, [
    {
      messageId: 41,
      text: OUTBOUND_DUMP_FALLBACK,
      maxAttempts: 1,
    },
  ]);
});
