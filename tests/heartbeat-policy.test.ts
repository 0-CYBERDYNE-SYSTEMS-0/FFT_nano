import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import test from 'node:test';

import {
  isHeartbeatContentEffectivelyEmpty,
  isHeartbeatFileEffectivelyEmpty,
  isWithinHeartbeatActiveHours,
  parseHeartbeatActiveHours,
  shouldSuppressDuplicateHeartbeat,
  stripHeartbeatToken,
} from '../src/heartbeat-policy.ts';

test('isHeartbeatContentEffectivelyEmpty treats comments and blank lines as empty', () => {
  assert.equal(
    isHeartbeatContentEffectivelyEmpty('# HEARTBEAT\n\n# comment\n- [ ]\n'),
    true,
  );
  assert.equal(isHeartbeatContentEffectivelyEmpty('# HEARTBEAT\nCheck pumps.'), false);
});

test('isHeartbeatFileEffectivelyEmpty handles readable files and missing files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-heartbeat-file-'));
  const filePath = path.join(dir, 'HEARTBEAT.md');
  fs.writeFileSync(filePath, '# HEARTBEAT\n\n# comment only\n', 'utf-8');
  assert.equal(isHeartbeatFileEffectivelyEmpty(filePath), true);
  assert.equal(isHeartbeatFileEffectivelyEmpty(path.join(dir, 'missing.md')), false);
});

test('stripHeartbeatToken strips wrapped heartbeat token and suppresses short ack fluff', () => {
  assert.deepEqual(stripHeartbeatToken('<b>HEARTBEAT_OK</b>', { mode: 'heartbeat' }), {
    shouldSkip: true,
    text: '',
    didStrip: true,
  });
  assert.deepEqual(
    stripHeartbeatToken('HEARTBEAT_OK all good', { mode: 'heartbeat', maxAckChars: 20 }),
    { shouldSkip: true, text: '', didStrip: true },
  );
  assert.deepEqual(
    stripHeartbeatToken('HEARTBEAT_OK valve 4 has been offline for 15m', {
      mode: 'heartbeat',
      maxAckChars: 10,
    }),
    { shouldSkip: false, text: 'valve 4 has been offline for 15m', didStrip: true },
  );
});

test('parseHeartbeatActiveHours and isWithinHeartbeatActiveHours support day ranges', () => {
  const active = parseHeartbeatActiveHours('Mon-Fri@09:00-17:00');
  assert.ok(active);
  assert.equal(
    isWithinHeartbeatActiveHours(active, new Date('2026-02-18T16:00:00.000Z')),
    true,
  ); // Wed 16:00 UTC
  assert.equal(
    isWithinHeartbeatActiveHours(active, new Date('2026-02-22T16:00:00.000Z')),
    false,
  ); // Sun
});

test('shouldSuppressDuplicateHeartbeat applies 24h dedupe window', () => {
  const now = Date.now();
  assert.equal(
    shouldSuppressDuplicateHeartbeat({
      text: 'Pump 3 fault',
      nowMs: now,
      previousText: 'Pump 3 fault',
      previousSentAt: now - 60_000,
    }),
    true,
  );
  assert.equal(
    shouldSuppressDuplicateHeartbeat({
      text: 'Pump 3 fault',
      nowMs: now,
      previousText: 'Pump 3 fault',
      previousSentAt: now - 25 * 60 * 60 * 1000,
    }),
    false,
  );
});

