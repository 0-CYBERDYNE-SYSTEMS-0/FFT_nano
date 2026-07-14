import assert from 'node:assert/strict';
import test from 'node:test';

import { toUserVisibleErrorText } from '../src/user-visible-errors.js';

const REF = 'a1b2c3';

test('toUserVisibleErrorText returns rate-limit guidance when detail includes 429', () => {
  // Given: a provider response that reports a rate limit
  const input = {
    kind: 'runner-error' as const,
    detail: 'HTTP 429 Too Many Requests',
    ref: REF,
  };

  // When: the detail is mapped for a Telegram user
  const text = toUserVisibleErrorText(input);

  // Then: the user gets plain retry guidance and a support reference
  assert.match(text, /getting a lot of requests/i);
  assert.match(text, /\(ref: a1b2c3\)$/);
});

test('toUserVisibleErrorText returns setup guidance when detail includes invalid API key', () => {
  // Given: an authentication failure from the AI service
  const input = {
    kind: 'runner-error' as const,
    detail: '401 invalid API key',
    ref: REF,
  };

  // When: the detail is mapped for a Telegram user
  const text = toUserVisibleErrorText(input);

  // Then: the user is directed to the owner setup path
  assert.match(text, /setup problem/i);
  assert.match(text, /\/setup/);
});

test('toUserVisibleErrorText returns network guidance when detail includes ECONNREFUSED', () => {
  // Given: a connection failure from the AI service
  const input = {
    kind: 'runner-error' as const,
    detail: 'ECONNREFUSED 127.0.0.1',
    ref: REF,
  };

  // When: the detail is mapped for a Telegram user
  const text = toUserVisibleErrorText(input);

  // Then: the user is directed to check the machine connection
  assert.match(text, /trouble reaching/i);
  assert.match(text, /internet connection/i);
});

test('toUserVisibleErrorText returns timeout guidance without engineering timing detail', () => {
  // Given: a runner timeout with a raw millisecond duration
  const input = {
    kind: 'timeout' as const,
    detail: 'Pi runner timed out after 90000ms',
    timeoutMs: 90000,
    ref: REF,
  };

  // When: the timeout is mapped for a Telegram user
  const text = toUserVisibleErrorText(input);

  // Then: the user gets a plain-language next step without raw timing detail
  assert.match(text, /took longer/i);
  assert.doesNotMatch(text, /\bms\b|Pi runner/);
});

test('toUserVisibleErrorText returns a retry prompt for empty output', () => {
  // Given: an empty final agent output
  const input = { kind: 'empty-output' as const, ref: REF };

  // When: the outcome is mapped for a Telegram user
  const text = toUserVisibleErrorText(input);

  // Then: the user gets a plain retry prompt
  assert.match(text, /hit a snag/i);
  assert.match(text, /send that again/i);
});

test('toUserVisibleErrorText returns fallback guidance for unknown failures', () => {
  // Given: an unclassified runner failure
  const input = {
    kind: 'runner-error' as const,
    detail: 'unexpected upstream failure',
    ref: REF,
  };

  // When: the detail is mapped for a Telegram user
  const text = toUserVisibleErrorText(input);

  // Then: the user gets generic help with the correlation reference
  assert.match(text, /something went wrong/i);
  assert.match(text, /\(ref: a1b2c3\)$/);
});

test('toUserVisibleErrorText never exposes engineering terms', () => {
  // Given: every supported mapped error outcome
  const texts = [
    toUserVisibleErrorText({ kind: 'empty-output', ref: REF }),
    toUserVisibleErrorText({ kind: 'runner-error', detail: '429', ref: REF }),
    toUserVisibleErrorText({
      kind: 'runner-error',
      detail: '401 invalid API key',
      ref: REF,
    }),
    toUserVisibleErrorText({
      kind: 'runner-error',
      detail: 'ECONNREFUSED',
      ref: REF,
    }),
    toUserVisibleErrorText({
      kind: 'runner-error',
      detail: 'unclassified',
      ref: REF,
    }),
    toUserVisibleErrorText({
      kind: 'timeout',
      detail: 'Pi runner timed out after 90000ms',
      ref: REF,
    }),
  ];

  // When: each message is inspected as Telegram-visible text
  const joined = texts.join('\n');

  // Then: no technical implementation vocabulary reaches the user
  assert.doesNotMatch(
    joined,
    /LLM|Pi runner|tokens|diagnostics|provider=|\b(?:401|403|429)\b|\b\d+ms\b/i,
  );
});
