import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { startWebControlCenterServer } from '../src/web/control-center-server.ts';

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

function createStaticDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-web-static-'));
  fs.writeFileSync(
    path.join(dir, 'index.html'),
    '<!doctype html><html><body>ok</body></html>',
    'utf-8',
  );
  return dir;
}

function createLogsDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-web-logs-'));
  fs.writeFileSync(path.join(dir, 'fft_nano.log'), 'line-a\\nline-b\\nline-c\\n', 'utf-8');
  fs.writeFileSync(path.join(dir, 'fft_nano.error.log'), 'err-a\\nerr-b\\n', 'utf-8');
  return dir;
}

test('web control center serves runtime status on localhost mode without auth', async () => {
  const port = await getFreePort();
  const staticDir = createStaticDir();
  const logsDir = createLogsDir();

  const server = await startWebControlCenterServer(
    {
      getRuntimeStatus: () => ({ runtime: 'docker', sessions: 3, activeRuns: 1 }),
      getProfileStatus: () => ({
        profile: 'farm',
        featureFarm: true,
        profileDetection: { source: 'auto_preserve', reason: 'test' },
      }),
      getBuildInfo: () => ({
        startedAt: '2026-02-26T00:00:00.000Z',
        version: '1.1.0',
        branch: 'dev',
        commit: 'abc123',
      }),
      getGatewayStatus: () => ({
        host: '127.0.0.1',
        port: 28989,
        authRequired: false,
      }),
    },
    {
      host: '127.0.0.1',
      port,
      accessMode: 'localhost',
      authToken: '',
      staticDir,
      logsDir,
    },
  );

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/runtime/status`);
    assert.equal(res.status, 200);
    const json = (await res.json()) as { ok: boolean; runtime: { sessions: number } };
    assert.equal(json.ok, true);
    assert.equal(json.runtime.sessions, 3);

    const logsRes = await fetch(`http://127.0.0.1:${port}/api/logs/recent?target=error&lines=20`);
    assert.equal(logsRes.status, 200);
    const logsJson = (await logsRes.json()) as { ok: boolean; content: string };
    assert.equal(logsJson.ok, true);
    assert.match(logsJson.content, /err-a/);
  } finally {
    await server.close();
  }
});

test('web control center requires bearer token in lan mode', async () => {
  const port = await getFreePort();
  const staticDir = createStaticDir();
  const logsDir = createLogsDir();

  const server = await startWebControlCenterServer(
    {
      getRuntimeStatus: () => ({ runtime: 'docker', sessions: 1, activeRuns: 0 }),
      getProfileStatus: () => ({
        profile: 'core',
        featureFarm: false,
        profileDetection: { source: 'explicit', reason: 'test' },
      }),
      getBuildInfo: () => ({
        startedAt: '2026-02-26T00:00:00.000Z',
        version: '1.1.0',
      }),
      getGatewayStatus: () => ({
        host: '0.0.0.0',
        port: 28989,
        authRequired: true,
      }),
    },
    {
      host: '127.0.0.1',
      port,
      accessMode: 'lan',
      authToken: 'secret-token',
      staticDir,
      logsDir,
    },
  );

  try {
    const noAuth = await fetch(`http://127.0.0.1:${port}/api/runtime/status`);
    assert.equal(noAuth.status, 401);

    const withAuth = await fetch(`http://127.0.0.1:${port}/api/runtime/status`, {
      headers: { Authorization: 'Bearer secret-token' },
    });
    assert.equal(withAuth.status, 200);
    const json = (await withAuth.json()) as { ok: boolean; gateway: { wsUrl: string } };
    assert.equal(json.ok, true);
    assert.match(json.gateway.wsUrl, /^ws:\/\/127\.0\.0\.1:28989/);
  } finally {
    await server.close();
  }
});
