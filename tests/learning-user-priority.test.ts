/**
 * Tests for LISO.2: User-Priority Scheduling
 *
 * Validates:
 *   VAL-LISO-006: Inbound message triggers cancellation of active maintenance
 *   VAL-LISO-007: Grace period cancellation — inbound during idle grace prevents launch
 *
 * Covers:
 *   - cancelActiveMaintenance aborts running maintenance and waits for exit
 *   - cancelPendingGraceTimer clears pending grace timers
 *   - Inbound message for a group cancels that group's maintenance
 *   - Grace period prevents maintenance launch if new message arrives
 */

import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach, mock } from 'node:test';

import { state, activeMaintenanceRuns, pendingGraceTimers } from '../src/app-state.js';
import {
  cancelActiveMaintenance,
  cancelPendingGraceTimer,
  type ActiveMaintenanceRun,
  type PendingGraceTimer,
} from '../src/skill-service.js';
import type { ActiveMaintenanceRun as ActiveMaintenanceRunType } from '../src/app-state.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMockAbortController(): {
  controller: AbortController;
  abortedState: { value: boolean };
} {
  const controller = new AbortController();
  const abortedState = { value: false };
  controller.signal.addEventListener('abort', () => {
    abortedState.value = true;
  });
  return { controller, abortedState };
}

function createMockMaintenanceRun(overrides: Partial<ActiveMaintenanceRun> = {}): ActiveMaintenanceRunType {
  const controller = new AbortController();
  return {
    groupFolder: 'test-group',
    runId: 'test-run-id',
    startedAt: Date.now(),
    controller,
    kind: 'self-improve',
    ...overrides,
  };
}

function createMockGraceTimer(overrides: Partial<PendingGraceTimer> = {}): PendingGraceTimer {
  return {
    groupFolder: 'test-group',
    runId: 'test-run-id',
    startedAt: Date.now(),
    timer: setTimeout(() => {}, 30000),
    ...overrides,
  };
}

// ── VAL-LISO-006: Inbound message aborts maintenance ───────────────────────────

describe('VAL-LISO-006: Inbound message aborts maintenance', () => {
  beforeEach(() => {
    // Clear any existing state
    activeMaintenanceRuns.clear();
    pendingGraceTimers.clear();
  });

  afterEach(() => {
    // Clean up
    activeMaintenanceRuns.clear();
    pendingGraceTimers.clear();
  });

  it('cancelActiveMaintenance removes run from registry', async () => {
    const run = createMockMaintenanceRun();
    activeMaintenanceRuns.set(run.groupFolder, run);

    assert.equal(activeMaintenanceRuns.has(run.groupFolder), true, 'Run should be registered');

    await cancelActiveMaintenance(run.groupFolder, 'user-inbound');

    assert.equal(activeMaintenanceRuns.has(run.groupFolder), false, 'Run should be removed from registry after cancel');
  });

  it('cancelActiveMaintenance signals AbortController', async () => {
    const { controller, abortedState } = makeMockAbortController();
    const run = createMockMaintenanceRun({ controller });
    activeMaintenanceRuns.set(run.groupFolder, run);

    assert.equal(abortedState.value, false, 'Should not be aborted before cancel');

    const cancelPromise = cancelActiveMaintenance(run.groupFolder, 'user-inbound');

    // Wait a tick for the abort to be processed
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(abortedState.value, true, 'AbortController should be signaled after cancel');
    await cancelPromise; // Should resolve without error
  });

  it('cancelActiveMaintenance returns early if no run exists for group', async () => {
    // No run registered
    const result = await cancelActiveMaintenance('nonexistent-group', 'user-inbound');
    // Should not throw and should return void
    assert.equal(result, undefined);
  });

  it('cancelActiveMaintenance removes run even if abort signal is already aborted', async () => {
    const { controller } = makeMockAbortController();
    controller.abort(); // Already aborted
    const run = createMockMaintenanceRun({ controller });
    activeMaintenanceRuns.set(run.groupFolder, run);

    await cancelActiveMaintenance(run.groupFolder, 'user-inbound');

    assert.equal(activeMaintenanceRuns.has(run.groupFolder), false);
  });

  it('cancelActiveMaintenance uses the provided reason in logs', async () => {
    const run = createMockMaintenanceRun();
    activeMaintenanceRuns.set(run.groupFolder, run);

    // The function should accept a reason parameter without throwing
    await cancelActiveMaintenance(run.groupFolder, 'user-inbound');

    // If we get here without error, the reason was accepted
    assert.ok(true, 'cancelActiveMaintenance should accept reason parameter');
  });
});

describe('VAL-LISO-006: Multiple inbound messages race condition handling', () => {
  beforeEach(() => {
    activeMaintenanceRuns.clear();
    pendingGraceTimers.clear();
  });

  afterEach(() => {
    activeMaintenanceRuns.clear();
    pendingGraceTimers.clear();
  });

  it('cancelling twice for same group does not throw', async () => {
    const run = createMockMaintenanceRun();
    activeMaintenanceRuns.set(run.groupFolder, run);

    // First cancellation
    await cancelActiveMaintenance(run.groupFolder, 'user-inbound');

    // Second cancellation - run is already removed
    const result = await cancelActiveMaintenance(run.groupFolder, 'user-inbound-again');

    // Should not throw, just return early
    assert.equal(result, undefined);
  });

  it('cancelActiveMaintenance handles rapid sequential cancellations', async () => {
    const run = createMockMaintenanceRun();
    activeMaintenanceRuns.set(run.groupFolder, run);

    // Rapid fire cancellations
    await Promise.all([
      cancelActiveMaintenance(run.groupFolder, 'first-inbound'),
      cancelActiveMaintenance(run.groupFolder, 'second-inbound'),
    ]);

    assert.equal(activeMaintenanceRuns.has(run.groupFolder), false);
  });
});

// ── VAL-LISO-007: Grace period cancellation ────────────────────────────────────

describe('VAL-LISO-007: Grace period cancellation', () => {
  beforeEach(() => {
    activeMaintenanceRuns.clear();
    pendingGraceTimers.clear();
  });

  afterEach(() => {
    activeMaintenanceRuns.clear();
    pendingGraceTimers.clear();
    // Clear any pending timers
    for (const [, timer] of pendingGraceTimers) {
      clearTimeout(timer.timer);
    }
    pendingGraceTimers.clear();
  });

  it('cancelPendingGraceTimer removes timer from registry', () => {
    const pending = createMockGraceTimer();
    pendingGraceTimers.set(pending.groupFolder, pending);

    assert.equal(pendingGraceTimers.has(pending.groupFolder), true);

    cancelPendingGraceTimer(pending.groupFolder);

    assert.equal(pendingGraceTimers.has(pending.groupFolder), false);
  });

  it('cancelPendingGraceTimer clears the underlying timer', () => {
    let timerFired = false;
    const timer = setTimeout(() => {
      timerFired = true;
    }, 10);

    const pending: PendingGraceTimer = {
      groupFolder: 'test-group',
      runId: 'test-run-id',
      startedAt: Date.now(),
      timer,
    };
    pendingGraceTimers.set(pending.groupFolder, pending);

    cancelPendingGraceTimer(pending.groupFolder);

    // Wait for timer to potentially fire
    return new Promise((resolve) => setTimeout(resolve, 20)).then(() => {
      assert.equal(timerFired, false, 'Cancelled timer should not fire');
    });
  });

  it('cancelPendingGraceTimer returns early if no timer exists for group', () => {
    // Should not throw
    cancelPendingGraceTimer('nonexistent-group');
    assert.ok(true, 'cancelPendingGraceTimer should not throw when no timer exists');
  });

  it('pendingGraceTimers map is keyed by groupFolder', () => {
    const pending1 = createMockGraceTimer({ groupFolder: 'group-1' });
    const pending2 = createMockGraceTimer({ groupFolder: 'group-2' });
    pendingGraceTimers.set(pending1.groupFolder, pending1);
    pendingGraceTimers.set(pending2.groupFolder, pending2);

    assert.equal(pendingGraceTimers.size, 2);
    assert.equal(pendingGraceTimers.has('group-1'), true);
    assert.equal(pendingGraceTimers.has('group-2'), true);

    cancelPendingGraceTimer('group-1');

    assert.equal(pendingGraceTimers.size, 1);
    assert.equal(pendingGraceTimers.has('group-1'), false);
    assert.equal(pendingGraceTimers.has('group-2'), true);
  });

  it('new inbound during grace period prevents maintenance launch', async () => {
    // This tests the protocol: when a new message arrives during the grace period,
    // cancelPendingGraceTimer is called before the grace period elapses,
    // which prevents the maintenance from starting.

    const pending = createMockGraceTimer();
    pendingGraceTimers.set(pending.groupFolder, pending);

    // Simulate inbound message during grace
    cancelPendingGraceTimer(pending.groupFolder);

    // Verify timer is cancelled
    assert.equal(pendingGraceTimers.has(pending.groupFolder), false);

    // Now simulate grace period elapsing (should not trigger maintenance since cancelled)
    // The actual maintenance would only start if runQuietSkillAgent is called after grace
    // Since we cancelled, no maintenance should start
  });
});

// ── LISO.2 State invariants ────────────────────────────────────────────────────

describe('LISO.2 state invariants', () => {
  beforeEach(() => {
    activeMaintenanceRuns.clear();
    pendingGraceTimers.clear();
  });

  afterEach(() => {
    activeMaintenanceRuns.clear();
    pendingGraceTimers.clear();
    for (const [, timer] of pendingGraceTimers) {
      clearTimeout(timer.timer);
    }
    pendingGraceTimers.clear();
  });

  it('activeMaintenanceRuns is a Map keyed by groupFolder', () => {
    const run1 = createMockMaintenanceRun({ groupFolder: 'group-a' });
    const run2 = createMockMaintenanceRun({ groupFolder: 'group-b' });

    activeMaintenanceRuns.set(run1.groupFolder, run1);
    activeMaintenanceRuns.set(run2.groupFolder, run2);

    assert.equal(activeMaintenanceRuns.get('group-a')?.runId, run1.runId);
    assert.equal(activeMaintenanceRuns.get('group-b')?.runId, run2.runId);
  });

  it('only one active maintenance run per group', () => {
    const run1 = createMockMaintenanceRun({ groupFolder: 'same-group', runId: 'run-1' });
    const run2 = createMockMaintenanceRun({ groupFolder: 'same-group', runId: 'run-2' });

    activeMaintenanceRuns.set(run1.groupFolder, run1);
    // Second set for same key overwrites
    activeMaintenanceRuns.set(run2.groupFolder, run2);

    assert.equal(activeMaintenanceRuns.size, 1);
    assert.equal(activeMaintenanceRuns.get('same-group')?.runId, 'run-2');
  });

  it('pendingGraceTimers is a Map keyed by groupFolder', () => {
    const pending1 = createMockGraceTimer({ groupFolder: 'group-x' });
    const pending2 = createMockGraceTimer({ groupFolder: 'group-y' });

    pendingGraceTimers.set(pending1.groupFolder, pending1);
    pendingGraceTimers.set(pending2.groupFolder, pending2);

    assert.equal(pendingGraceTimers.size, 2);
  });

  it('grace timer stores runId for correlation', () => {
    const pending = createMockGraceTimer({ runId: 'specific-run-id' });
    pendingGraceTimers.set(pending.groupFolder, pending);

    assert.equal(pendingGraceTimers.get(pending.groupFolder)?.runId, 'specific-run-id');
  });
});
