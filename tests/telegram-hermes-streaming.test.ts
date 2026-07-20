import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

test('Telegram flood control disables stale preview edits and permits a fresh final', async () => {
  process.env.FFT_NANO_TELEGRAM_RETRY_ATTEMPTS = '1';
  process.env.FFT_NANO_TELEGRAM_RETRY_MIN_MS = '100';
  process.env.FFT_NANO_TELEGRAM_RETRY_MAX_MS = '100';

  const methods: string[] = [];
  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      const method = (req.url || '').split('/').pop() || '';
      methods.push(method);
      if (method === 'editMessageText') {
        res.writeHead(429, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            ok: false,
            error_code: 429,
            description: 'Too Many Requests',
            parameters: { retry_after: 0 },
          }),
        );
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, result: { message_id: 77 } }));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');

  try {
    const [
      { createTelegramBot },
      { createTelegramAdapter },
      { StreamConsumer },
    ] = await Promise.all([
      import('../src/telegram.js'),
      import('../src/streaming/telegram-adapter.js'),
      import('../src/streaming/stream-consumer.js'),
    ]);
    const bot = createTelegramBot({
      token: 'test-token',
      apiBaseUrl: `http://127.0.0.1:${address.port}`,
    });
    const consumer = new StreamConsumer({
      chatId: 'telegram:-1',
      runId: 'run-flood-e2e',
      adapter: createTelegramAdapter(bot),
      deliveryMode: 'stream',
      verboseMode: 'off',
      draftMinIntervalMs: 10,
    });

    const initial = 'Initial preview content long enough to display.';
    await consumer.onDelta(initial);
    await new Promise((resolve) => setTimeout(resolve, 30));
    for (let strike = 1; strike <= 3; strike++) {
      await consumer.onDelta(`${initial}${'x'.repeat(strike)}`);
      await new Promise((resolve) => setTimeout(resolve, 30));
    }

    assert.equal(consumer.getPreviewState(), null);
    await bot.sendMessage(
      'telegram:-1',
      'Complete answer delivered as a fresh final.',
    );
    assert.equal(
      methods.filter((method) => method === 'editMessageText').length,
      3,
    );
    assert.equal(
      methods.filter(
        (method) => method === 'sendMessage' || method === 'sendRichMessage',
      ).length,
      2,
    );
    consumer.stop();
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
