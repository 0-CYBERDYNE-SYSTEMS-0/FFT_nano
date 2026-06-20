import assert from 'node:assert/strict';
import test from 'node:test';

import { state } from '../src/app-state.js';
import { finalizeTelegramPreviewMessage } from '../src/telegram-delivery.js';
import {
  createTelegramBot,
  isTelegramPrivateChatJid,
  isTelegramJid,
  isTelegramRichMessageWithinLimit,
  normalizeTelegramDraftText,
  normalizeTelegramPreviewText,
  parseTelegramChatId,
  splitTelegramText,
  splitTelegramTextForHtmlLimit,
  type TelegramBot,
} from '../src/telegram.js';
import {
  markdownToTelegramHtml,
  rebalanceHtmlChunks,
} from '../src/telegram-format.js';

test('parseTelegramChatId parses valid telegram jid', () => {
  assert.equal(parseTelegramChatId('telegram:12345'), '12345');
  assert.equal(parseTelegramChatId('telegram:-1001234'), '-1001234');
});

test('parseTelegramChatId rejects non-telegram jid', () => {
  assert.equal(parseTelegramChatId('12345@s.whatsapp.net'), null);
  assert.equal(parseTelegramChatId('telegram:'), null);
  assert.equal(isTelegramJid('telegram:42'), true);
  assert.equal(isTelegramJid('foo:42'), false);
  assert.equal(isTelegramPrivateChatJid('telegram:42'), true);
  assert.equal(isTelegramPrivateChatJid('telegram:-1001234'), false);
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

test('rebalanceHtmlChunks closes unclosed tags at chunk boundary', () => {
  const chunks = ['Hello <b>bold', ' text</b> world'];
  const balanced = rebalanceHtmlChunks(chunks);
  assert.deepEqual(balanced, ['Hello <b>bold</b>', '<b> text</b> world']);
});

test('rebalanceHtmlChunks handles nested tags', () => {
  const chunks = ['<b><i>nested', ' content</i></b>'];
  const balanced = rebalanceHtmlChunks(chunks);
  assert.deepEqual(balanced, [
    '<b><i>nested</i></b>',
    '<b><i> content</i></b>',
  ]);
});

test('rebalanceHtmlChunks passes through balanced chunks unchanged', () => {
  const chunks = ['<b>complete</b>', 'no tags here'];
  const balanced = rebalanceHtmlChunks(chunks);
  assert.deepEqual(balanced, chunks);
});

test('rebalanceHtmlChunks handles tg-spoiler tags', () => {
  const chunks = ['Before <tg-spoiler>secret', ' revealed</tg-spoiler> after'];
  const balanced = rebalanceHtmlChunks(chunks);
  assert.deepEqual(balanced, [
    'Before <tg-spoiler>secret</tg-spoiler>',
    '<tg-spoiler> revealed</tg-spoiler> after',
  ]);
});

test('rebalanceHtmlChunks returns single chunk unchanged', () => {
  const chunks = ['<b>unclosed'];
  assert.deepEqual(rebalanceHtmlChunks(chunks), chunks);
});

test('normalizeTelegramDraftText keeps short text unchanged', () => {
  assert.equal(normalizeTelegramDraftText('hello draft'), 'hello draft');
});

test('normalizeTelegramDraftText truncates to Telegram limit keeping the head', () => {
  const long = 'a'.repeat(5000);
  const normalized = normalizeTelegramDraftText(long);
  assert.equal(normalized.length, 4096);
  assert.equal(normalized.startsWith('a'), true);
  assert.equal(normalized.endsWith('…'), true);
});

test('normalizeTelegramPreviewText is preview-only truncation helper', () => {
  const long = 'b'.repeat(5000);
  const normalized = normalizeTelegramPreviewText(long);
  assert.equal(normalized.length, 4096);
  // Head-preserving: a single overflowing bubble keeps its start and marks the
  // cut with a trailing ellipsis instead of dropping the head.
  assert.equal(normalized.startsWith('bbbb'), true);
  assert.equal(normalized.endsWith('…'), true);
  assert.deepEqual(splitTelegramText(long).join(''), long);
});

test('normalizeTelegramPreviewText keeps the head for a long real reply', () => {
  const reply = 'Here is the answer. ' + 'word '.repeat(1200);
  const normalized = normalizeTelegramPreviewText(reply);
  assert.equal(normalized.startsWith('Here is the answer.'), true);
});

test('markdownToTelegramHtml renders fenced code with language class', () => {
  const html = markdownToTelegramHtml('```ts\nconst x = 1;\n```');
  assert.equal(
    html,
    '<pre><code class="language-ts">const x = 1;\n</code></pre>',
  );
});

test('markdownToTelegramHtml renders fenced code without language', () => {
  const html = markdownToTelegramHtml('```\nplain\n```');
  assert.equal(html, '<pre><code>plain\n</code></pre>');
});

test('markdownToTelegramHtml renders single-asterisk italic', () => {
  assert.equal(
    markdownToTelegramHtml('an *italic* word'),
    'an <i>italic</i> word',
  );
});

test('markdownToTelegramHtml keeps bold and italic distinct', () => {
  assert.equal(
    markdownToTelegramHtml('**bold** and *thin*'),
    '<b>bold</b> and <i>thin</i>',
  );
});

test('markdownToTelegramHtml does not italicize list bullets', () => {
  assert.equal(
    markdownToTelegramHtml('* item one\n* item two'),
    '* item one\n* item two',
  );
});

test('markdownToTelegramHtml renders blockquote from > lines', () => {
  const html = markdownToTelegramHtml('> quoted line\n> second line\nafter');
  assert.equal(
    html,
    '<blockquote>quoted line\nsecond line</blockquote>\nafter',
  );
});

test('markdownToTelegramHtml renders inline formatting inside blockquote', () => {
  const html = markdownToTelegramHtml('> a **bold** quote');
  assert.equal(html, '<blockquote>a <b>bold</b> quote</blockquote>');
});

test('markdownToTelegramHtml marks long blockquotes expandable', () => {
  const quote = Array.from({ length: 10 }, (_, i) => `> line ${i}`).join('\n');
  const html = markdownToTelegramHtml(quote);
  assert.ok(html.startsWith('<blockquote expandable>'));
  assert.ok(html.endsWith('</blockquote>'));
});

test('markdownToTelegramHtml renders pipe tables as aligned pre block', () => {
  const md = '| Crop | Acres |\n|------|-------|\n| Corn | 120 |\n| Soy | 80 |';
  const html = markdownToTelegramHtml(md);
  assert.equal(
    html,
    '<pre>Crop | Acres\n-----+------\nCorn | 120\nSoy  | 80</pre>',
  );
});

test('markdownToTelegramHtml escapes table cell content', () => {
  const md = '| A | B |\n|---|---|\n| <x> | a&b |';
  const html = markdownToTelegramHtml(md);
  assert.ok(html.includes('&lt;x&gt;'));
  assert.ok(html.includes('a&amp;b'));
});

test('markdownToTelegramHtml does not treat paragraph + hr as a table', () => {
  const html = markdownToTelegramHtml('Some heading\n---\nbody text');
  assert.ok(!html.includes('<pre>'));
});

test('markdownToTelegramHtml keeps the separator column count in sync for ragged rows', () => {
  // Header defines 3 columns; the extra 4th body cell is dropped and the short
  // row padded, so the separator never desyncs from the header.
  const md = '| A | B | C |\n|---|---|---|\n| 1 | 2 |\n| 3 | 4 | 5 | 6 |';
  const html = markdownToTelegramHtml(md);
  assert.equal(html, '<pre>A | B | C\n--+---+--\n1 | 2 |\n3 | 4 | 5</pre>');
});

test('markdownToTelegramHtml consumes alignment-colon delimiter rows', () => {
  const md = '| L | R |\n|:--|--:|\n| a | bb |';
  const html = markdownToTelegramHtml(md);
  // The :--/--:  delimiter row is consumed (alignment hints), not rendered.
  assert.ok(!html.includes(':'));
  assert.equal(html, '<pre>L | R\n--+---\na | bb</pre>');
});

test('markdownToTelegramHtml escapes unsafe tags while preserving inline code', () => {
  const html = markdownToTelegramHtml(
    'run `<b>rm -rf</b>` and <script>x</script>',
  );
  assert.equal(
    html,
    'run <code>&lt;b&gt;rm -rf&lt;/b&gt;</code> and &lt;script&gt;x&lt;/script&gt;',
  );
});

test('markdownToTelegramHtml keeps markdown link query params intact', () => {
  const html = markdownToTelegramHtml('[x](https://example.com/?a=1&b=2)');
  assert.equal(html, '<a href="https://example.com/?a=1&amp;b=2">x</a>');
});

test('sendMessage delivers raw markdown via sendRichMessage (Bot API 10.1)', async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];

  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      body: JSON.parse(String(init?.body)),
    });
    return {
      ok: true,
      json: async () => ({ ok: true, result: {} }),
    } as Response;
  }) as typeof fetch;

  const md = '| Crop | Acres |\n|------|-------|\n| Corn | 120 |';
  try {
    const bot = createTelegramBot({
      token: 'token',
      assistantName: 'FarmFriend',
      triggerPattern: /@FarmFriend/i,
    });
    await bot.sendMessage('telegram:1', md);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/sendRichMessage$/);
  assert.deepEqual(Object.keys(calls[0].body).sort(), [
    'chat_id',
    'rich_message',
  ]);
  const rich = calls[0].body.rich_message as { markdown: string };
  // RAW markdown — pipes must survive untouched for native table rendering.
  assert.equal(rich.markdown, md);
});

test('sendMessage falls back to HTML sendMessage and latches off when rich is unavailable', async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];

  globalThis.fetch = (async (input: string | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith('/sendRichMessage')) {
      return {
        ok: true,
        json: async () => ({
          ok: false,
          error_code: 404,
          description: 'Not Found: method sendRichMessage not found',
        }),
      } as Response;
    }
    return {
      ok: true,
      json: async () => ({ ok: true, result: {} }),
    } as Response;
  }) as typeof fetch;

  try {
    const bot = createTelegramBot({
      token: 'token',
      assistantName: 'FarmFriend',
      triggerPattern: /@FarmFriend/i,
    });
    await bot.sendMessage('telegram:1', 'first reply');
    await bot.sendMessage('telegram:1', 'second reply');
  } finally {
    globalThis.fetch = originalFetch;
  }

  // First send: rich attempted (404) then legacy sendMessage. Second send:
  // rich latched off, so only sendMessage is called.
  const richCalls = calls.filter((u) => u.endsWith('/sendRichMessage'));
  const legacyCalls = calls.filter((u) => u.endsWith('/sendMessage'));
  assert.equal(richCalls.length, 1);
  assert.equal(legacyCalls.length, 2);
});

test('rich message limit counts Unicode characters rather than UTF-16 code units', () => {
  assert.equal(isTelegramRichMessageWithinLimit('a'.repeat(32768)), true);
  assert.equal(isTelegramRichMessageWithinLimit('a'.repeat(32769)), false);
  assert.equal(isTelegramRichMessageWithinLimit('😀'.repeat(32768)), true);
});

test('sendMessageWithKeyboard uses documented sendRichMessage reply_markup', async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];

  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      body: JSON.parse(String(init?.body)),
    });
    return {
      ok: true,
      json: async () => ({ ok: true, result: {} }),
    } as Response;
  }) as typeof fetch;

  try {
    const bot = createTelegramBot({
      token: 'token',
      assistantName: 'FarmFriend',
      triggerPattern: /@FarmFriend/i,
    });
    await bot.sendMessageWithKeyboard('telegram:1', '# Choose', [
      [{ text: 'Open', callbackData: 'open' }],
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.match(calls[0].url, /\/sendRichMessage$/);
  assert.deepEqual(Object.keys(calls[0].body).sort(), [
    'chat_id',
    'reply_markup',
    'rich_message',
  ]);
});

test('sendMessageDraft uses documented sendRichMessageDraft payload', async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];

  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      body: JSON.parse(String(init?.body)),
    });
    return {
      ok: true,
      json: async () => ({ ok: true, result: true }),
    } as Response;
  }) as typeof fetch;

  try {
    const bot = createTelegramBot({
      token: 'token',
      assistantName: 'FarmFriend',
      triggerPattern: /@FarmFriend/i,
    });
    await bot.sendMessageDraft('telegram:1', 7, '**working**', {
      messageThreadId: 3,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.match(calls[0].url, /\/sendRichMessageDraft$/);
  assert.deepEqual(calls[0].body, {
    chat_id: '1',
    draft_id: 7,
    rich_message: { markdown: '**working**' },
    message_thread_id: 3,
  });
});

test('sendMessageDraft falls back when partial rich markdown is rejected', async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];

  globalThis.fetch = (async (input: string | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith('/sendRichMessageDraft')) {
      return {
        ok: true,
        json: async () => ({
          ok: false,
          error_code: 400,
          description: 'Bad Request: failed to parse rich message',
        }),
      } as Response;
    }
    return {
      ok: true,
      json: async () => ({ ok: true, result: true }),
    } as Response;
  }) as typeof fetch;

  try {
    const bot = createTelegramBot({
      token: 'token',
      assistantName: 'FarmFriend',
      triggerPattern: /@FarmFriend/i,
    });
    await bot.sendMessageDraft('telegram:1', 8, '```partial');
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(calls.length, 2);
  assert.match(calls[0], /\/sendRichMessageDraft$/);
  assert.match(calls[1], /\/sendMessageDraft$/);
});

test('editStreamMessage finalizes with editMessageText.rich_message', async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];

  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      body: JSON.parse(String(init?.body)),
    });
    return {
      ok: true,
      json: async () => ({ ok: true, result: {} }),
    } as Response;
  }) as typeof fetch;

  try {
    const bot = createTelegramBot({
      token: 'token',
      assistantName: 'FarmFriend',
      triggerPattern: /@FarmFriend/i,
    });
    await bot.editStreamMessage(
      'telegram:1',
      42,
      '# Final\n\n| A | B |\n|---|---|',
      {
        rich: true,
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.match(calls[0].url, /\/editMessageText$/);
  assert.deepEqual(calls[0].body, {
    chat_id: '1',
    message_id: 42,
    rich_message: { markdown: '# Final\n\n| A | B |\n|---|---|' },
  });
});

test('finalizeTelegramPreviewMessage edits the first preview as rich and removes stale bubbles', async () => {
  const originalBot = state.telegramBot;
  const edits: Array<{
    chatJid: string;
    messageId: number;
    text: string;
    rich?: boolean;
  }> = [];
  const deleted: number[] = [];

  state.telegramBot = {
    editStreamMessage: async (chatJid, messageId, text, opts) => {
      edits.push({ chatJid, messageId, text, rich: opts?.rich });
    },
    deleteMessage: async (_chatJid, messageId) => {
      deleted.push(messageId);
    },
  } as TelegramBot;

  try {
    const sent = await finalizeTelegramPreviewMessage(
      'telegram:1',
      41,
      '# Final\n\n| A | B |\n|---|---|',
      [41, 42],
    );
    assert.equal(sent, true);
  } finally {
    state.telegramBot = originalBot;
  }

  assert.deepEqual(edits, [
    {
      chatJid: 'telegram:1',
      messageId: 41,
      text: '# Final\n\n| A | B |\n|---|---|',
      rich: true,
    },
  ]);
  assert.deepEqual(deleted, [42]);
});

test('createTelegramBot uploads video, audio, voice, and animation via Telegram Bot API', async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method?: string; body?: FormData }> = [];

  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method,
      body: init?.body as FormData | undefined,
    });
    return {
      ok: true,
      json: async () => ({ ok: true, result: {} }),
    } as Response;
  }) as typeof fetch;

  try {
    const bot = createTelegramBot({
      token: 'token',
      assistantName: 'FarmFriend',
      triggerPattern: /@FarmFriend/i,
    });

    await bot.sendVideo(
      'telegram:1',
      Buffer.from('video'),
      'clip.mp4',
      'Video',
    );
    await bot.sendAudio(
      'telegram:1',
      Buffer.from('audio'),
      'song.mp3',
      'Audio',
    );
    await bot.sendVoice(
      'telegram:1',
      Buffer.from('voice'),
      'note.ogg',
      'Voice',
    );
    await bot.sendAnimation(
      'telegram:1',
      Buffer.from('gif'),
      'loop.gif',
      'Animation',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(calls.length, 4);
  assert.match(calls[0].url, /\/sendVideo$/);
  assert.match(calls[1].url, /\/sendAudio$/);
  assert.match(calls[2].url, /\/sendVoice$/);
  assert.match(calls[3].url, /\/sendAnimation$/);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].body?.get('chat_id'), '1');
  assert.equal(calls[0].body?.get('caption'), 'Video');
});
