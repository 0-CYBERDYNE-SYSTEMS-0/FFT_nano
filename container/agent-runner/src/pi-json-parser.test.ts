import test from 'node:test';
import assert from 'node:assert/strict';

import { parsePiJsonOutput } from './pi-json-parser.js';

test('message_end with thinking-only content returns empty text', () => {
  const stdout = JSON.stringify({
    type: 'message_end',
    message: {
      role: 'assistant',
      content: [{ type: 'thinking', thinking: '<tool_call>read</tool_call>' }],
    },
  });

  const parsed = parsePiJsonOutput({ stdout });
  assert.equal(parsed.result, '');
});

test('json events without assistant text return empty text', () => {
  const stdout =
    JSON.stringify({ type: 'message_update', assistantMessageEvent: { type: 'thinking_end' } }) +
    '\n' +
    JSON.stringify({ type: 'turn_end' });
  const parsed = parsePiJsonOutput({ stdout });
  assert.equal(parsed.result, '');
});

test('assistant text block is extracted', () => {
  const stdout = JSON.stringify({
    type: 'message_end',
    message: {
      role: 'assistant',
      content: [
        { type: 'text', text: 'HEARTBEAT_OK' },
        { type: 'thinking', thinking: 'internal' },
      ],
    },
  });
  const parsed = parsePiJsonOutput({ stdout });
  assert.equal(parsed.result, 'HEARTBEAT_OK');
});

test('provider stopReason error is surfaced', () => {
  const stdout = JSON.stringify({
    type: 'message_end',
    message: {
      role: 'assistant',
      stopReason: 'error',
      errorMessage: 'No models available',
      content: [],
    },
  });

  assert.throws(
    () => parsePiJsonOutput({ stdout }),
    /No models available/,
  );
});

test('non-json stdout falls back to raw text', () => {
  const parsed = parsePiJsonOutput({ stdout: 'plain stdout line\n' });
  assert.equal(parsed.result, 'plain stdout line');
});

