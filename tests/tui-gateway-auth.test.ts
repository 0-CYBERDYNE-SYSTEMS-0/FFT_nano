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

test('gateway rejects unauthorized method calls until connect token handshake succeeds', async () => {
  const port = await getFreePort();
  const eventHub = new HostEventBus();
  const gateway = await startTuiGatewayServer(
    {
      getStatus: () => ({
        runtime: 'docker',
        sessions: 2,
        activeRuns: 0,
        activeRunDetails: [
          {
            runId: 'run-1',
            chatJid: 'telegram:1',
            sessionKey: 'main',
            startedAt: '2026-03-31T19:00:00.000Z',
            ageSeconds: 15,
            lastProgressAt: '2026-03-31T19:00:05.000Z',
            progressAgeSeconds: 10,
            resumed: true,
            route: 'agent',
          },
        ],
      }),
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
    {
      host: '127.0.0.1',
      port,
      authToken: 'top-secret',
    },
  );

  try {
    const ws = await connectWs(`ws://127.0.0.1:${port}`);
    ws.send(
      JSON.stringify({
        id: 'unauth-status',
        method: 'status',
      }),
    );
    const unauthorized = await waitForMessage<{ ok: boolean; error?: string }>(ws);
    assert.equal(unauthorized.ok, false);
    assert.match(unauthorized.error || '', /Unauthorized/);
    ws.close();

    const wsWrongToken = await connectWs(`ws://127.0.0.1:${port}`);
    wsWrongToken.send(
      JSON.stringify({
        id: 'bad-connect',
        method: 'connect',
        params: { token: 'wrong-token' },
      }),
    );
    const badConnect = await waitForMessage<{ ok: boolean; error?: string }>(wsWrongToken);
    assert.equal(badConnect.ok, false);
    assert.match(badConnect.error || '', /invalid gateway token/i);
    wsWrongToken.close();

    const wsAuthed = await connectWs(`ws://127.0.0.1:${port}`);
    wsAuthed.send(
      JSON.stringify({
        id: 'good-connect',
        method: 'connect',
        params: { token: 'top-secret' },
      }),
    );
    const goodConnect = await waitForMessage<{ ok: boolean }>(wsAuthed);
    assert.equal(goodConnect.ok, true);

    wsAuthed.send(
      JSON.stringify({
        id: 'authed-status',
        method: 'status',
      }),
    );
    const statusFrame = await waitForMessage<{
      ok: boolean;
      result?: {
        runtime: string;
        sessions: number;
        activeRunDetails: Array<{ runId: string; resumed: boolean }>;
      };
    }>(wsAuthed);
    assert.equal(statusFrame.ok, true);
    assert.equal(statusFrame.result?.runtime, 'docker');
    assert.equal(statusFrame.result?.sessions, 2);
    assert.equal(statusFrame.result?.activeRunDetails[0]?.runId, 'run-1');
    assert.equal(statusFrame.result?.activeRunDetails[0]?.resumed, true);
    wsAuthed.close();
  } finally {
    await gateway.close();
  }
});
