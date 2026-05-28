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

test('tool-use assistant preamble is not returned as final output', () => {
  const finalAnswer =
    "I've researched and thought about this, and the best answer is the post-tool response.";
  const stdout = [
    JSON.stringify({
      type: 'message_end',
      message: {
        role: 'assistant',
        stopReason: 'toolUse',
        content: [
          {
            type: 'text',
            text: "Alright, I've read context and I need to research this.",
          },
        ],
      },
    }),
    JSON.stringify({
      type: 'tool_execution_start',
      toolCallId: 'search-1',
      toolName: 'web_search',
      args: { query: 'latest context' },
    }),
    JSON.stringify({
      type: 'tool_execution_end',
      toolCallId: 'search-1',
      toolName: 'web_search',
      output: 'search results',
    }),
    JSON.stringify({
      type: 'message_end',
      message: {
        role: 'assistant',
        stopReason: 'stop',
        content: [{ type: 'text', text: finalAnswer }],
      },
    }),
  ].join('\n');

  const parsed = parsePiJsonOutput({ stdout });
  assert.equal(parsed.result, finalAnswer);
  assert.doesNotMatch(parsed.result, /^Alright, I've read context/);
});

test('tool-use preamble followed by empty final assistant turn returns empty', () => {
  const stdout = [
    JSON.stringify({
      type: 'message_end',
      message: {
        role: 'assistant',
        stopReason: 'toolUse',
        content: [{ type: 'text', text: 'Let me check that first.' }],
      },
    }),
    JSON.stringify({
      type: 'tool_execution_start',
      toolCallId: 'read-1',
      toolName: 'read',
      args: { path: 'README.md' },
    }),
    JSON.stringify({
      type: 'tool_execution_end',
      toolCallId: 'read-1',
      toolName: 'read',
      output: 'ok',
    }),
    JSON.stringify({
      type: 'message_end',
      message: {
        role: 'assistant',
        stopReason: 'end_turn',
        content: [],
      },
    }),
  ].join('\n');

  const parsed = parsePiJsonOutput({ stdout });
  assert.equal(parsed.result, '');
});

test('assistant text deltas followed by empty final message_end return streamed answer', () => {
  const stdout = [
    JSON.stringify({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: 'The answer is ' },
    }),
    JSON.stringify({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: '42.' },
    }),
    JSON.stringify({
      type: 'message_end',
      message: {
        role: 'assistant',
        stopReason: 'end_turn',
        content: [],
      },
    }),
  ].join('\n');

  const parsed = parsePiJsonOutput({ stdout });
  assert.equal(parsed.result, 'The answer is 42.');
});

test('snake_case assistant text deltas followed by empty final message_end return streamed answer', () => {
  const stdout = [
    JSON.stringify({
      type: 'message_update',
      assistant_message_event: { type: 'text_delta', delta: 'snake ' },
    }),
    JSON.stringify({
      type: 'message_update',
      assistant_message_event: { type: 'text_delta', delta: 'case' },
    }),
    JSON.stringify({
      type: 'message_end',
      message: {
        role: 'assistant',
        stop_reason: 'stop',
        content: [],
      },
    }),
  ].join('\n');

  const parsed = parsePiJsonOutput({ stdout });
  assert.equal(parsed.result, 'snake case');
});

test('streamed tool-use preamble followed by empty final assistant turn returns empty', () => {
  const stdout = [
    JSON.stringify({
      type: 'message_update',
      assistantMessageEvent: {
        type: 'text_delta',
        delta: 'Let me check that first.',
      },
    }),
    JSON.stringify({
      type: 'message_end',
      message: {
        role: 'assistant',
        stopReason: 'toolUse',
        content: [],
      },
    }),
    JSON.stringify({
      type: 'tool_execution_start',
      toolCallId: 'read-1',
      toolName: 'read',
      args: { path: 'README.md' },
    }),
    JSON.stringify({
      type: 'tool_execution_end',
      toolCallId: 'read-1',
      toolName: 'read',
      output: 'ok',
    }),
    JSON.stringify({
      type: 'message_end',
      message: {
        role: 'assistant',
        stopReason: 'end_turn',
        content: [],
      },
    }),
  ].join('\n');

  const parsed = parsePiJsonOutput({ stdout });
  assert.equal(parsed.result, '');
});

test('legacy assistant text with missing stop reason is still final output', () => {
  const stdout = JSON.stringify({
    type: 'message_end',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: 'legacy final answer' }],
    },
  });

  const parsed = parsePiJsonOutput({ stdout });
  assert.equal(parsed.result, 'legacy final answer');
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
