import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isTelegramJid,
  parseTelegramChatId,
  splitTelegramText,
} from '../src/telegram.js';

test('parseTelegramChatId parses valid telegram jid', () => {
  assert.equal(parseTelegramChatId('telegram:12345'), '12345');
  assert.equal(parseTelegramChatId('telegram:-1001234'), '-1001234');
});

test('parseTelegramChatId rejects non-telegram jid', () => {
  assert.equal(parseTelegramChatId('12345@s.whatsapp.net'), null);
  assert.equal(parseTelegramChatId('telegram:'), null);
  assert.equal(isTelegramJid('telegram:42'), true);
  assert.equal(isTelegramJid('foo:42'), false);
});

test('splitTelegramText keeps short text unchanged', () => {
  const text = 'hello world';
  assert.deepEqual(splitTelegramText(text, 100), [text]);
});

test('splitTelegramText splits long text within max length', () => {
  const text = `${'a'.repeat(120)}\n${'b'.repeat(120)}\n${'c'.repeat(120)}`;
  const parts = splitTelegramText(text, 130);

  assert.ok(parts.length > 1);
  for (const part of parts) {
    assert.ok(part.length <= 130);
  }
  assert.equal(parts.join('\n').replace(/\n\n+/g, '\n').includes('aaa'), true);
});
