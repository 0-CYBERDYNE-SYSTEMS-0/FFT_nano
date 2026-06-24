import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cancelPendingAskUsersForChat,
  createPendingAskUser,
  getExpiredAskUser,
  getPendingAskUser,
  parseAskUserCallback,
  resolvePendingAskUser,
} from '../src/ask-user-ui.js';

test('parseAskUserCallback decodes index-based callback', () => {
  assert.deepEqual(parseAskUserCallback('au:req-1:0'), {
    requestId: 'req-1',
    index: 0,
  });
  assert.deepEqual(parseAskUserCallback('au:req-1:3'), {
    requestId: 'req-1',
    index: 3,
  });
  assert.deepEqual(parseAskUserCallback('au:req-1:5'), {
    requestId: 'req-1',
    index: 5,
  });
});

test('parseAskUserCallback returns null for permission-gate callbacks', () => {
  assert.equal(parseAskUserCallback('pg_allow:abc'), null);
  assert.equal(parseAskUserCallback('pg_block:abc'), null);
});

test('parseAskUserCallback returns null for out-of-range index', () => {
  // Only 0-5 are valid (matches MAX_OPTIONS = 6 in the extension).
  assert.equal(parseAskUserCallback('au:req-1:6'), null);
  assert.equal(parseAskUserCallback('au:req-1:9'), null);
  assert.equal(parseAskUserCallback('au:req-1:-1'), null);
});

test('parseAskUserCallback returns null for malformed payloads', () => {
  assert.equal(parseAskUserCallback('au:'), null);
  assert.equal(parseAskUserCallback('au:onlyrequestid'), null);
  assert.equal(parseAskUserCallback('au::'), null);
  assert.equal(parseAskUserCallback('au:req:abc'), null);
  assert.equal(parseAskUserCallback('au:req:'), null);
  assert.equal(parseAskUserCallback('totally-unrelated'), null);
});

test('parseAskUserCallback stays under Telegram 64-byte cap with long requestIds', () => {
  // Worst-case requestId minted by the host is `au-<timestamp>-<rand>`.
  // A 12-char base36 timestamp + 6-char rand + `au-` + `-` = ~24 chars.
  // 24 + `:5` = 26 bytes — well under 64.
  const longId = `au-lx9k2m8p4n7q3r-${'x'.repeat(20)}`;
  const data = `au:${longId}:5`;
  assert.ok(
    data.length <= 64,
    `callback_data was ${data.length} bytes, must be <= 64`,
  );
  const parsed = parseAskUserCallback(data);
  assert.ok(parsed);
  assert.equal(parsed.requestId, longId);
  assert.equal(parsed.index, 5);
});

test('resolvePendingAskUser resolves with the chosen value', async () => {
  const requestId = `au-resolve-${Date.now().toString(36)}`;
  const options = ['Yes', 'No'];
  const { promise } = createPendingAskUser(
    requestId,
    'telegram:1',
    options,
    60_000,
  );
  assert.equal(resolvePendingAskUser(requestId, { value: 'Yes' }), true);
  assert.deepEqual(await promise, { value: 'Yes' });
  // Second resolve is a no-op
  assert.equal(resolvePendingAskUser(requestId, { value: 'No' }), false);
});

test('cancelPendingAskUsersForChat resolves pending requests as empty', async () => {
  const requestId = `au-cancel-${Date.now().toString(36)}`;
  const { promise } = createPendingAskUser(
    requestId,
    'telegram:cancel-1',
    ['A', 'B'],
    60_000,
  );
  assert.equal(cancelPendingAskUsersForChat('telegram:cancel-1'), 1);
  const response = await promise;
  assert.equal(response.value, undefined);
  assert.equal(getExpiredAskUser(requestId)?.reason, 'cancelled');
});

test('cancelPendingAskUsersForChat is a no-op for unknown chats', () => {
  assert.equal(cancelPendingAskUsersForChat('telegram:unknown'), 0);
});

test('getPendingAskUser returns the live record while pending', () => {
  const requestId = `au-live-${Date.now().toString(36)}`;
  createPendingAskUser(requestId, 'telegram:2', ['X', 'Y'], 60_000);
  const live = getPendingAskUser(requestId);
  assert.ok(live);
  assert.deepEqual(live.options, ['X', 'Y']);
  assert.equal(live.chatJid, 'telegram:2');
  resolvePendingAskUser(requestId, { value: 'X' });
});

test('callback resolves to the right option label by index (round-trip)', () => {
  // The host resolves (requestId, index) -> options[index] at callback time.
  // This test pins that the callback index lines up with the label the user
  // actually tapped, regardless of label length or content.
  const requestId = `au-roundtrip-${Date.now().toString(36)}`;
  const options = [
    'Short',
    'A longer option label that does not fit in a base64url callback',
    'Option with: colons, /slashes/, and "quotes"',
    'Unicode ✓ emoji ☃',
  ];
  createPendingAskUser(requestId, 'telegram:rt', options, 60_000);
  for (let i = 0; i < options.length; i++) {
    const data = `au:${requestId}:${i}`;
    const parsed = parseAskUserCallback(data);
    assert.ok(parsed);
    const live = getPendingAskUser(parsed.requestId);
    assert.ok(live);
    assert.equal(live.options[parsed.index], options[i]);
  }
  // Cleanup so the timeout checker does not warn
  resolvePendingAskUser(requestId, { value: options[0] });
});
