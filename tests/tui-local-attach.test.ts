import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createConnection, Socket } from 'node:net';
import test from 'node:test';

import { HostEventBus } from '../src/runtime/host-events.ts';
import { startTuiGatewayServer } from '../src/tui/gateway-server.ts';

// Verify the local socket attach path uses one protocol
// (newline-delimited JSON) on both sides, can chat.history, receive
// broadcast events, and close cleanly.
test('local socket attach can connect, chat.history, receive broadcasts, and close cleanly', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'fft-tui-local-attach-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const socketPath = path.join(dir, 'missing', 'fft-nano', 'tui.sock');

  const eventHub = new HostEventBus();
  const history: Array<{ role: string; text: string; timestamp: string }> = [
    { role: 'user', text: 'hello', timestamp: '2024-01-01T00:00:00.000Z' },
    {
      role: 'assistant',
      text: 'world',
      timestamp: '2024-01-01T00:00:01.000Z',
    },
  ];
  const gateway = await startTuiGatewayServer(
    {
      getStatus: () => ({ runtime: 'host', sessions: 1, activeRuns: 0 }),
      listSessions: () => [
        { sessionKey: 'main', name: 'main', isMain: true, jid: 'tui:main' },
      ],
      resolveChatJid: () => 'tui:main',
      getSessionKeyForChat: () => 'main',
      getSessionPrefs: () => ({}),
      patchSessionPrefs: () => ({}),
      resetSession: () => ({ ok: true, reason: 'ok' }),
      getHistory: async () => history,
      sendChat: async () => ({ runId: 'r1', status: 'started' as const }),
      abortChat: async () => ({ aborted: false }),
      serviceGateway: () => ({ ok: true, text: 'ok' }),
    },
    eventHub,
    { host: '127.0.0.1', port: 0, socketPath },
  );
  t.after(() => gateway.close());

  // 1) Connect via raw net.Socket (NDJSON framing on top of net).
  const socket: Socket = await new Promise((resolve, reject) => {
    const s = createConnection(socketPath, () => resolve(s));
    s.once('error', reject);
  });
  // Drain and log any unexpected data so we can debug framing issues.
  socket.on('data', (chunk: Buffer) => {
    process.stderr.write(`[test] data: ${chunk.toString('utf8')}\n`);
  });
  socket.on('error', (err) => {
    process.stderr.write(`[test] error: ${err.message}\n`);
  });
  socket.on('close', () => {
    process.stderr.write(`[test] closed\n`);
  });
  t.after(() => {
    try {
      socket.end();
    } catch {
      // ignore
    }
  });

  function sendRequest(
    id: string,
    method: string,
    params: Record<string, unknown> = {},
  ) {
    socket.write(JSON.stringify({ id, method, params }) + '\n');
  }

  function nextMessage(): Promise<Record<string, unknown>> {
    return new Promise((resolve) => {
      const onData = (chunk: Buffer) => {
        socket.off('data', onData);
        const text = chunk.toString('utf8').trim();
        // text could be more than one line, take the first complete frame
        const firstLine = text.split('\n').find((l) => l.trim());
        resolve(JSON.parse(firstLine || '{}') as Record<string, unknown>);
      };
      socket.once('data', onData);
    });
  }

  sendRequest('1', 'connect', { client: 'fft_nano_tui' });
  const connectRes = await nextMessage();
  assert.equal(connectRes.id, '1');
  assert.equal(connectRes.ok, true);

  // 2) chat.history
  sendRequest('2', 'chat.history', { sessionKey: 'main', limit: 50 });
  const historyRes = await nextMessage();
  assert.equal(historyRes.id, '2');
  assert.equal(historyRes.ok, true);
  const result = historyRes.result as {
    messages: Array<{ role: string; text: string }>;
  };
  assert.equal(result.messages.length, 2);
  assert.equal(result.messages[0].role, 'user');
  assert.equal(result.messages[0].text, 'hello');
  assert.equal(result.messages[1].text, 'world');

  // 3) Broadcast event round-trip. The host event bus publishes
  //    host events; the gateway server projects them into gateway
  //    frames (e.g. run_state -> chat_event) and fans them out to
  //    every connected client. Use a real `run_state` event here so
  //    the projector actually returns a frame to broadcast.
  eventHub.publish({
    kind: 'run_state',
    id: 'evt-1',
    createdAt: new Date().toISOString(),
    source: 'test',
    runId: 'r1',
    sessionKey: 'main',
    chatJid: 'tui:main',
    state: 'message',
    message: { role: 'assistant', content: 'broadcast-ok' },
  });

  const broadcast = await nextMessage();
  assert.equal(broadcast.event, 'chat_event');
  const payload = broadcast.payload as {
    state: string;
    message: { content: string };
  };
  assert.equal(payload.state, 'message');
  assert.equal(payload.message.content, 'broadcast-ok');

  // 4) Clean close
  await new Promise<void>((resolve) => {
    socket.once('close', () => resolve());
    socket.end();
  });
});

test('gateway: local socket server error rejects the startTuiGatewayServer promise', async (t) => {
  // Block the bind by placing a directory at the path. `unlinkSync` will
  // fail on a directory (EISDIR), so `removeStaleUnixSocket` cannot
  // clear it, and `listen` will reject with EADDRINUSE. This is the
  // realistic "port is busy" scenario we want to surface in startTuiGatewayService.
  const dir = mkdtempSync(path.join(tmpdir(), 'fft-tui-bad-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const conflict = path.join(dir, 'busy.sock');
  const { mkdirSync } = await import('node:fs');
  mkdirSync(conflict, { recursive: false });

  const eventHub = new HostEventBus();
  await assert.rejects(
    startTuiGatewayServer(
      {
        getStatus: () => ({ runtime: 'host', sessions: 0, activeRuns: 0 }),
        listSessions: () => [],
        resolveChatJid: () => null,
        getSessionKeyForChat: () => 'main',
        getSessionPrefs: () => ({}),
        patchSessionPrefs: () => ({}),
        resetSession: () => ({ ok: true, reason: 'ok' }),
        getHistory: async () => [],
        sendChat: async () => ({ runId: 'r1', status: 'started' as const }),
        abortChat: async () => ({ aborted: false }),
        serviceGateway: () => ({ ok: true, text: 'ok' }),
      },
      eventHub,
      { host: '127.0.0.1', port: 0, socketPath: conflict },
    ),
    /TUI local socket/,
  );
});
