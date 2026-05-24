import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  isUnixSocketAcceptingConnections,
  removeStaleUnixSocket,
} from '../src/tui/gateway-server.ts';

test('removeStaleUnixSocket removes stale filesystem entries', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'fft-tui-socket-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const socketPath = path.join(dir, 'stale.sock');
  writeFileSync(socketPath, 'not a socket', 'utf8');

  assert.equal(await isUnixSocketAcceptingConnections(socketPath), false);
  await removeStaleUnixSocket(socketPath);
  assert.equal(await isUnixSocketAcceptingConnections(socketPath), false);
});
