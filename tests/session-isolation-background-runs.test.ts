/**
 * Background runs (heartbeat, evaluator, isolated scheduled tasks) must use
 * ephemeral pi sessions so they never become the group's most-recent session.
 *
 * Regression: heartbeat runs persisted sessions into the shared session dir;
 * the next interactive `-c` run resumed the heartbeat conversation and the
 * agent answered HEARTBEAT_OK to real user messages.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

import { closeDatabase, createTask, initDatabaseAtPath } from '../src/db.js';
import { processDueTasksOnce } from '../src/task-scheduler.js';
import { buildEvaluatorContainerInput } from '../src/evaluator.js';
import { initAgentRunner, runAgent } from '../src/agent-runner.js';
import { state } from '../src/app-state.js';
import type { ContainerInput } from '../src/pi-runner.js';
import { createTelegramBot } from '../src/telegram.js';
import type { RegisteredGroup } from '../src/types.js';

function setupTempDb(): { cleanup: () => void } {
  const projectTmp = path.join(process.cwd(), 'data', 'test-db-temp');
  fs.mkdirSync(projectTmp, { recursive: true });
  const dir = path.join(
    projectTmp,
    `fft-test-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
  );
  fs.mkdirSync(dir, { recursive: true });
  initDatabaseAtPath(path.join(dir, 'messages.db'));
  return {
    cleanup: () => {
      closeDatabase();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

function makeGroup(folder: string): RegisteredGroup {
  return {
    name: `Group ${folder}`,
    folder,
    trigger: '@FarmFriend',
    added_at: new Date().toISOString(),
  };
}

test('evaluator container input is session-ephemeral and non-continuing', () => {
  const input = buildEvaluatorContainerInput({
    runType: 'chat',
    originalTask: 'say hi',
    agentOutput: 'hi',
    durationMs: 100,
    toolsInvoked: 0,
    group: makeGroup('main'),
    chatJid: 'telegram:1',
    isMain: true,
  });
  assert.equal(input.sessionPersistence, 'ephemeral');
  assert.equal(input.noContinue, true);
});

test('isolated scheduled task runs session-ephemeral; group task does not', async () => {
  const { cleanup } = setupTempDb();
  try {
    const captured: ContainerInput[] = [];
    const runTaskAgent = (async (
      _group: RegisteredGroup,
      input: ContainerInput,
    ) => {
      captured.push(input);
      return { status: 'success' as const, result: 'done' };
    }) as unknown as Parameters<typeof processDueTasksOnce>[0]['runTaskAgent'];

    for (const [id, contextMode] of [
      ['task-isolated', 'isolated'],
      ['task-group', 'group'],
    ] as const) {
      createTask({
        id,
        group_folder: 'main',
        chat_jid: 'telegram:100',
        prompt: 'Do work',
        schedule_type: 'once',
        schedule_value: new Date(Date.now() - 1000).toISOString(),
        context_mode: contextMode,
        next_run: new Date(Date.now() - 1000).toISOString(),
        status: 'active',
        created_at: new Date().toISOString(),
      });
      await processDueTasksOnce({
        sendMessage: async () => true,
        registeredGroups: () => ({ 'telegram:100': makeGroup('main') }),
        runTaskAgent,
        runEvaluatorPass: (async () => null) as never,
      });
    }

    assert.equal(captured.length, 2);
    const [isolated, grouped] = captured;
    assert.equal(isolated.sessionPersistence, 'ephemeral');
    assert.equal(isolated.noContinue, true);
    assert.equal(grouped.sessionPersistence, undefined);
    assert.equal(grouped.noContinue, false);
  } finally {
    cleanup();
  }
});

test('heartbeat runAgent maps to ephemeral non-continuing container input', async () => {
  const { cleanup } = setupTempDb();
  try {
    const captured: ContainerInput[] = [];
    initAgentRunner({
      statusTelemetry: { noteRuntimeError: () => {} },
      getSessionKeyForChat: () => 'session-key',
      emitTuiToolEvent: () => {},
      handlePermissionGateRequest: async () =>
        ({
          requestId: 'x',
          ok: true,
        }) as never,
      updateChatRunPreferences: (_jid, updater) => updater({}),
      updateChatUsage: () => {},
      setTyping: async () => {},
      sendMessage: async () => true,
      runContainerAgentImpl: (async (
        _group: RegisteredGroup,
        input: ContainerInput,
      ) => {
        captured.push(input);
        return { status: 'success' as const, result: 'HEARTBEAT_OK' };
      }) as never,
    });

    const ret = await runAgent(
      makeGroup('main'),
      'heartbeat poll',
      'telegram:100',
      'none',
      'heartbeat-test-1',
      {},
      { isHeartbeatTask: true, suppressErrorReply: true },
    );

    assert.equal(ret.ok, true);
    assert.ok(captured.length >= 1);
    for (const input of captured) {
      assert.equal(input.sessionPersistence, 'ephemeral');
      assert.equal(input.noContinue, true);
      assert.equal(input.isHeartbeatTask, true);
    }
  } finally {
    cleanup();
  }
});

test('runAgent retracts a sealed Telegram segment when the final result is NO_REPLY', async () => {
  const { cleanup } = setupTempDb();
  const originalTelegramBot = state.telegramBot;
  const deletedMessageIds: number[] = [];
  const bot = createTelegramBot({ token: 'test-token' });
  let messageId = 0;
  bot.sendStreamMessage = async () => ++messageId;
  bot.editStreamMessage = async () => {};
  bot.deleteMessage = async (_chatJid, id) => {
    deletedMessageIds.push(id);
  };
  state.telegramBot = bot;

  try {
    initAgentRunner({
      statusTelemetry: { noteRuntimeError: () => {} },
      getSessionKeyForChat: () => 'session-key',
      emitTuiToolEvent: () => {},
      handlePermissionGateRequest: async () =>
        ({
          requestId: 'x',
          ok: true,
        }) as never,
      updateChatRunPreferences: (_jid, updater) => updater({}),
      updateChatUsage: () => {},
      setTyping: async () => {},
      sendMessage: async () => true,
      runContainerAgentImpl: async (
        _group,
        _input,
        _abortSignal,
        onRuntimeEvent,
        _onExtensionUIRequest,
        onProgressEvent,
      ) => {
        onProgressEvent?.({
          kind: 'delta',
          at: Date.now(),
          text: 'Sensitive partial response that is long enough to stream.',
        });
        await new Promise((resolve) => setTimeout(resolve, 20));
        onRuntimeEvent?.({
          kind: 'tool',
          index: 0,
          toolName: 'Bash',
          status: 'start',
        });
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { status: 'success', result: 'NO_REPLY' };
      },
    });

    const result = await runAgent(
      makeGroup('main'),
      'run silently',
      'telegram:100',
      'none',
      'sealed-silence-run',
      { telegramDeliveryMode: 'stream' },
      { suppressErrorReply: true },
    );

    assert.equal(result.result, 'NO_REPLY');
    assert.deepEqual(deletedMessageIds, [1, 2]);
  } finally {
    state.telegramBot = originalTelegramBot;
    cleanup();
  }
});
