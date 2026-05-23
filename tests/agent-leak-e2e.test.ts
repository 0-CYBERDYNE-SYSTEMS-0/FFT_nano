import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';
import WebSocket from 'ws';

import {
  createMessageDispatcher,
  finalizeCompletedRun,
} from '../src/message-dispatch.js';
import { runContainerAgent } from '../src/pi-runner.ts';
import {
  dispatchLegacyMessageEnvelope,
  wrapLegacyMessageEnvelope,
} from '../src/runtime/boundary-ipc.js';
import {
  createStatusTelemetry,
  formatStatusReport,
} from '../src/status-report.ts';
import type { RegisteredGroup } from '../src/types.ts';

function assertNoEvaluatorLeak(text: string, label: string): void {
  assert.doesNotMatch(
    text,
    /\{"pass":false,"score":1,"issues":\["missing artifact"\],"feedback":"retry"\}/,
    label,
  );
  assert.doesNotMatch(text, /"pass"\s*:/, label);
  assert.doesNotMatch(text, /\bpass\s*:/i, label);
  assert.doesNotMatch(text, /"score"\s*:/, label);
  assert.doesNotMatch(text, /\bscore\s+\d+\/10\b/i, label);
  assert.doesNotMatch(text, /"issues"\s*:/, label);
  assert.doesNotMatch(text, /\bissues?\b.*missing artifact/i, label);
  assert.doesNotMatch(text, /"feedback"\s*:/, label);
  assert.doesNotMatch(text, /internal evaluator feedback/i, label);
}

function makeLeakAttemptPiExecutable(params: {
  dir: string;
  messagesDir: string;
  requestId: string;
  chatJid: string;
  verdictJson: string;
}): string {
  const executablePath = path.join(params.dir, 'fake-pi-leak-attempt.js');
  fs.writeFileSync(
    executablePath,
    `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const messagesDir = ${JSON.stringify(params.messagesDir)};
fs.mkdirSync(messagesDir, { recursive: true });
fs.writeFileSync(
  path.join(messagesDir, 'raw-evaluator-verdict.json'),
  JSON.stringify({
    type: 'message',
    chatJid: ${JSON.stringify(params.chatJid)},
    requestId: ${JSON.stringify(params.requestId)},
    text: ${JSON.stringify(params.verdictJson)}
  })
);
process.stdout.write(JSON.stringify({
  type: 'message_end',
  message: {
    role: 'assistant',
    content: [{ type: 'text', text: ${JSON.stringify(params.verdictJson)} }],
  },
}) + '\\n');
setTimeout(() => process.exit(0), 10);
`,
    'utf8',
  );
  fs.chmodSync(executablePath, 0o755);
  return executablePath;
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
    server.once('error', reject);
  });
}

function startFakeTelegramApi(): Promise<{
  baseUrl: string;
  sentMessages: string[];
  enqueueUpdate: (text: string) => void;
  close: () => Promise<void>;
}> {
  return new Promise((resolve, reject) => {
    const sentMessages: string[] = [];
    const pendingUpdates: unknown[] = [];
    let nextUpdateId = 1000;
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      const method = url.pathname.split('/').pop() || '';
      const chunks: Buffer[] = [];

      req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      req.on('end', () => {
        let body: any = {};
        const rawBody = Buffer.concat(chunks).toString('utf8');
        if (rawBody) {
          try {
            body = JSON.parse(rawBody);
          } catch {
            body = {};
          }
        }

        if (method === 'sendMessage') {
          sentMessages.push(String(body.text || ''));
        }

        const json = (payload: unknown) => {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify(payload));
        };

        if (method === 'getMe') {
          json({ ok: true, result: { id: 1, username: 'FarmFriendBot' } });
          return;
        }
        if (method === 'getUpdates') {
          const result = pendingUpdates.splice(0, pendingUpdates.length);
          setTimeout(() => json({ ok: true, result }), 25);
          return;
        }
        if (method === 'sendChatAction') {
          json({ ok: true, result: true });
          return;
        }
        if (method === 'setMyCommands' || method === 'deleteMyCommands') {
          json({ ok: true, result: true });
          return;
        }
        json({ ok: true, result: true });
      });
    });

    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        sentMessages,
        enqueueUpdate: (text: string) => {
          pendingUpdates.push({
            update_id: nextUpdateId++,
            message: {
              message_id: nextUpdateId,
              date: Math.floor(Date.now() / 1000),
              chat: { id: 424242, type: 'private', title: 'Leak Runtime' },
              from: {
                id: 424242,
                is_bot: false,
                first_name: 'Tester',
              },
              text,
            },
          });
        },
        close: () =>
          new Promise<void>((closeResolve) => {
            server.close(() => closeResolve());
          }),
      });
    });
  });
}

function makeRuntimeSmokePiExecutable(params: { dir: string }): string {
  const executablePath = path.join(params.dir, 'fake-pi-runtime-smoke.js');
  const counterPath = path.join(params.dir, 'fake-pi-counter.json');
  fs.writeFileSync(
    executablePath,
    `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const counterPath = ${JSON.stringify(counterPath)};
let count = 0;
try { count = JSON.parse(fs.readFileSync(counterPath, 'utf8')).count || 0; } catch {}
count += 1;
fs.writeFileSync(counterPath, JSON.stringify({ count }));
const verdict = ${JSON.stringify({
      pass: false,
      score: 1,
      issues: ['missing artifact'],
      feedback: 'retry',
    })};
const verdictJson = JSON.stringify(verdict);
const rootDir = path.resolve(process.cwd(), '..', '..');
const messagesDir = path.join(rootDir, 'data', 'ipc', 'main', 'messages');
function emitAssistant(text) {
  process.stdout.write(JSON.stringify({
    type: 'message_end',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text }],
    },
  }) + '\\n');
}
if (count % 2 === 0) {
  fs.mkdirSync(messagesDir, { recursive: true });
  fs.writeFileSync(
    path.join(messagesDir, 'raw-evaluator-verdict-' + count + '.json'),
    JSON.stringify({
      type: 'message',
      chatJid: process.env.FFT_NANO_CHAT_JID || 'telegram:424242',
      requestId: process.env.FFT_NANO_REQUEST_ID || 'runtime-smoke',
      text: verdictJson,
    })
  );
  emitAssistant(verdictJson);
} else {
  emitAssistant(
    'Created /tmp/nonexistent-proof-artifact.html and verified it is ready to open. ' +
    'Open it at /tmp/nonexistent-proof-artifact.html. '.repeat(40)
  );
}
setTimeout(() => process.exit(0), 10);
`,
    'utf8',
  );
  fs.chmodSync(executablePath, 0o755);
  return executablePath;
}

function waitForHttpOk(url: string, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const probe = () => {
      fetch(url)
        .then((res) => {
          if (res.ok) {
            resolve();
            return;
          }
          throw new Error(`HTTP ${res.status}`);
        })
        .catch((err) => {
          if (Date.now() - startedAt >= timeoutMs) {
            reject(err instanceof Error ? err : new Error(String(err)));
            return;
          }
          setTimeout(probe, 100);
        });
    };
    probe();
  });
}

function connectWs(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function sendWsRequest(
  ws: WebSocket,
  id: string,
  method: string,
  params: Record<string, unknown> = {},
): void {
  ws.send(JSON.stringify({ id, method, params }));
}

function waitForWsResponse(
  ws: WebSocket,
  id: string,
  seenFrames: unknown[],
  timeoutMs = 10_000,
): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', onMessage);
      reject(new Error(`Timed out waiting for websocket response ${id}`));
    }, timeoutMs);
    const onMessage = (raw: WebSocket.RawData) => {
      const frame = JSON.parse(raw.toString('utf8'));
      seenFrames.push(frame);
      if (frame.id === id) {
        clearTimeout(timer);
        ws.off('message', onMessage);
        resolve(frame);
      }
    };
    ws.on('message', onMessage);
  });
}

function waitForWsFrame(
  ws: WebSocket,
  predicate: (frame: any) => boolean,
  seenFrames: unknown[],
  timeoutMs = 15_000,
): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', onMessage);
      reject(new Error('Timed out waiting for websocket frame'));
    }, timeoutMs);
    const onMessage = (raw: WebSocket.RawData) => {
      const frame = JSON.parse(raw.toString('utf8'));
      seenFrames.push(frame);
      if (predicate(frame)) {
        clearTimeout(timer);
        ws.off('message', onMessage);
        resolve(frame);
      }
    };
    ws.on('message', onMessage);
  });
}

async function terminateChild(
  child: ChildProcessWithoutNullStreams,
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
      }
      resolve();
    }, 2_000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

test(
  'direct agent interaction does not expose evaluator verdict JSON through chat IPC TUI or status',
  { timeout: 7000, concurrency: false },
  async (t) => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-agent-leak-'));
    const workspaceDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'fft-agent-workspace-'),
    );
    const groupFolder = `agent_leak_${Date.now().toString(36)}`;
    const chatJid = 'telegram:leak-e2e';
    const requestId = `leak-e2e-${Date.now().toString(36)}`;
    const groupDir = path.join(process.cwd(), 'groups', groupFolder);
    const ipcDir = path.join(process.cwd(), 'data', 'ipc', groupFolder);
    const piDir = path.join(process.cwd(), 'data', 'pi', groupFolder);
    const verdict = {
      pass: false,
      score: 1,
      issues: ['missing artifact from host artifact verification'],
      feedback: 'internal evaluator feedback',
    };
    const verdictJson = JSON.stringify(verdict);
    const fakePiPath = makeLeakAttemptPiExecutable({
      dir: tempDir,
      messagesDir: path.join(ipcDir, 'messages'),
      requestId,
      chatJid,
      verdictJson,
    });

    t.after(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
      fs.rmSync(workspaceDir, { recursive: true, force: true });
      fs.rmSync(groupDir, { recursive: true, force: true });
      fs.rmSync(ipcDir, { recursive: true, force: true });
      fs.rmSync(piDir, { recursive: true, force: true });
    });

    const group: RegisteredGroup = {
      name: 'Leak E2E',
      folder: groupFolder,
      trigger: '@FarmFriend',
      added_at: '2026-05-21T00:00:00.000Z',
    };
    const sentMessages: string[] = [];
    const persistedAssistantHistory: string[] = [];
    const deliveredIpcMessages: string[] = [];
    const tuiEvents: Array<Record<string, unknown>> = [];
    const telemetry = createStatusTelemetry({
      incidentWindowMs: 30 * 60 * 1000,
      maxIncidents: 5,
    });
    let settledResolve!: () => void;
    const settled = new Promise<void>((resolve) => {
      settledResolve = resolve;
    });

    const dispatcher = createMessageDispatcher({
      state: {
        registeredGroups: {
          [chatJid]: {
            jid: chatJid,
            name: 'Leak E2E',
            folder: groupFolder,
            trigger: '@FarmFriend',
          },
        },
        chatRunPreferences: {},
      },
      constants: {
        assistantName: 'FarmFriend',
        mainGroupFolder: groupFolder,
        mainWorkspaceDir: workspaceDir,
        tuiSenderName: 'TUI',
        triggerPattern: /@FarmFriend/i,
      },
      activeChatRuns: new Map(),
      activeChatRunsById: new Map(),
      activeCoderRuns: new Map(),
      tuiMessageQueue: new Map(),
      sendMessage: async () => {},
      setTyping: async () => {},
      getMessagesSince: () => [],
      getSessionKeyForChat: (jid: string) => `session:${jid}`,
      resolveMainOnboardingGate: () => ({ active: false }),
      buildOnboardingInterviewPrompt: ({ prompt }: { prompt: string }) =>
        prompt,
      extractOnboardingCompletion: (text: string | null) => ({
        text,
        completed: false,
      }),
      completeMainWorkspaceOnboarding: () => {},
      rememberHeartbeatTarget: () => {},
      runAgent: async (_group, prompt, _chatJid, _codingHint, runId) => {
        const output = await runContainerAgent(group, {
          prompt,
          groupFolder,
          chatJid,
          isMain: true,
          assistantName: 'FarmFriend',
          requestId: runId,
          noContinue: true,
          isEvaluatorRun: true,
          suppressPreviewStreaming: true,
          workspaceDirOverride: workspaceDir,
          piExecutableOverride: fakePiPath,
          lifecyclePolicyOverride: {
            staleAfterMs: 2500,
            hardTimeoutMs: 2500,
          },
        });

        const messagesDir = path.join(ipcDir, 'messages');
        for (const file of fs.readdirSync(messagesDir)) {
          const rawPayload = JSON.parse(
            fs.readFileSync(path.join(messagesDir, file), 'utf8'),
          );
          const envelope = wrapLegacyMessageEnvelope(rawPayload, groupFolder);
          if (envelope) {
            await dispatchLegacyMessageEnvelope(
              envelope,
              { [chatJid]: group },
              true,
              (event) => {
                if (event.kind === 'chat_delivery_requested') {
                  deliveredIpcMessages.push(event.text);
                }
              },
            );
          }
        }

        telemetry.noteRuntimeError({
          runId,
          chatJid,
          errorMessage: output.result || verdictJson,
          createdAt: '2026-05-21T12:00:00.000Z',
        });
        telemetry.noteRuntimeError({
          runId,
          chatJid,
          errorMessage:
            'verification_failed: score 1/10 issues missing artifact from host artifact verification feedback internal evaluator feedback',
          createdAt: '2026-05-21T12:00:01.000Z',
        });

        return {
          ok: true,
          result: output.result,
          streamed: false,
          suppressUserDelivery: true,
          controlPlaneStatus: 'verification_failed',
        };
      },
      consumeNextRunNoContinue: () => false,
      updateChatUsage: () => {},
      persistAssistantHistory: (_jid: string, text: string) => {
        persistedAssistantHistory.push(text);
      },
      persistTuiUserHistory: () => {},
      deleteTelegramPreviewMessage: async () => {},
      finalizeTelegramPreviewMessage: async () => false,
      sendAgentResultMessage: async (_jid: string, text: string) => {
        sentMessages.push(text);
        return true;
      },
      emitTuiChatEvent: (payload: Record<string, unknown>) => {
        tuiEvents.push({ kind: 'chat', ...payload });
      },
      emitTuiAgentEvent: (payload: Record<string, unknown>) => {
        tuiEvents.push({ kind: 'agent', ...payload });
      },
      isTelegramJid: () => true,
      consumeTelegramHostCompletedRun: () => false,
      consumeTelegramHostStreamState: () => null,
      resolveTelegramStreamCompletionState: ({
        externallyCompleted,
        previewState,
      }: any) => ({
        effectiveStreamed: externallyCompleted,
        messagePreviewState: previewState,
      }),
      finalizeCompletedRun,
      noteRunSettled: () => settledResolve(),
    } as any);

    const started = await dispatcher.runDirectSessionTurn({
      chatJid,
      text: 'Create a fake artifact and verify it exists.',
      runId: requestId,
      deliver: true,
    });
    assert.deepEqual(started, { runId: requestId, status: 'started' });
    await settled;

    const visibleOutputs = [
      ...sentMessages,
      ...persistedAssistantHistory,
      ...deliveredIpcMessages,
      ...tuiEvents.map((event) => JSON.stringify(event)),
    ];

    assert.equal(sentMessages.length, 0);
    assert.equal(persistedAssistantHistory.length, 0);
    assert.deepEqual(deliveredIpcMessages, []);
    assert.equal(
      tuiEvents.some(
        (event) =>
          event.kind === 'chat' &&
          event.state === 'final' &&
          JSON.stringify(event).includes('"assistant"'),
      ),
      false,
    );
    for (const [index, text] of visibleOutputs.entries()) {
      assertNoEvaluatorLeak(text, `visible output ${index} leaked`);
    }

    const statusText = formatStatusReport({
      assistantName: 'FarmFriend',
      version: 'test',
      runtime: 'host',
      serviceStartedAt: '2026-05-21T11:00:00.000Z',
      incidentWindowLabel: '30m',
      stuckWarningSeconds: 120,
      nowMs: Date.parse('2026-05-21T12:00:10.000Z'),
      telegramEnabled: true,
      whatsappEnabled: false,
      whatsappConnected: false,
      registeredGroupCount: 1,
      mainGroupName: 'Leak E2E',
      tasks: { active: 0, paused: 0, completed: 0 },
      activeChatRuns: [],
      activeCoderRuns: [],
      telemetry: telemetry.getSnapshot(Date.parse('2026-05-21T12:00:10.000Z')),
      agentRunning: false,
    });

    assert.match(statusText, /verification_failed/);
    assertNoEvaluatorLeak(statusText, 'status leaked evaluator details');
  },
);

test(
  'built host local runtime smoke keeps evaluator verdict JSON out of Telegram TUI and status',
  {
    concurrency: false,
    timeout: 30_000,
    skip:
      process.env.FFT_NANO_RUN_BUILT_HOST_SMOKE === '1'
        ? false
        : 'set FFT_NANO_RUN_BUILT_HOST_SMOKE=1 after npm run build',
  },
  async (t) => {
    const distEntry = path.resolve(process.cwd(), 'dist', 'index.js');
    if (!fs.existsSync(distEntry)) {
      t.skip('dist/index.js missing; run npm run build first');
      return;
    }

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-runtime-leak-'));
    const runtimeDir = path.join(tempDir, 'runtime');
    const workspaceDir = path.join(tempDir, 'workspace');
    const logsDir = path.join(runtimeDir, 'logs');
    const dataDir = path.join(runtimeDir, 'data');
    const groupsDir = path.join(runtimeDir, 'groups');
    const storeDir = path.join(runtimeDir, 'store');
    const webStaticDir = path.join(runtimeDir, 'dist-web', 'control-center');
    fs.mkdirSync(path.join(groupsDir, 'main', 'logs'), { recursive: true });
    fs.mkdirSync(path.join(dataDir, 'ipc', 'main', 'messages'), {
      recursive: true,
    });
    fs.mkdirSync(workspaceDir, { recursive: true });
    fs.mkdirSync(logsDir, { recursive: true });
    fs.mkdirSync(storeDir, { recursive: true });
    fs.mkdirSync(webStaticDir, { recursive: true });
    fs.writeFileSync(path.join(webStaticDir, 'index.html'), '<!doctype html>');
    fs.writeFileSync(
      path.join(dataDir, 'registered_groups.json'),
      JSON.stringify(
        {
          'telegram:424242': {
            jid: 'telegram:424242',
            name: 'Leak Runtime',
            folder: 'main',
            trigger: '@FarmFriend',
            added_at: '2026-05-21T00:00:00.000Z',
          },
        },
        null,
        2,
      ),
    );
    const db = new Database(path.join(storeDir, 'messages.db'));
    db.exec(`
      CREATE TABLE IF NOT EXISTS chats (
        jid TEXT PRIMARY KEY,
        name TEXT,
        last_message_time TEXT
      );
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT,
        chat_jid TEXT,
        sender TEXT,
        sender_name TEXT,
        content TEXT,
        timestamp TEXT,
        is_from_me INTEGER,
        PRIMARY KEY (id, chat_jid),
        FOREIGN KEY (chat_jid) REFERENCES chats(jid)
      );
    `);
    db.prepare(
      `INSERT OR REPLACE INTO chats (jid, name, last_message_time) VALUES (?, ?, ?)`,
    ).run('telegram:424242', 'Leak Runtime', '2026-05-21T00:00:00.000Z');
    db.close();

    const fakePiPath = makeRuntimeSmokePiExecutable({ dir: tempDir });
    const telegramApi = await startFakeTelegramApi();
    const tuiPort = await getFreePort();
    const webPort = await getFreePort();
    const childLogs: string[] = [];
    let child: ChildProcessWithoutNullStreams | null = null;
    let ws: WebSocket | null = null;
    const wsFrames: unknown[] = [];

    t.after(async () => {
      if (ws) ws.close();
      if (child) await terminateChild(child);
      await telegramApi.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    child = spawn(process.execPath, [distEntry], {
      cwd: runtimeDir,
      env: {
        ...process.env,
        ASSISTANT_NAME: 'FarmFriend',
        CONTAINER_RUNTIME: 'host',
        FFT_NANO_MAIN_WORKSPACE_DIR: workspaceDir,
        FFT_NANO_ALLOW_HOST_RUNTIME: '1',
        FFT_NANO_TUI_ENABLED: '1',
        FFT_NANO_TUI_HOST: '127.0.0.1',
        FFT_NANO_TUI_PORT: String(tuiPort),
        FFT_NANO_WEB_ENABLED: '1',
        FFT_NANO_WEB_HOST: '127.0.0.1',
        FFT_NANO_WEB_PORT: String(webPort),
        FFT_NANO_WEB_AUTH_TOKEN: '',
        FFT_NANO_SANDBOX: 'none',
        FFT_NANO_SCHEDULER_MODE: 'v2',
        FFT_NANO_HEARTBEAT_EVERY: '24h',
        LOG_LEVEL: 'debug',
        PI_PATH: fakePiPath,
        TELEGRAM_API_BASE_URL: telegramApi.baseUrl,
        TELEGRAM_AUTO_REGISTER: '0',
        TELEGRAM_BOT_TOKEN: 'fake-token',
        TELEGRAM_MAIN_CHAT_ID: '424242',
        WHATSAPP_ENABLED: '0',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout.on('data', (chunk) => {
      childLogs.push(chunk.toString('utf8'));
    });
    child.stderr.on('data', (chunk) => {
      childLogs.push(chunk.toString('utf8'));
    });

    try {
      await waitForHttpOk(`http://127.0.0.1:${webPort}/api/health`, 10_000);
    } catch (err) {
      assert.fail(
        `built host did not expose web health: ${
          err instanceof Error ? err.message : String(err)
        }\n${childLogs.join('').slice(-4000)}`,
      );
    }
    ws = await connectWs(`ws://127.0.0.1:${tuiPort}`);

    sendWsRequest(ws, 'sessions', 'sessions.list');
    const sessionsResponse = await waitForWsResponse(ws, 'sessions', wsFrames);
    assert.equal(sessionsResponse.ok, true);
    assert.equal(
      sessionsResponse.result.sessions.some(
        (session: any) => session.sessionKey === 'main',
      ),
      true,
    );

    const runId = `runtime-smoke-${Date.now().toString(36)}`;
    sendWsRequest(ws, 'send', 'chat.send', {
      sessionKey: 'main',
      runId,
      deliver: true,
      message:
        'Create /tmp/nonexistent-proof-artifact.html and tell me where to open it.',
    });
    const sendResponse = await waitForWsResponse(ws, 'send', wsFrames);
    assert.equal(
      sendResponse.ok,
      true,
      `chat.send failed: ${JSON.stringify(sendResponse)}\n${childLogs.join('').slice(-4000)}`,
    );
    assert.equal(sendResponse.result.status, 'started');

    await waitForWsFrame(
      ws,
      (frame) =>
        frame.event === 'agent_event' &&
        frame.payload?.runId === runId &&
        frame.payload?.data?.phase === 'end',
      wsFrames,
    );

    telegramApi.enqueueUpdate('/status');
    await waitForHttpOk(`http://127.0.0.1:${webPort}/api/health`, 2_000);
    const statusMessageStartedAt = Date.now();
    while (
      telegramApi.sentMessages.length === 0 &&
      Date.now() - statusMessageStartedAt < 10_000
    ) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(
      telegramApi.sentMessages.length > 0,
      'expected /status response through fake Telegram API',
    );

    const runtimeStatusResponse = await fetch(
      `http://127.0.0.1:${webPort}/api/runtime/status`,
    );
    const runtimeStatusText = await runtimeStatusResponse.text();
    const recentLogsResponse = await fetch(
      `http://127.0.0.1:${webPort}/api/logs/recent?target=host&lines=100`,
    );
    const recentLogsText = await recentLogsResponse.text();
    const visibleOutputs = [
      ...telegramApi.sentMessages,
      ...wsFrames.map((frame) => JSON.stringify(frame)),
      runtimeStatusText,
      recentLogsText,
    ];

    assert.equal(
      wsFrames.some(
        (frame: any) =>
          frame.event === 'chat_event' &&
          frame.payload?.runId === runId &&
          frame.payload?.state === 'final' &&
          JSON.stringify(frame).includes('assistant'),
      ),
      false,
      'TUI received an assistant final frame for suppressed verifier failure',
    );
    assert.equal(
      telegramApi.sentMessages.some((message) =>
        message.includes('verification_failed'),
      ),
      true,
      'expected status response to mention verification_failed',
    );

    for (const [index, text] of visibleOutputs.entries()) {
      assertNoEvaluatorLeak(text, `runtime visible output ${index} leaked`);
    }

    const internalLogText = childLogs.join('');
    assert.match(internalLogText, /verification_failed/);
    assert.match(internalLogText, /missing artifact|Claimed artifact/i);
  },
);
