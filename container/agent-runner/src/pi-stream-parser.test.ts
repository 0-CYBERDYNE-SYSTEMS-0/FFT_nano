import assert from 'node:assert/strict';
import test from 'node:test';

import { extractAssistantTextDeltaFromPiEvent } from './pi-stream-parser.js';

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
