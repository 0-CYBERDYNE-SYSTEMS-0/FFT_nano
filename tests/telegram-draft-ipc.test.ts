import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveTelegramStreamCompletionState,
  TelegramDraftDisableRegistry,
  parseTelegramDraftIpcMessage,
  sendTelegramDraftWithFallback,
} from '../src/telegram-draft-ipc.js';

test('parseTelegramDraftIpcMessage parses valid payload', () => {
  const parsed = parseTelegramDraftIpcMessage({
    type: 'telegram_draft_update',
    chatJid: ' telegram:123 ',
    requestId: ' run-1 ',
    draftId: 42,
    text: 'hello',
    messageThreadId: 9,
  });
  assert.ok(parsed);
  assert.equal(parsed?.chatJid, 'telegram:123');
  assert.equal(parsed?.requestId, 'run-1');
  assert.equal(parsed?.draftId, 42);
  assert.equal(parsed?.text, 'hello');
  assert.equal(parsed?.messageThreadId, 9);
});

test('parseTelegramDraftIpcMessage rejects invalid payload', () => {
  assert.equal(
    parseTelegramDraftIpcMessage({
      type: 'telegram_draft_update',
      chatJid: 'telegram:123',
      draftId: 0,
      text: 'bad',
    }),
    null,
  );
  assert.equal(parseTelegramDraftIpcMessage({ type: 'message' }), null);
});

test('sendTelegramDraftWithFallback disables failed runs and skips retry', async () => {
  const registry = new TelegramDraftDisableRegistry(60_000);
  let calls = 0;
  let sent = 0;
  let edited = 0;
  const bot = {
    sendMessageDraft: async () => {
      calls++;
      throw new Error('boom');
    },
    sendStreamMessage: async () => {
      sent++;
      throw new Error('stream boom');
    },
    editStreamMessage: async () => {
      edited++;
      throw new Error('edit boom');
    },
  };

  const first = await sendTelegramDraftWithFallback({
    bot,
    registry,
    draft: {
      type: 'telegram_draft_update',
      chatJid: 'telegram:1',
      requestId: 'r1',
      draftId: 10,
      text: 'hello',
    },
  });
  assert.equal(first.sent, false);
  assert.equal(first.disabled, true);
  assert.equal(typeof first.error, 'string');
  assert.equal(calls, 1);

  const second = await sendTelegramDraftWithFallback({
    bot,
    registry,
    draft: {
      type: 'telegram_draft_update',
      chatJid: 'telegram:1',
      requestId: 'r1',
      draftId: 10,
      text: 'hello again',
    },
  });
  assert.equal(second.sent, false);
  assert.equal(second.disabled, true);
  assert.equal(second.error, undefined);
  assert.equal(calls, 1);
  assert.equal(sent, 1);
  assert.equal(edited, 0);
});

test('TelegramDraftDisableRegistry prunes expired entries', () => {
  const registry = new TelegramDraftDisableRegistry(10);
  registry.disable('run-key', 1000);
  assert.equal(registry.isDisabled('run-key', 1005), true);
  registry.prune(1011);
  assert.equal(registry.size(), 0);
});

test('sendTelegramDraftWithFallback uses draft API when available', async () => {
  const registry = new TelegramDraftDisableRegistry(60_000);
  let draftCalls = 0;
  let sent = 0;
  let edited = 0;
  const bot = {
    sendMessageDraft: async () => {
      draftCalls++;
    },
    sendStreamMessage: async () => {
      sent++;
      return 777;
    },
    editStreamMessage: async () => {
      edited++;
    },
  };

  const first = await sendTelegramDraftWithFallback({
    bot,
    registry,
    draft: {
      type: 'telegram_draft_update',
      chatJid: 'telegram:1',
      requestId: 'r1',
      draftId: 20,
      text: 'hello',
    },
  });
  assert.equal(first.sent, true);
  assert.equal(first.disabled, false);
  assert.equal(draftCalls, 1);
  assert.equal(sent, 0);
  assert.equal(edited, 0);

  const second = await sendTelegramDraftWithFallback({
    bot,
    registry,
    draft: {
      type: 'telegram_draft_update',
      chatJid: 'telegram:1',
      requestId: 'r1',
      draftId: 20,
      text: 'hello again',
    },
  });
  assert.equal(second.sent, true);
  assert.equal(second.disabled, false);
  assert.equal(draftCalls, 2);
  assert.equal(sent, 0);
  assert.equal(edited, 0);
});

test('sendTelegramDraftWithFallback falls back to visible stream when draft fails initially', async () => {
  const registry = new TelegramDraftDisableRegistry(60_000);
  let draftCalls = 0;
  let sent = 0;
  let edited = 0;
  const bot = {
    sendMessageDraft: async () => {
      draftCalls++;
      throw new Error('draft unavailable');
    },
    sendStreamMessage: async () => {
      sent++;
      return 777;
    },
    editStreamMessage: async () => {
      edited++;
    },
  };

  const first = await sendTelegramDraftWithFallback({
    bot,
    registry,
    draft: {
      type: 'telegram_draft_update',
      chatJid: 'telegram:1',
      requestId: 'r1',
      draftId: 21,
      text: 'hello',
    },
  });
  assert.equal(first.sent, true);
  assert.equal(first.disabled, false);
  assert.equal(draftCalls, 1);
  assert.equal(sent, 1);
  assert.equal(edited, 0);

  const second = await sendTelegramDraftWithFallback({
    bot,
    registry,
    draft: {
      type: 'telegram_draft_update',
      chatJid: 'telegram:1',
      requestId: 'r1',
      draftId: 21,
      text: 'hello again',
    },
  });
  assert.equal(second.sent, true);
  assert.equal(second.disabled, false);
  assert.equal(draftCalls, 1);
  assert.equal(sent, 1);
  assert.equal(edited, 1);
});

test('sendTelegramDraftWithFallback does not switch to visible stream after draft succeeded', async () => {
  const registry = new TelegramDraftDisableRegistry(60_000);
  let draftCalls = 0;
  let sent = 0;
  const bot = {
    sendMessageDraft: async () => {
      draftCalls++;
      if (draftCalls >= 2) throw new Error('draft failed later');
    },
    sendStreamMessage: async () => {
      sent++;
      return 777;
    },
    editStreamMessage: async () => {
      // unused in this scenario
    },
  };

  const first = await sendTelegramDraftWithFallback({
    bot,
    registry,
    draft: {
      type: 'telegram_draft_update',
      chatJid: 'telegram:1',
      requestId: 'r2',
      draftId: 22,
      text: 'hello',
    },
  });
  assert.equal(first.sent, true);
  assert.equal(first.disabled, false);
  assert.equal(sent, 0);

  const second = await sendTelegramDraftWithFallback({
    bot,
    registry,
    draft: {
      type: 'telegram_draft_update',
      chatJid: 'telegram:1',
      requestId: 'r2',
      draftId: 22,
      text: 'hello again',
    },
  });
  assert.equal(second.sent, false);
  assert.equal(second.disabled, true);
  assert.equal(typeof second.error, 'string');
  assert.equal(sent, 0);
});

test('resolveTelegramStreamCompletionState keeps final send enabled for draft-only streaming', () => {
  const resolved = resolveTelegramStreamCompletionState({
    reportedStreamed: true,
    externallyCompleted: false,
    streamState: {
      mode: 'draft',
      lastText: 'thinking...',
      updatedAt: 123,
    },
  });

  assert.equal(resolved.effectiveStreamed, false);
  assert.equal(resolved.messagePreviewState, null);
  assert.equal(resolved.usedDraftState, true);
});

test('resolveTelegramStreamCompletionState keeps final send enabled when no preview state was recorded', () => {
  const resolved = resolveTelegramStreamCompletionState({
    reportedStreamed: true,
    externallyCompleted: false,
    streamState: null,
  });

  assert.equal(resolved.effectiveStreamed, false);
  assert.equal(resolved.messagePreviewState, null);
  assert.equal(resolved.usedDraftState, false);
});

test('resolveTelegramStreamCompletionState treats visible preview messages as streamed', () => {
  const resolved = resolveTelegramStreamCompletionState({
    reportedStreamed: false,
    externallyCompleted: false,
    streamState: {
      mode: 'message',
      messageId: 77,
      lastText: 'partial',
      updatedAt: 456,
    },
  });

  assert.equal(resolved.effectiveStreamed, true);
  assert.equal(resolved.messagePreviewState?.messageId, 77);
  assert.equal(resolved.usedDraftState, false);
});

test('resolveTelegramStreamCompletionState suppresses local final delivery after external completion', () => {
  const resolved = resolveTelegramStreamCompletionState({
    reportedStreamed: false,
    externallyCompleted: true,
    streamState: {
      mode: 'message',
      messageId: 88,
      lastText: 'partial',
      updatedAt: 789,
    },
  });

  assert.equal(resolved.effectiveStreamed, true);
  assert.equal(resolved.messagePreviewState, null);
  assert.equal(resolved.usedDraftState, false);
});
