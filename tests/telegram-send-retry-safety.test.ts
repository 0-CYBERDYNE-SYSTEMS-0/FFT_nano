/**
 * Regression: a network-level failure (fetch throws — timeout, reset, no
 * response at all) on a message-creating Telegram API call must NOT be
 * retried. Telegram's send/create endpoints have no idempotency key, so
 * retrying one after a response-uncertain failure can deliver the same
 * message content twice — invisible to our own logs/DB, since those only
 * record the outer call once, but very visible to the user as a doubled
 * reply.
 *
 * Edit/delete calls remain safe to retry (re-applying the same edit, or
 * deleting an already-deleted message, is a no-op either way).
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { createTelegramBot } from '../src/telegram.js';

type Handler = (
  method: string,
  body: unknown,
  callIndex: number,
) => { status: number; body: unknown } | 'reset';

async function withStubTelegramServer(
  handler: Handler,
  fn: (apiBaseUrl: string, calls: () => string[]) => Promise<void>,
): Promise<void> {
  const calls: string[] = [];
  let callIndex = 0;
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      const method = (req.url || '').split('/').pop() || '';
      calls.push(method);
      const outcome = handler(method, raw ? JSON.parse(raw) : {}, callIndex++);
      if (outcome === 'reset') {
        req.socket.destroy();
        return;
      }
      res.writeHead(outcome.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(outcome.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await fn(`http://127.0.0.1:${port}`, () => calls);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('sendMessage does not retry after a network-level (reset) failure', async () => {
  await withStubTelegramServer(
    () => 'reset',
    async (apiBaseUrl, calls) => {
      const bot = createTelegramBot({
        token: 'test-token',
        apiBaseUrl,
      });
      await assert.rejects(() => bot.sendMessage('telegram:1', 'hello'));
      // Exactly one attempt reached the server — a retry here would risk a
      // second, genuinely duplicate message being created.
      assert.equal(
        calls().filter((m) => m === 'sendMessage' || m === 'sendRichMessage')
          .length,
        1,
      );
    },
  );
});

test('sendMessage retries on an explicit 429 from Telegram (safe: Telegram rejected before creating anything)', async () => {
  await withStubTelegramServer(
    (method, _body, callIndex) => {
      if (method !== 'sendMessage' && method !== 'sendRichMessage') {
        return { status: 200, body: { ok: true, result: {} } };
      }
      if (callIndex === 0) {
        return {
          status: 429,
          body: {
            ok: false,
            error_code: 429,
            description: 'Too Many Requests',
            parameters: { retry_after: 0 },
          },
        };
      }
      return {
        status: 200,
        body: { ok: true, result: { message_id: 42 } },
      };
    },
    async (apiBaseUrl, calls) => {
      const bot = createTelegramBot({
        token: 'test-token',
        apiBaseUrl,
      });
      await bot.sendMessage('telegram:1', 'hello');
      const sendCalls = calls().filter(
        (m) => m === 'sendMessage' || m === 'sendRichMessage',
      );
      assert.ok(
        sendCalls.length >= 2,
        `expected a retry after 429, got ${sendCalls.length} call(s)`,
      );
    },
  );
});

test('editStreamMessage still retries after a network-level failure (edits are idempotent)', async () => {
  await withStubTelegramServer(
    (method, _body, callIndex) => {
      if (method === 'editMessageText' && callIndex === 0) return 'reset';
      return { status: 200, body: { ok: true, result: { message_id: 42 } } };
    },
    async (apiBaseUrl, calls) => {
      const bot = createTelegramBot({
        token: 'test-token',
        apiBaseUrl,
      });
      await bot.editStreamMessage('telegram:1', 42, 'updated text');
      assert.ok(
        calls().filter((m) => m === 'editMessageText').length >= 2,
        'expected editMessageText to be retried after a network-level failure',
      );
    },
  );
});
