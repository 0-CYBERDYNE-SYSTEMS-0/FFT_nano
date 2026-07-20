import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

test('Telegram flood control disables stale preview edits and permits a fresh final', async () => {
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

test('formatted final edit does not retry flood control as a plain edit', async () => {
  let edits = 0;
  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      if ((req.url || '').endsWith('/editMessageText')) edits++;
      res.writeHead(429, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: false,
          error_code: 429,
          description: 'Too Many Requests',
          parameters: { retry_after: 0 },
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');

  try {
    const [{ createTelegramBot }, { createTelegramAdapter }] =
      await Promise.all([
        import('../src/telegram.js'),
        import('../src/streaming/telegram-adapter.js'),
      ]);
    const bot = createTelegramBot({
      token: 'test-token',
      apiBaseUrl: `http://127.0.0.1:${address.port}`,
    });
    const result = await createTelegramAdapter(bot).editMessage(
      'telegram:-1',
      '77',
      'Final answer',
      true,
    );

    assert.equal(result.success, false);
    assert.equal(result.floodControl, true);
    assert.equal(edits, 1);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test('completion finalization performs one raw edit before fresh-send fallback', async () => {
  let edits = 0;
  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      const method = (req.url || '').split('/').pop() || '';
      if (method === 'editMessageText') {
        edits++;
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
      res.end(JSON.stringify({ ok: true, result: { message_id: 78 } }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');

  const [{ createTelegramBot }, { state }, { finalizeTelegramPreviewMessage }] =
    await Promise.all([
      import('../src/telegram.js'),
      import('../src/app-state.js'),
      import('../src/telegram-delivery.js'),
    ]);
  const originalTelegramBot = state.telegramBot;
  state.telegramBot = createTelegramBot({
    token: 'test-token',
    apiBaseUrl: `http://127.0.0.1:${address.port}`,
  });

  try {
    const finalized = await finalizeTelegramPreviewMessage(
      'telegram:-1',
      77,
      'x'.repeat(5_000),
    );

    assert.equal(finalized, true);
    assert.equal(edits, 1);
  } finally {
    state.telegramBot = originalTelegramBot;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
