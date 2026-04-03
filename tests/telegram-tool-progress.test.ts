import assert from 'node:assert/strict';
import test from 'node:test';

import type { TelegramToolProgressState } from '../src/app-state.js';
import {
  buildTelegramToolProgressLine,
  buildTelegramToolProgressMessage,
  buildTelegramPreviewToolTrailEntry,
  enqueueTelegramToolProgressMessage,
  finalizeTelegramToolProgressRun,
  getTelegramToolProgressKey,
  shouldUseTelegramPreviewToolTrail,
  shouldUseStandaloneTelegramToolProgress,
} from '../src/telegram-tool-progress.js';

test('buildTelegramToolProgressLine returns concise start lines for all mode', () => {
  const line = buildTelegramToolProgressLine(
    {
      toolName: 'bash',
      status: 'start',
      args: '{"command":"git status"}',
    },
    'all',
  );

  assert.match(line || '', /bash/i);
  assert.match(line || '', /git status/i);
});

test('buildTelegramToolProgressLine returns detailed multiline output for verbose mode', () => {
  const line = buildTelegramToolProgressLine(
    {
      toolName: 'read_file',
      status: 'start',
      args: '{"path":"src/index.ts"}',
    },
    'verbose',
  );

  assert.match(line || '', /read_file/i);
  assert.match(line || '', /src\/index\.ts/i);
  assert.match(line || '', /\n/);
});

test('enqueueTelegramToolProgressMessage sends a standalone progress message on the first tool event', async () => {
  const runs = new Map<string, TelegramToolProgressState>();
  const sent: string[] = [];
  const edited: Array<{ messageId: number; text: string }> = [];
  const bot = {
    sendStreamMessage: async (_chatJid: string, text: string) => {
      sent.push(text);
      return 401;
    },
    editStreamMessage: async (_chatJid: string, messageId: number, text: string) => {
      edited.push({ messageId, text });
    },
  };

  enqueueTelegramToolProgressMessage({
    bot,
    runs,
    chatJid: 'telegram:1',
    requestId: 'run-1',
    mode: 'all',
    event: {
      toolName: 'bash',
      status: 'start',
      args: '{"command":"git status"}',
    },
  });

  const run = runs.get(getTelegramToolProgressKey('telegram:1', 'run-1'));
  await run?.chain;

  assert.equal(sent.length, 1);
  assert.equal(edited.length, 0);
  assert.match(sent[0] || '', /Tool progress/i);
  assert.match(sent[0] || '', /git status/i);
});

test('enqueueTelegramToolProgressMessage edits the existing standalone progress message on later events', async () => {
  const runs = new Map<string, TelegramToolProgressState>();
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

  enqueueTelegramToolProgressMessage({
    bot,
    runs,
    chatJid: 'telegram:1',
    requestId: 'run-2',
    mode: 'verbose',
    event: {
      toolName: 'read_file',
      status: 'start',
      args: '{"path":"src/index.ts"}',
    },
  });
  await runs.get(getTelegramToolProgressKey('telegram:1', 'run-2'))?.chain;

  enqueueTelegramToolProgressMessage({
    bot,
    runs,
    chatJid: 'telegram:1',
    requestId: 'run-2',
    mode: 'verbose',
    event: {
      toolName: 'read_file',
      status: 'ok',
      output: 'export const x = 1;',
    },
  });
  await runs.get(getTelegramToolProgressKey('telegram:1', 'run-2'))?.chain;

  assert.equal(sent.length, 1);
  assert.equal(edited.length, 1);
  assert.equal(edited[0]?.messageId, 777);
  assert.match(edited[0]?.text || '', /export const x = 1/i);
});

test('buildTelegramToolProgressMessage keeps a stable header', () => {
  assert.equal(
    buildTelegramToolProgressMessage(['🔥 bash: "git status"']),
    'Tool progress\n🔥 bash: "git status"',
  );
});

test('shouldUseStandaloneTelegramToolProgress is disabled for draft and off delivery', () => {
  assert.equal(
    shouldUseStandaloneTelegramToolProgress({
      deliveryMode: 'partial',
      verboseMode: 'all',
    }),
    true,
  );
  assert.equal(
    shouldUseStandaloneTelegramToolProgress({
      deliveryMode: 'draft',
      verboseMode: 'all',
    }),
    false,
  );
  assert.equal(
    shouldUseStandaloneTelegramToolProgress({
      deliveryMode: 'off',
      verboseMode: 'verbose',
    }),
    false,
  );
});

test('shouldUseTelegramPreviewToolTrail is enabled for draft all and verbose', () => {
  assert.equal(
    shouldUseTelegramPreviewToolTrail({
      deliveryMode: 'draft',
      verboseMode: 'all',
    }),
    true,
  );
  assert.equal(
    shouldUseTelegramPreviewToolTrail({
      deliveryMode: 'draft',
      verboseMode: 'verbose',
    }),
    true,
  );
  assert.equal(
    shouldUseTelegramPreviewToolTrail({
      deliveryMode: 'partial',
      verboseMode: 'verbose',
    }),
    false,
  );
});

test('buildTelegramPreviewToolTrailEntry keeps draft trail concise', () => {
  assert.equal(
    buildTelegramPreviewToolTrailEntry(
      {
        toolName: 'bash',
        status: 'start',
        args: '{"command":"git status"}',
      },
      'all',
    ),
    '🔥 bash',
  );
  assert.equal(
    buildTelegramPreviewToolTrailEntry(
      {
        toolName: 'bash',
        status: 'start',
        args: '{"command":"git status"}',
      },
      'verbose',
    ),
    '🔥 bash: "git status"',
  );
});

test('finalizeTelegramToolProgressRun removes queued progress state without awaiting completion', () => {
  let resolveChain: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => {
    resolveChain = resolve;
  });
  const runs = new Map<string, TelegramToolProgressState>();
  runs.set('telegram:1::run-3', {
    messageId: 99,
    lines: ['Tool progress'],
    chain: pending,
  });

  finalizeTelegramToolProgressRun(runs, 'telegram:1::run-3');

  assert.equal(runs.has('telegram:1::run-3'), false);
  resolveChain?.();
});
