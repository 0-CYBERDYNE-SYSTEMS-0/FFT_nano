import assert from 'node:assert/strict';
import test from 'node:test';

import type { AnyMessage } from '@agentclientprotocol/sdk';

import { createAcpStdioStream } from '../src/acp/acp-stdio-transport.js';

test('keeps malformed input diagnostics outside the ACP message stream', async () => {
  const encoder = new TextEncoder();
  const input = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          'not-json\n42\n{"jsonrpc":"2.0","id":1,"method":"initialize"}\n',
        ),
      );
      controller.close();
    },
  });
  const output = new WritableStream<Uint8Array>();
  const diagnostics: string[] = [];
  const transport = createAcpStdioStream(input, output, (message) => {
    diagnostics.push(message);
  });
  const reader = transport.stream.readable.getReader();

  assert.deepEqual(await reader.read(), {
    done: false,
    value: {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
    },
  });
  assert.deepEqual(await reader.read(), { done: true, value: undefined });
  assert.deepEqual(diagnostics, [
    'ACP stdio ignored malformed JSON input',
    'ACP stdio ignored a JSON value that is not an object',
  ]);
  assert.equal(transport.getError(), null);
});

test('turns a broken output pipe into a readable transport failure', async () => {
  const failure = new Error('broken stdout');
  const input = new ReadableStream<Uint8Array>();
  const output = new WritableStream<Uint8Array>({
    write() {
      throw failure;
    },
  });
  const transport = createAcpStdioStream(input, output);
  const reader = transport.stream.readable.getReader();
  const writer = transport.stream.writable.getWriter();
  const message: AnyMessage = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
  };

  await assert.rejects(writer.write(message), /broken stdout/);
  await assert.rejects(reader.read(), /broken stdout/);
  assert.equal(transport.getError(), failure);
});
