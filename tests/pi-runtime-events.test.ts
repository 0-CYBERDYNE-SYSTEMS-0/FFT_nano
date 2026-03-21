import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PiRuntimeEventHub,
  createOrderedPiRuntimeEventProcessor,
  invokePiRuntimeEventHandlerSafely,
} from '../src/pi-runtime-events.js';

test('PiRuntimeEventHub emits to subscribers and supports unsubscribe', () => {
  const hub = new PiRuntimeEventHub();
  const seen: string[] = [];

  const unsubscribe = hub.subscribe((event) => {
    seen.push(event.kind);
  });

  hub.emit({
    kind: 'telegram_preview_update',
    payload: {
      chatJid: 'telegram:1',
      requestId: 'run-1',
      text: 'hello',
    },
  });
  unsubscribe();
  hub.emit({
    kind: 'agent_message',
    payload: {
      chatJid: 'telegram:1',
      requestId: 'run-1',
      text: 'done',
    },
  });

  assert.deepEqual(seen, ['telegram_preview_update']);
});

test('invokePiRuntimeEventHandlerSafely catches async delivery failures', async () => {
  const seen: string[] = [];

  invokePiRuntimeEventHandlerSafely(
    async () => {
      throw new Error('telegram failed');
    },
    {
      kind: 'agent_message',
      payload: {
        chatJid: 'telegram:1',
        text: 'hello',
      },
    },
    (err) => {
      seen.push(err instanceof Error ? err.message : String(err));
    },
  );

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(seen, ['telegram failed']);
});

test('createOrderedPiRuntimeEventProcessor preserves event order across async handlers', async () => {
  const seen: string[] = [];
  let releaseFirst: (() => void) | undefined;
  const firstDone = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const processor = createOrderedPiRuntimeEventProcessor(
    async (event) => {
      seen.push(`start:${event.kind}`);
      if (event.kind === 'telegram_preview_update') {
        await firstDone;
      }
      seen.push(`end:${event.kind}`);
    },
    () => {},
  );

  processor({
    kind: 'telegram_preview_update',
    payload: {
      chatJid: 'telegram:1',
      requestId: 'run-1',
      text: 'preview',
    },
  });
  processor({
    kind: 'agent_message',
    payload: {
      chatJid: 'telegram:1',
      requestId: 'run-1',
      text: 'final',
    },
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(seen, ['start:telegram_preview_update']);
  releaseFirst?.();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(seen, [
    'start:telegram_preview_update',
    'end:telegram_preview_update',
    'start:agent_message',
    'end:agent_message',
  ]);
});
