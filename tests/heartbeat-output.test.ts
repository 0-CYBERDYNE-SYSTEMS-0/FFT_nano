import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isHeartbeatAckOnly,
  looksLikeJsonEventStream,
  looksLikeThinkingOnlyToolCall,
} from '../src/heartbeat-output.js';

test('exact HEARTBEAT_OK is treated as ack-only', () => {
  assert.equal(isHeartbeatAckOnly('HEARTBEAT_OK'), true);
});

test('HEARTBEAT_OK wrapped in markup is treated as ack-only', () => {
  assert.equal(isHeartbeatAckOnly('<b>HEARTBEAT_OK</b>'), true);
  assert.equal(isHeartbeatAckOnly('**HEARTBEAT_OK**'), true);
});

test('thinking-only tool call payload is treated as ack-only', () => {
  const payload = '<tool_call>read<arg_key>path</arg_key></tool_call>';
  assert.equal(looksLikeThinkingOnlyToolCall(payload), true);
  assert.equal(isHeartbeatAckOnly(payload), true);
});

test('json event stream payload is treated as ack-only', () => {
  const payload =
    '{"type":"message_update","assistantMessageEvent":{"type":"thinking_end"}}\n' +
    '{"type":"turn_end","message":{"role":"assistant"}}';
  assert.equal(looksLikeJsonEventStream(payload), true);
  assert.equal(isHeartbeatAckOnly(payload), true);
});

test('actionable heartbeat text is not treated as ack-only', () => {
  assert.equal(
    isHeartbeatAckOnly('Need action: restart scheduler and notify admin.'),
    false,
  );
  assert.equal(isHeartbeatAckOnly('HEARTBEAT_OK and also do X'), false);
});

