import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { closeDatabase, initDatabaseAtPath } from '../src/db.js';
import {
  createLongRunService,
  type LongRunServiceDeps,
} from '../src/long-run-service.js';
import type { ContainerProgressEvent } from '../src/pi-runner.js';
import type { RegisteredGroup } from '../src/types.js';

const group: RegisteredGroup = {
  name: 'Main',
  folder: 'main',
  trigger: '@FarmFriend',
  added_at: '2026-05-24T00:00:00.000Z',
};

async function waitFor(
  predicate: () => boolean,
  label: string,
  timeoutMs = 1000,
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`Timed out waiting for ${label}`);
}

function withTempDb(fn: () => Promise<void>): Promise<void> {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-long-runs-'));
  const dbPath = path.join(tmpRoot, 'messages.db');
  initDatabaseAtPath(dbPath);
  return fn().finally(() => {
    closeDatabase();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });
}

function createDeps(
  runAgent: LongRunServiceDeps['runAgent'],
  typingEvents: Array<{ chatJid: string; typing: boolean }>,
  timeline: string[] = [],
  sentMessages: string[] = [],
): LongRunServiceDeps {
  return {
    getGroupForChat: () => group,
    isMainChat: () => true,
    getSessionKeyForChat: (chatJid) => chatJid,
    sendMessage: async (_chatJid, text) => {
      timeline.push('sendMessage');
      sentMessages.push(text);
      return true;
    },
    sendAgentResultMessage: async () => true,
    setTyping: async (chatJid, typing) => {
      typingEvents.push({ chatJid, typing });
    },
    persistAssistantHistory: () => {},
    updateChatUsage: () => {},
    emitRunProgress: () => {
      timeline.push('runProgress');
    },
    emitTuiChatEvent: () => {},
    emitTuiAgentEvent: () => {},
    runAgent,
    getRuntimePrefs: () => ({}),
    logger: {},
  };
}

test('long run service keeps typing active until successful completion', async () => {
  await withTempDb(async () => {
    const typingEvents: Array<{ chatJid: string; typing: boolean }> = [];
    const service = createLongRunService(
      createDeps(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { ok: true, result: 'done', streamed: false };
      }, typingEvents),
    );

    await service.startRun('telegram:1', 'finish this', { id: 'run-ok' });
    await waitFor(
      () => typingEvents.some((event) => event.typing === false),
      'typing stop after completion',
    );

    assert.deepEqual(typingEvents, [
      { chatJid: 'telegram:1', typing: true },
      { chatJid: 'telegram:1', typing: false },
    ]);
  });
});

test('exact /run query starts durable run and status can be polled while progress updates', async () => {
  await withTempDb(async () => {
    const exactQuery =
      '/run verify long-run telemetry with bash progress polling';
    const typingEvents: Array<{ chatJid: string; typing: boolean }> = [];
    const timeline: string[] = [];
    const sentMessages: string[] = [];
    const progressEvents: Array<{
      phase: string;
      text: string;
      detail?: string;
    }> = [];
    let releaseRun: (() => void) | null = null;
    const service = createLongRunService({
      ...createDeps(
        async (
          _group,
          _prompt,
          _chatJid,
          _codingHint,
          _requestId,
          _prefs,
          options,
          abortSignal,
        ) => {
          const onProgressEvent = (
            options as {
              onProgressEvent?: (event: ContainerProgressEvent) => void;
            }
          ).onProgressEvent;
          onProgressEvent?.({
            kind: 'tool',
            at: Date.now(),
            toolName: 'bash',
            status: 'start',
          });
          await new Promise<void>((resolve, reject) => {
            releaseRun = resolve;
            abortSignal.addEventListener('abort', () => {
              reject(new Error('aborted by user'));
            });
          });
          return { ok: true, result: 'done', streamed: false };
        },
        typingEvents,
        timeline,
        sentMessages,
      ),
      emitRunProgress: (payload) => {
        timeline.push('runProgress');
        progressEvents.push({
          phase: payload.phase,
          text: payload.text,
          detail: payload.detail,
        });
      },
    });

    const handled = await service.handleCommand('telegram:1', exactQuery);
    assert.equal(handled, true);
    assert.match(
      sentMessages[0] || '',
      /^Started long run run-\d+-[a-z0-9]+\. I'll post the result here\.$/,
    );
    const runId = sentMessages[0]?.match(/Started long run ([^.]+)\./)?.[1];
    assert.ok(runId);

    await waitFor(
      () =>
        service.statusText('telegram:1', runId).includes('Phase: tool_running'),
      'durable status to show tool_running',
    );

    const runningStatus = service.statusText('telegram:1', runId);
    assert.match(runningStatus, new RegExp(`Run ${runId}: running`));
    assert.match(runningStatus, /Phase: tool_running/);
    assert.match(runningStatus, /Detail: bash/);
    assert.match(runningStatus, /Last progress: 20\d\d-/);
    assert.match(service.listRunsText('telegram:1'), new RegExp(runId));
    assert.equal(typingEvents.at(-1)?.typing, true);
    assert.deepEqual(timeline.slice(0, 2), ['sendMessage', 'runProgress']);
    assert.equal(
      progressEvents.some(
        (event) =>
          event.phase === 'tool_running' &&
          event.detail === 'bash' &&
          /Running bash/.test(event.text),
      ),
      true,
    );

    releaseRun?.();
    await waitFor(
      () =>
        service
          .statusText('telegram:1', runId)
          .includes(`Run ${runId}: completed`),
      'durable status to show completed',
    );
    assert.equal(typingEvents.at(-1)?.typing, false);
  });
});

test('long run service stops typing after failed run', async () => {
  await withTempDb(async () => {
    const typingEvents: Array<{ chatJid: string; typing: boolean }> = [];
    const service = createLongRunService(
      createDeps(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { ok: false, result: 'provider failed', streamed: false };
      }, typingEvents),
    );

    await service.startRun('telegram:1', 'fail this', { id: 'run-failed' });
    await waitFor(
      () => typingEvents.some((event) => event.typing === false),
      'typing stop after failure',
    );

    assert.deepEqual(typingEvents, [
      { chatJid: 'telegram:1', typing: true },
      { chatJid: 'telegram:1', typing: false },
    ]);
  });
});

test('long run service stops typing after aborted run', async () => {
  await withTempDb(async () => {
    const typingEvents: Array<{ chatJid: string; typing: boolean }> = [];
    const service = createLongRunService(
      createDeps(
        async (_group, _prompt, _chatJid, _codingHint, _requestId, _prefs, _options, abortSignal) =>
          new Promise((resolve, reject) => {
            abortSignal.addEventListener('abort', () => {
              reject(new Error('aborted by user'));
            });
            setTimeout(() => {
              resolve({ ok: true, result: 'late', streamed: false });
            }, 500);
          }),
        typingEvents,
      ),
    );

    await service.startRun('telegram:1', 'abort this', { id: 'run-aborted' });
    await waitFor(
      () => typingEvents.some((event) => event.typing === true),
      'typing start before abort',
    );
    await service.cancelRun('telegram:1', 'run-aborted');
    await waitFor(
      () => typingEvents.some((event) => event.typing === false),
      'typing stop after abort',
    );

    assert.deepEqual(typingEvents, [
      { chatJid: 'telegram:1', typing: true },
      { chatJid: 'telegram:1', typing: false },
    ]);
  });
});

test('long run /run command acknowledges before status preview progress', async () => {
  await withTempDb(async () => {
    const typingEvents: Array<{ chatJid: string; typing: boolean }> = [];
    const timeline: string[] = [];
    const service = createLongRunService(
      createDeps(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { ok: true, result: 'done', streamed: false };
      }, typingEvents, timeline),
    );

    const handled = await service.handleCommand('telegram:1', '/run inspect');
    assert.equal(handled, true);
    await waitFor(
      () => timeline.includes('runProgress'),
      'run progress after ack',
    );

    assert.deepEqual(timeline.slice(0, 2), ['sendMessage', 'runProgress']);
  });
});
