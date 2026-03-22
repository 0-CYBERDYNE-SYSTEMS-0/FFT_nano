import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HostEventBus,
  createOrderedHostEventProcessor,
  invokeHostEventHandlerSafely,
} from '../src/runtime/host-events.js';

test('HostEventBus publishes to subscribers and supports unsubscribe', () => {
  const bus = new HostEventBus();
  const seen: string[] = [];

  const unsubscribe = bus.subscribe((event) => {
    seen.push(event.kind);
  });

  bus.publish({
    kind: 'telegram_preview_requested',
    id: 'evt-1',
    createdAt: '2026-03-21T00:00:00.000Z',
    source: 'pi-runner',
    chatJid: 'telegram:1',
    requestId: 'run-1',
    text: 'hello',
  });
  unsubscribe();
  bus.publish({
    kind: 'chat_delivery_requested',
    id: 'evt-2',
    createdAt: '2026-03-21T00:00:01.000Z',
    source: 'pi-runner',
    chatJid: 'telegram:1',
    text: 'done',
  });

  assert.deepEqual(seen, ['telegram_preview_requested']);
});

test('invokeHostEventHandlerSafely catches async delivery failures', async () => {
  const seen: string[] = [];

  invokeHostEventHandlerSafely(
    async () => {
      throw new Error('delivery failed');
    },
    {
      kind: 'chat_delivery_requested',
      id: 'evt-1',
      createdAt: '2026-03-21T00:00:00.000Z',
      source: 'pi-runner',
      chatJid: 'telegram:1',
      text: 'hello',
    },
    (err) => {
      seen.push(err instanceof Error ? err.message : String(err));
    },
  );

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(seen, ['delivery failed']);
});

test('createOrderedHostEventProcessor preserves event order across async handlers', async () => {
  const seen: string[] = [];
  let releaseFirst: (() => void) | undefined;
  const firstDone = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const processor = createOrderedHostEventProcessor(
    async (event) => {
      seen.push(`start:${event.kind}`);
      if (event.kind === 'telegram_preview_requested') {
        await firstDone;
      }
      seen.push(`end:${event.kind}`);
    },
    () => {},
  );

  processor({
    kind: 'telegram_preview_requested',
    id: 'evt-1',
    createdAt: '2026-03-21T00:00:00.000Z',
    source: 'pi-runner',
    chatJid: 'telegram:1',
    requestId: 'run-1',
    text: 'preview',
  });
  processor({
    kind: 'chat_delivery_requested',
    id: 'evt-2',
    createdAt: '2026-03-21T00:00:01.000Z',
    source: 'pi-runner',
    chatJid: 'telegram:1',
    requestId: 'run-1',
    text: 'final',
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(seen, ['start:telegram_preview_requested']);
  releaseFirst?.();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(seen, [
    'start:telegram_preview_requested',
    'end:telegram_preview_requested',
    'start:chat_delivery_requested',
    'end:chat_delivery_requested',
  ]);
});

test('createOrderedHostEventProcessor lets callers await handler failures', async () => {
  const seen: string[] = [];
  const processor = createOrderedHostEventProcessor(
    async (event) => {
      if (event.kind === 'task_requested') {
        throw new Error('task failed');
      }
      seen.push(event.kind);
    },
    (err) => {
      seen.push(err instanceof Error ? err.message : String(err));
    },
  );

  await assert.rejects(
    processor({
      kind: 'task_requested',
      id: 'evt-1',
      createdAt: '2026-03-21T00:00:00.000Z',
      source: 'test',
      sourceGroup: 'group-a',
      isMain: false,
      request: { type: 'schedule_task' },
    }),
    /task failed/,
  );

  await processor({
    kind: 'chat_delivery_requested',
    id: 'evt-2',
    createdAt: '2026-03-21T00:00:01.000Z',
    source: 'test',
    chatJid: 'telegram:1',
    text: 'done',
  });

  assert.deepEqual(seen, ['task failed', 'chat_delivery_requested']);
});
