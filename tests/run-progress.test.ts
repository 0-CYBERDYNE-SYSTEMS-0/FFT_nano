import assert from 'node:assert/strict';
import test from 'node:test';

import { createRunProgressReporter } from '../src/run-progress.ts';

test('run progress reporter emits immediate and heartbeat updates for long-running tools', async () => {
  const events: Array<Record<string, unknown>> = [];
  const reporter = createRunProgressReporter({
    source: 'test',
    runId: 'run-1',
    sessionKey: 'main',
    chatJid: 'telegram:1',
    heartbeatMs: 40,
    emit: (event) => {
      events.push(event as Record<string, unknown>);
    },
  });

  reporter.handle({
    kind: 'tool',
    at: Date.now(),
    toolName: 'bash',
    status: 'start',
  });

  await new Promise((resolve) => setTimeout(resolve, 95));
  reporter.stop();

  assert.equal(
    events.some(
      (event) =>
        event.kind === 'run_progress' &&
        event.phase === 'tool_running' &&
        event.detail === 'bash',
    ),
    true,
  );
  assert.equal(
    events.filter(
      (event) =>
        event.kind === 'run_progress' &&
        event.phase === 'tool_running' &&
        typeof event.text === 'string' &&
        String(event.text).includes('Still running'),
    ).length >= 1,
    true,
  );
});

test('run progress reporter emits retry and stale phases as operator-visible statuses', () => {
  const events: Array<Record<string, unknown>> = [];
  const reporter = createRunProgressReporter({
    source: 'test',
    runId: 'run-2',
    sessionKey: 'main',
    chatJid: 'telegram:1',
    heartbeatMs: 1000,
    emit: (event) => {
      events.push(event as Record<string, unknown>);
    },
  });

  reporter.handle({
    kind: 'retry_delay',
    at: Date.now(),
    delayMs: 2500,
    attempt: 1,
    reason: 'timeout',
  });
  reporter.handle({
    kind: 'stale',
    at: Date.now(),
    reason: 'stale_no_progress',
    retryingFresh: true,
  });
  reporter.stop();

  assert.equal(
    events.some(
      (event) =>
        event.kind === 'run_progress' &&
        event.phase === 'retry_delay' &&
        typeof event.text === 'string' &&
        String(event.text).includes('Retrying'),
    ),
    true,
  );
  assert.equal(
    events.some(
      (event) =>
        event.kind === 'run_progress' &&
        event.phase === 'stale' &&
        typeof event.text === 'string' &&
        String(event.text).includes('stalled'),
    ),
    true,
  );
});
