import assert from 'node:assert/strict';
import test from 'node:test';

import {
  recordHeartbeatOutcome,
  buildHeartbeatHealthAlert,
  buildHeartbeatHealthPromptContext,
  isTelegramTransientError,
  exponentialBackoffMs,
  runWithTransientRetry,
  type HeartbeatHealthState,
  type HeartbeatFailureReason,
} from '../src/heartbeat-policy.ts';

const HEALTHY: HeartbeatHealthState = {
  consecutiveFailures: 0,
  lastReason: null,
  lastFailureAt: null,
};

// ---------------------------------------------------------------------------
// SPEC-07 / TDD plan #1: consecutive failure tracking
// ---------------------------------------------------------------------------

test.describe('SPEC-07: consecutive failure counter', () => {
  test('2 failures → consecutiveFailures=2, next success → consecutiveFailures=0', () => {
    const reason: HeartbeatFailureReason = { tag: 'telegram_transient' };
    const afterFirst = recordHeartbeatOutcome(
      HEALTHY,
      { ok: false, reason },
      { failureThreshold: 3, now: 1000 },
    );
    assert.equal(afterFirst.state.consecutiveFailures, 1);
    assert.equal(afterFirst.state.lastReason?.tag, 'telegram_transient');
    assert.equal(afterFirst.state.lastFailureAt, 1000);

    const afterSecond = recordHeartbeatOutcome(
      afterFirst.state,
      { ok: false, reason },
      { failureThreshold: 3, now: 2000 },
    );
    assert.equal(afterSecond.state.consecutiveFailures, 2);
    assert.equal(afterSecond.becameAlert, false);

    const afterSuccess = recordHeartbeatOutcome(
      afterSecond.state,
      { ok: true },
      { failureThreshold: 3, now: 3000 },
    );
    assert.equal(afterSuccess.state.consecutiveFailures, 0);
    assert.equal(afterSuccess.state.lastReason, null);
    assert.equal(afterSuccess.state.lastFailureAt, null);
    assert.equal(afterSuccess.resolved, true);
  });

  test('successive failures without intervening success keep incrementing', () => {
    const reason: HeartbeatFailureReason = { tag: 'agent_permanent' };
    let state: HeartbeatHealthState = HEALTHY;
    for (let i = 1; i <= 5; i++) {
      const update = recordHeartbeatOutcome(
        state,
        { ok: false, reason },
        { failureThreshold: 3, now: i * 1000 },
      );
      state = update.state;
      assert.equal(state.consecutiveFailures, i);
    }
    assert.equal(state.consecutiveFailures, 5);
  });
});

// ---------------------------------------------------------------------------
// SPEC-07 / TDD plan #2: alert escalation
// ---------------------------------------------------------------------------

test.describe('SPEC-07: alert escalation', () => {
  test('consecutiveFailures=2 → no alert marker; consecutiveFailures=3 → alert marker', () => {
    const reason: HeartbeatFailureReason = { tag: 'telegram_transient' };
    const below = buildHeartbeatHealthAlert({
      consecutiveFailures: 2,
      lastReason: reason,
      failureThreshold: 3,
    });
    assert.equal(below.isAlert, false);
    assert.equal(below.text, '');

    const at = buildHeartbeatHealthAlert({
      consecutiveFailures: 3,
      lastReason: reason,
      failureThreshold: 3,
    });
    assert.equal(at.isAlert, true);
    assert.match(at.text, /HEARTBEAT_ALERT/);
    assert.match(at.text, /3_consecutive/);
    assert.match(at.text, /telegram_transient/);
  });

  test('threshold=0 disables alert tier regardless of consecutive count', () => {
    const reason: HeartbeatFailureReason = { tag: 'telegram_transient' };
    const at = buildHeartbeatHealthAlert({
      consecutiveFailures: 100,
      lastReason: reason,
      failureThreshold: 0,
    });
    assert.equal(at.isAlert, false);
    assert.equal(at.text, '');
  });

  test('becameAlert is true on the transition from 2 → 3 failures, not on every later failure', () => {
    const reason: HeartbeatFailureReason = { tag: 'telegram_transient' };
    const two = recordHeartbeatOutcome(
      HEALTHY,
      { ok: false, reason },
      { failureThreshold: 3, now: 1 },
    );
    const twoState = recordHeartbeatOutcome(
      two.state,
      { ok: false, reason },
      { failureThreshold: 3, now: 2 },
    ).state;
    assert.equal(twoState.consecutiveFailures, 2);

    const three = recordHeartbeatOutcome(
      twoState,
      { ok: false, reason },
      { failureThreshold: 3, now: 3 },
    );
    assert.equal(three.becameAlert, true);

    const four = recordHeartbeatOutcome(
      three.state,
      { ok: false, reason },
      { failureThreshold: 3, now: 4 },
    );
    assert.equal(four.becameAlert, false);
  });
});

// ---------------------------------------------------------------------------
// SPEC-07 / TDD plan #3: transient retry with backoff
// ---------------------------------------------------------------------------

test.describe('SPEC-07: transient retry', () => {
  test('Telegram error on attempt 1, success on attempt 2 → retried, logged once as "attempt 2/3", marked as recovered', async () => {
    const retries: Array<{ attempt: number; maxAttempts: number; err: unknown }> = [];
    let calls = 0;
    const result = await runWithTransientRetry({
      fn: async () => {
        calls += 1;
        if (calls === 1) throw new Error('Telegram Connection error');
        return 'ok';
      },
      attempts: 3,
      isTransient: isTelegramTransientError,
      sleepMs: () => 0,
      onRetry: (info) => retries.push(info),
    });
    assert.equal(calls, 2);
    assert.equal(result.value, 'ok');
    assert.equal(result.attempts, 2);
    assert.equal(result.recovered, true);
    assert.equal(retries.length, 1);
    assert.equal(retries[0]!.attempt, 2);
    assert.equal(retries[0]!.maxAttempts, 3);
  });

  test('non-transient error is not retried', async () => {
    let calls = 0;
    await assert.rejects(
      runWithTransientRetry({
        fn: async () => {
          calls += 1;
          throw new Error('ValidationError: bad prompt');
        },
        attempts: 3,
        isTransient: isTelegramTransientError,
        sleepMs: () => 0,
      }),
    );
    assert.equal(calls, 1);
  });

  test('all transient attempts exhausted → throws last error', async () => {
    let calls = 0;
    await assert.rejects(
      runWithTransientRetry({
        fn: async () => {
          calls += 1;
          throw new Error('Telegram Connection error');
        },
        attempts: 3,
        isTransient: isTelegramTransientError,
        sleepMs: () => 0,
      }),
    );
    assert.equal(calls, 3);
  });

  test('isTelegramTransientError matches Telegram connection / network errors only', () => {
    assert.equal(isTelegramTransientError(new Error('Telegram Connection error')), true);
    assert.equal(isTelegramTransientError(new Error('ETIMEDOUT')), true);
    assert.equal(isTelegramTransientError(new Error('ECONNRESET')), true);
    assert.equal(isTelegramTransientError(new Error('ValidationError: bad prompt')), false);
    assert.equal(isTelegramTransientError(null), false);
  });

  test('exponentialBackoffMs grows exponentially and caps', () => {
    assert.equal(exponentialBackoffMs(1, 100, 10_000), 100);
    assert.equal(exponentialBackoffMs(2, 100, 10_000), 200);
    assert.equal(exponentialBackoffMs(3, 100, 10_000), 400);
    assert.equal(exponentialBackoffMs(10, 100, 10_000), 10_000);
  });
});

// ---------------------------------------------------------------------------
// SPEC-07 / TDD plan #4: context injection
// ---------------------------------------------------------------------------

test.describe('SPEC-07: prompt context injection', () => {
  test('consecutiveFailures > 0 → prompt context includes diagnostic line', () => {
    const ctx = buildHeartbeatHealthPromptContext({
      consecutiveFailures: 2,
      lastReason: { tag: 'telegram_transient' },
      failureThreshold: 3,
    });
    assert.ok(ctx.contextLine, 'expected a diagnostic line when failures > 0');
    assert.match(
      ctx.contextLine!,
      /HEALTH: Last check failed 2 times \(reason: telegram_transient\)/,
    );
    assert.equal(ctx.alert, false);
  });

  test('consecutiveFailures >= 3 → includes top-level alert', () => {
    const ctx = buildHeartbeatHealthPromptContext({
      consecutiveFailures: 3,
      lastReason: { tag: 'telegram_transient' },
      failureThreshold: 3,
    });
    assert.ok(ctx.contextLine);
    assert.equal(ctx.alert, true);
  });

  test('consecutiveFailures=0 (healthy) → no diagnostic line and no alert', () => {
    const ctx = buildHeartbeatHealthPromptContext({
      consecutiveFailures: 0,
      lastReason: null,
      failureThreshold: 3,
    });
    assert.equal(ctx.contextLine, null);
    assert.equal(ctx.alert, false);
  });

  test('threshold=0 disables alert marker in prompt context', () => {
    const ctx = buildHeartbeatHealthPromptContext({
      consecutiveFailures: 5,
      lastReason: { tag: 'telegram_transient' },
      failureThreshold: 0,
    });
    assert.ok(ctx.contextLine);
    assert.equal(ctx.alert, false);
  });
});
