import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  closeDatabase,
  createAgentRun,
  getAgentRunById,
  initDatabaseAtPath,
  listAgentRunsForChat,
  updateAgentRun,
} from '../src/db.js';
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
    resolveWorkspacePath: () => os.tmpdir(),
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
          return {
            ok: true,
            result: 'done',
            streamed: false,
            usage: { totalTokens: 12, provider: 'zai', model: 'glm-4.7' },
          };
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
    const completedRun = getAgentRunById(runId);
    assert.equal(completedRun?.provider, 'zai');
    assert.equal(completedRun?.model, 'glm-4.7');
  });
});

test('long run service forwards assistant draft deltas to live clients', async () => {
  await withTempDb(async () => {
    const typingEvents: Array<{ chatJid: string; typing: boolean }> = [];
    const tuiChatEvents: Array<{
      state?: string;
      message?: { role?: string; content?: string };
    }> = [];
    let sawPreviewStreamingEnabled = false;
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
        ) => {
          sawPreviewStreamingEnabled =
            (options as { suppressPreviewStreaming?: boolean })
              .suppressPreviewStreaming !== true;
          const onProgressEvent = (
            options as {
              onProgressEvent?: (event: ContainerProgressEvent) => void;
            }
          ).onProgressEvent;
          onProgressEvent?.({
            kind: 'assistant',
            at: Date.now(),
            text: 'I am checking the long-run stream now.',
          });
          return { ok: true, result: 'done', streamed: true };
        },
        typingEvents,
      ),
      emitTuiChatEvent: (event) => {
        tuiChatEvents.push(event);
      },
    });

    await service.startRun('telegram:1', 'stream progress', {
      id: 'run-delta',
    });
    await waitFor(
      () => tuiChatEvents.some((event) => event.state === 'delta'),
      'assistant delta event',
    );

    assert.equal(sawPreviewStreamingEnabled, true);
    assert.equal(
      tuiChatEvents.some(
        (event) =>
          event.state === 'delta' &&
          event.message?.role === 'assistant' &&
          event.message.content?.includes('long-run stream'),
      ),
      true,
    );
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

test('starting a long run records its durable workspace as worktree_path', async () => {
  await withTempDb(async () => {
    const typingEvents: Array<{ chatJid: string; typing: boolean }> = [];
    let releaseRun: (() => void) | null = null;
    const service = createLongRunService({
      ...createDeps(async () => {
        await new Promise<void>((resolve) => {
          releaseRun = resolve;
        });
        return { ok: true, result: 'done', streamed: false };
      }, typingEvents),
      resolveWorkspacePath: () => '/tmp/fft-workspace-main',
    });

    await service.startRun('telegram:1', 'do durable work', {
      id: 'run-wt',
    });
    await waitFor(
      () => getAgentRunById('run-wt')?.worktree_path != null,
      'worktree_path to be recorded once running',
    );
    assert.equal(
      getAgentRunById('run-wt')?.worktree_path,
      '/tmp/fft-workspace-main',
    );
    releaseRun?.();
  });
});

test('resumeRecoverableRuns re-enqueues a recoverable run and marks the source resumed', async () => {
  await withTempDb(async () => {
    const typingEvents: Array<{ chatJid: string; typing: boolean }> = [];
    const prompts: string[] = [];
    const service = createLongRunService(
      createDeps(async (_group, prompt) => {
        prompts.push(prompt);
        return { ok: true, result: 'done', streamed: false };
      }, typingEvents),
    );

    // Seed a run that a restart preserved as recoverable.
    createAgentRun({
      id: 'run-interrupted',
      chatJid: 'telegram:1',
      groupFolder: 'main',
      kind: 'agent_long',
      prompt: 'original durable task',
    });
    updateAgentRun('run-interrupted', {
      status: 'interrupted',
      recovery_state: 'recoverable',
    });

    const outcome = await service.resumeRecoverableRuns();
    assert.equal(outcome.resumed, 1);
    assert.equal(outcome.abandoned, 0);

    // Source no longer eligible for re-resume.
    assert.equal(
      getAgentRunById('run-interrupted')?.recovery_state,
      'resumed',
    );

    // A new continuation run was created carrying the original prompt + attempt.
    const runs = listAgentRunsForChat('telegram:1', 10);
    const resumedRun = runs.find((r) => r.id !== 'run-interrupted');
    assert.ok(resumedRun, 'expected a new resumed run');
    assert.equal(resumedRun?.resume_attempts, 1);

    await waitFor(
      () => prompts.some((p) => p.includes('original durable task')),
      'resumed run to execute with original prompt',
    );
    assert.ok(prompts[0]?.includes('resuming an interrupted long run'));
  });
});

test('resumeRecoverableRuns abandons a run that has hit the resume cap', async () => {
  const prev = process.env.FFT_NANO_LONG_RUN_MAX_RESUMES;
  process.env.FFT_NANO_LONG_RUN_MAX_RESUMES = '2';
  try {
    await withTempDb(async () => {
      const typingEvents: Array<{ chatJid: string; typing: boolean }> = [];
      let runAgentCalls = 0;
      const service = createLongRunService(
        createDeps(async () => {
          runAgentCalls += 1;
          return { ok: true, result: 'done', streamed: false };
        }, typingEvents),
      );

      createAgentRun({
        id: 'run-looping',
        chatJid: 'telegram:1',
        groupFolder: 'main',
        kind: 'agent_long',
        prompt: 'task that keeps crashing the host',
        resumeAttempts: 2,
      });
      updateAgentRun('run-looping', {
        status: 'interrupted',
        recovery_state: 'recoverable',
      });

      const outcome = await service.resumeRecoverableRuns();
      assert.equal(outcome.resumed, 0);
      assert.equal(outcome.abandoned, 1);
      assert.equal(
        getAgentRunById('run-looping')?.recovery_state,
        'resumed',
      );
      assert.equal(listAgentRunsForChat('telegram:1', 10).length, 1);
      assert.equal(runAgentCalls, 0);
    });
  } finally {
    if (prev === undefined) delete process.env.FFT_NANO_LONG_RUN_MAX_RESUMES;
    else process.env.FFT_NANO_LONG_RUN_MAX_RESUMES = prev;
  }
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
