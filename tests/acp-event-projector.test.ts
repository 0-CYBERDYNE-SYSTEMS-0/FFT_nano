import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createAcpProjectionState,
  projectEventToAcpNotifications,
} from '../src/acp/acp-event-projector.js';
import type { HostEvent } from '../src/runtime/host-events.js';

function event(
  value: Omit<HostEvent, 'id' | 'createdAt' | 'source'>,
): HostEvent {
  return {
    ...value,
    id: 'evt-1',
    createdAt: '2026-07-27T12:00:00.000Z',
    source: 'test',
  };
}

test('projects accumulated assistant text as incremental ACP chunks', () => {
  // Given
  const state = createAcpProjectionState();
  const first = event({
    kind: 'run_state',
    runId: 'run-1',
    sessionKey: 'main',
    state: 'delta',
    message: { role: 'assistant', content: 'Hello' },
  });
  const second = event({
    kind: 'run_state',
    runId: 'run-1',
    sessionKey: 'main',
    state: 'delta',
    message: { role: 'assistant', content: 'Hello world' },
  });

  // When
  const firstUpdates = projectEventToAcpNotifications(
    first,
    'main',
    'run-1',
    state,
  );
  const secondUpdates = projectEventToAcpNotifications(
    second,
    'main',
    'run-1',
    state,
  );

  // Then
  assert.equal(firstUpdates.length, 1);
  assert.deepEqual(firstUpdates[0]?.update, {
    sessionUpdate: 'agent_message_chunk',
    messageId: 'run-1',
    content: { type: 'text', text: 'Hello' },
  });
  assert.deepEqual(secondUpdates[0]?.update, {
    sessionUpdate: 'agent_message_chunk',
    messageId: 'run-1',
    content: { type: 'text', text: ' world' },
  });
});

test('projects tool lifecycle updates for the active ACP run', () => {
  // Given
  const state = createAcpProjectionState();
  const start = event({
    kind: 'tool_progress',
    runId: 'run-1',
    sessionKey: 'main',
    index: 3,
    toolName: 'bash',
    status: 'start',
    args: '{"command":"pwd"}',
  });
  const complete = event({
    kind: 'tool_progress',
    runId: 'run-1',
    sessionKey: 'main',
    index: 3,
    toolName: 'bash',
    status: 'ok',
    output: '/workspace',
  });

  // When
  const started = projectEventToAcpNotifications(start, 'main', 'run-1', state);
  const completed = projectEventToAcpNotifications(
    complete,
    'main',
    'run-1',
    state,
  );

  // Then
  assert.deepEqual(started[0]?.update, {
    sessionUpdate: 'tool_call',
    toolCallId: 'run-1:3',
    title: 'bash',
    kind: 'execute',
    status: 'in_progress',
    rawInput: '{"command":"pwd"}',
  });
  assert.deepEqual(completed[0]?.update, {
    sessionUpdate: 'tool_call_update',
    toolCallId: 'run-1:3',
    status: 'completed',
    rawOutput: '/workspace',
    content: [
      {
        type: 'content',
        content: { type: 'text', text: '/workspace' },
      },
    ],
  });
});

test('projects message, error, and lifecycle status events', () => {
  // Given
  const state = createAcpProjectionState();
  const message = event({
    kind: 'run_state',
    runId: 'run-1',
    sessionKey: 'main',
    state: 'message',
    message: { role: 'assistant', content: 'Complete response' },
  });
  const error = event({
    kind: 'run_state',
    runId: 'run-1',
    sessionKey: 'main',
    state: 'error',
    errorMessage: 'Provider failed',
  });
  const started = event({
    kind: 'run_state',
    runId: 'run-1',
    sessionKey: 'main',
    phase: 'start',
    detail: 'running',
  });
  const spawned = event({
    kind: 'run_progress',
    runId: 'run-1',
    sessionKey: 'main',
    phase: 'spawn',
    text: 'Starting agent',
  });

  // When
  const messageUpdates = projectEventToAcpNotifications(
    message,
    'main',
    'run-1',
    state,
  );
  const errorUpdates = projectEventToAcpNotifications(
    error,
    'main',
    'run-1',
    state,
  );
  const statusUpdates = [
    ...projectEventToAcpNotifications(started, 'main', 'run-1', state),
    ...projectEventToAcpNotifications(spawned, 'main', 'run-1', state),
  ];

  // Then
  assert.equal(messageUpdates[0]?.update.sessionUpdate, 'agent_message_chunk');
  assert.deepEqual(errorUpdates[0]?.update, {
    sessionUpdate: 'agent_message_chunk',
    messageId: 'run-1:error',
    content: { type: 'text', text: 'Error: Provider failed' },
  });
  assert.deepEqual(
    statusUpdates.map((notification) => notification.update),
    [
      {
        sessionUpdate: 'agent_thought_chunk',
        messageId: 'run-1:status',
        content: { type: 'text', text: 'Run started: running' },
      },
      {
        sessionUpdate: 'agent_thought_chunk',
        messageId: 'run-1:status',
        content: { type: 'text', text: 'Starting agent' },
      },
    ],
  );
});

test('does not project events from another run or channel-only events', () => {
  // Given
  const state = createAcpProjectionState();
  const unrelated = event({
    kind: 'run_progress',
    runId: 'run-2',
    sessionKey: 'main',
    phase: 'thinking',
    text: 'Thinking',
  });
  const delivery = event({
    kind: 'chat_delivery_requested',
    chatJid: 'telegram:1',
    text: 'channel only',
  });

  // When
  const unrelatedUpdates = projectEventToAcpNotifications(
    unrelated,
    'main',
    'run-1',
    state,
  );
  const deliveryUpdates = projectEventToAcpNotifications(
    delivery,
    'main',
    'run-1',
    state,
  );

  // Then
  assert.deepEqual(unrelatedUpdates, []);
  assert.deepEqual(deliveryUpdates, []);
});
