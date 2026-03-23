import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createToolTrackerState,
  extractAssistantTextDeltaFromPiEvent,
  extractThinkingDeltaFromPiEvent,
  extractToolDeltaFromPiEvent,
} from '../src/pi-stream-parser.js';

test('extractAssistantTextDeltaFromPiEvent reads message_update text deltas', () => {
  const delta = extractAssistantTextDeltaFromPiEvent({
    type: 'message_update',
    assistantMessageEvent: { type: 'text_delta', delta: 'hello' },
  });
  assert.deepEqual(delta, { kind: 'append', text: 'hello' });
});

test('extractAssistantTextDeltaFromPiEvent reads snake_case nested deltas', () => {
  const delta = extractAssistantTextDeltaFromPiEvent({
    type: 'message_update',
    assistant_message_event: { type: 'text_delta', delta: 'snake' },
  });
  assert.deepEqual(delta, { kind: 'append', text: 'snake' });
});

test('extractAssistantTextDeltaFromPiEvent reads direct text_delta events', () => {
  const delta = extractAssistantTextDeltaFromPiEvent({
    type: 'text_delta',
    delta: 'direct',
  });
  assert.deepEqual(delta, { kind: 'append', text: 'direct' });
});

test('extractAssistantTextDeltaFromPiEvent reads message_end assistant snapshot', () => {
  const delta = extractAssistantTextDeltaFromPiEvent({
    type: 'message_end',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: 'final answer' }],
    },
  });
  assert.deepEqual(delta, { kind: 'replace', text: 'final answer' });
});

test('extractAssistantTextDeltaFromPiEvent ignores non-assistant message_end', () => {
  const delta = extractAssistantTextDeltaFromPiEvent({
    type: 'message_end',
    message: {
      role: 'user',
      content: [{ type: 'text', text: 'ignored' }],
    },
  });
  assert.equal(delta, null);
});

test('extractToolDeltaFromPiEvent tracks tool start and completion', () => {
  const state = createToolTrackerState();
  const start = extractToolDeltaFromPiEvent(
    {
      type: 'tool_call_start',
      toolName: 'bash',
      toolCallId: 'call-1',
      args: { command: 'pwd' },
    },
    state,
  );
  const end = extractToolDeltaFromPiEvent(
    {
      type: 'tool_call_end',
      toolCallId: 'call-1',
      status: 'ok',
      output: '/workspace',
    },
    state,
  );

  assert.deepEqual(start, {
    index: 1,
    toolName: 'bash',
    status: 'start',
    args: '{"command":"pwd"}',
  });
  assert.deepEqual(end, {
    index: 1,
    toolName: 'bash',
    status: 'ok',
    args: '{"command":"pwd"}',
    output: '/workspace',
  });
});

test('extractToolDeltaFromPiEvent surfaces tool errors', () => {
  const state = createToolTrackerState();
  extractToolDeltaFromPiEvent(
    {
      type: 'tool_execution_start',
      toolName: 'read',
      toolCallId: 'call-2',
      args: { path: '/tmp/missing.txt' },
    },
    state,
  );
  const end = extractToolDeltaFromPiEvent(
    {
      type: 'tool_execution_end',
      toolCallId: 'call-2',
      status: 'error',
      errorMessage: 'ENOENT',
    },
    state,
  );

  assert.deepEqual(end, {
    index: 1,
    toolName: 'read',
    status: 'error',
    args: '{"path":"/tmp/missing.txt"}',
    error: 'ENOENT',
  });
});

test('extractThinkingDeltaFromPiEvent extracts thinking_delta events', () => {
  assert.equal(
    extractThinkingDeltaFromPiEvent({ type: 'thinking_delta', thinking: 'let me think' }),
    'let me think',
  );
  assert.equal(
    extractThinkingDeltaFromPiEvent({ type: 'thinking_delta', delta: 'more thought' }),
    'more thought',
  );
});

test('extractThinkingDeltaFromPiEvent extracts content_block_delta with thinking', () => {
  assert.equal(
    extractThinkingDeltaFromPiEvent({
      type: 'content_block_delta',
      delta: { type: 'thinking_delta', thinking: 'reasoning here' },
    }),
    'reasoning here',
  );
});

test('extractThinkingDeltaFromPiEvent returns null for text events', () => {
  assert.equal(
    extractThinkingDeltaFromPiEvent({ type: 'text_delta', delta: 'hello' }),
    null,
  );
  assert.equal(extractThinkingDeltaFromPiEvent(null), null);
});
