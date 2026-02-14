import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isTelegramJid,
  parseTelegramChatId,
  splitTelegramText,
  splitTelegramTextForHtmlLimit,
} from '../src/telegram.js';
import { markdownToTelegramHtml } from '../src/telegram-format.js';

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

test('splitTelegramText keeps fenced code blocks intact when not length-limited', () => {
  const text = '```js\nconst a = 1;\nconst b = 2;\n```\nAfter';
  assert.deepEqual(splitTelegramText(text, 1000), [text]);
});

test('splitTelegramText preserves fence boundaries when splitting long fences', () => {
  const text = `\`\`\`js\n${'const a = 1;\n'.repeat(20)}\`\`\``;
  const parts = splitTelegramText(text, 80);
  assert.ok(parts.length > 1);
  for (const part of parts) {
    assert.ok(part.length <= 80);
    assert.ok(part.includes('```'));
  }
});

test('splitTelegramTextForHtmlLimit re-splits chunks that expand after markdown->HTML', () => {
  const markdown = `${'**alpha** '.repeat(70)}${'**beta** '.repeat(70)}`;
  const parts = splitTelegramTextForHtmlLimit(markdown, 256);
  assert.ok(parts.length > 1);
  for (const part of parts) {
    const html = markdownToTelegramHtml(part);
    assert.ok(html.length <= 256);
  }
});

test('markdownToTelegramHtml renders fenced code as Telegram pre/code', () => {
  const html = markdownToTelegramHtml('```ts\nconst x = 1;\n```');
  assert.equal(html, '<pre><code>const x = 1;\n</code></pre>');
});

test('markdownToTelegramHtml escapes unsafe tags while preserving inline code', () => {
  const html = markdownToTelegramHtml('run `<b>rm -rf</b>` and <script>x</script>');
  assert.equal(
    html,
    'run <code>&lt;b&gt;rm -rf&lt;/b&gt;</code> and &lt;script&gt;x&lt;/script&gt;',
  );
});

test('markdownToTelegramHtml keeps markdown link query params intact', () => {
  const html = markdownToTelegramHtml('[x](https://example.com/?a=1&b=2)');
  assert.equal(html, '<a href="https://example.com/?a=1&amp;b=2">x</a>');
});
