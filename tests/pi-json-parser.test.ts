import test from 'node:test';
import assert from 'node:assert/strict';

import { parsePiJsonOutput } from '../src/pi-json-parser.js';

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

test('tool execution events are captured', () => {
  const stdout = [
    JSON.stringify({
      type: 'tool_execution_start',
      toolCallId: 'a1',
      toolName: 'read',
      args: { path: 'README.md' },
    }),
    JSON.stringify({
      type: 'tool_execution_end',
      toolCallId: 'a1',
      toolName: 'read',
      isError: false,
      output: 'ok',
    }),
    JSON.stringify({
      type: 'message_end',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'done' }],
      },
    }),
  ].join('\n');

  const parsed = parsePiJsonOutput({ stdout });
  assert.equal(parsed.result, 'done');
  assert.equal(parsed.toolExecutions?.length, 1);
  assert.equal(parsed.toolExecutions?.[0]?.toolName, 'read');
  assert.equal(parsed.toolExecutions?.[0]?.status, 'ok');
});

test('tool execution errors include error details', () => {
  const stdout = [
    JSON.stringify({
      type: 'tool_execution_start',
      toolName: 'bash',
      args: { cmd: 'exit 1' },
    }),
    JSON.stringify({
      type: 'tool_execution_end',
      toolName: 'bash',
      isError: true,
      errorMessage: 'Command failed with exit code 1',
    }),
  ].join('\n');

  const parsed = parsePiJsonOutput({ stdout });
  assert.equal(parsed.result, '');
  assert.equal(parsed.toolExecutions?.length, 1);
  assert.equal(parsed.toolExecutions?.[0]?.status, 'error');
  assert.match(parsed.toolExecutions?.[0]?.error || '', /exit code 1/);
});
