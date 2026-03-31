import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

import WebSocket from 'ws';

import { HostEventBus } from '../src/runtime/host-events.ts';
import { startTuiGatewayServer } from '../src/tui/gateway-server.ts';

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

function connectWs(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function waitForMessage<T = unknown>(ws: WebSocket): Promise<T> {
  return new Promise((resolve, reject) => {
    const onMessage = (raw: WebSocket.RawData) => {
      try {
        const parsed = JSON.parse(raw.toString('utf8')) as T;
        ws.off('error', onError);
        resolve(parsed);
      } catch (err) {
        ws.off('error', onError);
        reject(err);
      }
    };
    const onError = (err: Error) => {
      ws.off('message', onMessage);
      reject(err);
    };
    ws.once('message', onMessage);
    ws.once('error', onError);
  });
}

test('gateway projects assistant_final host events into chat_event frames', async () => {
  const port = await getFreePort();
  const bus = new HostEventBus();
  const gateway = await startTuiGatewayServer(
    {
      getStatus: () => ({
        runtime: 'docker',
        sessions: 1,
        activeRuns: 0,
        activeRunDetails: [],
      }),
      listSessions: () => [],
      resolveChatJid: () => 'telegram:1',
      getSessionKeyForChat: () => 'main',
      getSessionPrefs: () => ({}),
      patchSessionPrefs: () => ({}),
      resetSession: () => ({ ok: true, reason: 'ok' }),
      getHistory: async () => [],
      sendChat: async () => ({ runId: 'r1', status: 'started' as const }),
      abortChat: async () => ({ aborted: false }),
      serviceGateway: () => ({ ok: true, text: 'ok' }),
    },
    bus,
    {
      host: '127.0.0.1',
      port,
    },
  );

  try {
    const ws = await connectWs(`ws://127.0.0.1:${port}`);
    bus.publish({
      kind: 'assistant_final',
      id: 'evt-1',
      createdAt: '2026-03-21T00:00:00.000Z',
      source: 'message-dispatch',
      runId: 'r1',
      sessionKey: 'main',
      chatJid: 'telegram:1',
      message: { role: 'assistant', content: 'done' },
    });

    const frame = await waitForMessage<{
      event: string;
      payload?: { runId: string; state: string; message?: { role: string; content: string } };
    }>(ws);
    assert.equal(frame.event, 'chat_event');
    assert.equal(frame.payload?.runId, 'r1');
    assert.equal(frame.payload?.state, 'final');
    assert.deepEqual(frame.payload?.message, { role: 'assistant', content: 'done' });
    ws.close();
  } finally {
    await gateway.close();
  }
});
