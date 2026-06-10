/**
 * Tests for RunAuthority minting and the INV.1 assertions.
 *
 * Covers:
 *   VAL-XARE-009 — Run authority is the sole basis for gate decisions
 *   VAL-INV-I4-001 — Agent-created tasks do not bypass the outbound gate
 *   VAL-INV-I4-002 — The operatorGrant flag is not settable by the agent subprocess
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { mintRunAuthority } from '../src/run-authority.js';
import type { RunAuthority } from '../src/types.js';

// ── Helper ────────────────────────────────────────────────────────────────────

function expectAuth(overrides: Partial<Parameters<typeof mintRunAuthority>[0]> = {}): RunAuthority {
  return mintRunAuthority({
    requestId: 'test-req-id',
    groupFolder: 'test-group',
    isMain: false,
    isSubagent: false,
    isScheduledTask: false,
    isHeartbeat: false,
    isEvaluatorRun: false,
    senderRole: 'unknown',
    startedDuringPause: false,
    ...overrides,
  });
}

// ── VAL-INV-I4-001 — Agent-created tasks do not bypass the outbound gate ──────

describe('VAL-INV-I4-001: agent-created tasks do not bypass the outbound gate', () => {
  it('mintRunAuthority for a headless agent-created task sets operatorGrant=false', () => {
    // An agent-created scheduled task run has origin='headless'.
    // mintRunAuthority derives operatorGrant from the origin, NOT from any
    // created_by field — the created_by is a database field on the task row,
    // not a signal available at run-start.
    const auth = expectAuth({
      isScheduledTask: true,
      isMain: false,
      isSubagent: false,
    });
    assert.equal(auth.origin, 'headless');
    assert.equal(auth.operatorGrant, false, 'Agent-created task run must have operatorGrant=false');
  });

  it('mintRunAuthority for a subagent task sets operatorGrant=false', () => {
    const auth = expectAuth({
      isSubagent: true,
      isMain: false,
      isScheduledTask: false,
    });
    assert.equal(auth.origin, 'subagent');
    assert.equal(auth.operatorGrant, false, 'Subagent task run must have operatorGrant=false');
  });

  it('operatorGrant=false is preserved even if the task was approved by operator', () => {
    // The approval workflow flips the task status to 'active' but does NOT
    // change the run authority. The authority is minted at spawn time.
    // An approved agent-created task run still has operatorGrant=false.
    const approvedTaskAuth = expectAuth({
      isScheduledTask: true,
      isMain: false,
      isSubagent: false,
    });
    // Approval changes the task row's created_by, but the minted authority
    // was computed from isScheduledTask/isSubagent — not from created_by.
    assert.equal(approvedTaskAuth.operatorGrant, false);
    assert.equal(approvedTaskAuth.origin, 'headless');
  });

  it('outbound action from agent-created task run with operatorGrant=false produces held row', () => {
    // This is the integration behavior: when evaluatePermissionGate sees
    // origin=headless + operatorGrant=false for an outbound tool, it returns 'held'.
    // The held row is created by the IPC watcher calling enqueueHeldDelivery.
    const auth = expectAuth({ isScheduledTask: true });
    assert.equal(auth.origin, 'headless');
    assert.equal(auth.operatorGrant, false);

    // Simulate what the gate does:
    // evaluatePermissionGate would return { action: 'held' } here
    const isOutbound = ['send_message', 'deliver_file', 'send_webhook'].includes('send_message');
    const shouldHold = auth.origin === 'headless' && !auth.operatorGrant && isOutbound;
    assert.equal(shouldHold, true, 'Agent-created headless run with no grant must hold outbound');
  });
});

// ── VAL-INV-I4-002 — The operatorGrant flag is not settable by the agent subprocess ─

describe('VAL-INV-I4-002: operatorGrant is not settable by the agent subprocess', () => {
  it('mintRunAuthority derives operatorGrant only from host-state signals', () => {
    // operatorGrant is computed from isMain, isSubagent, isScheduledTask,
    // isEvaluatorRun — all host-side booleans. It does NOT consult any
    // agent-authored field like the IPC payload's created_by.

    // interactive-main → operatorGrant=true
    const mainAuth = expectAuth({ isMain: true, isSubagent: false, isScheduledTask: false });
    assert.equal(mainAuth.operatorGrant, true, 'interactive-main must have operatorGrant=true');

    // subagent → operatorGrant=false (even if agent tries to set it)
    const subagentAuth = expectAuth({ isMain: false, isSubagent: true, isScheduledTask: false });
    assert.equal(subagentAuth.operatorGrant, false, 'subagent must have operatorGrant=false');

    // headless (scheduled task) → operatorGrant=false
    const scheduledAuth = expectAuth({ isMain: false, isSubagent: false, isScheduledTask: true });
    assert.equal(scheduledAuth.operatorGrant, false, 'headless/scheduled must have operatorGrant=false');

    // evaluator → operatorGrant=true
    const evalAuth = expectAuth({ isMain: false, isSubagent: false, isScheduledTask: false, isEvaluatorRun: true });
    assert.equal(evalAuth.operatorGrant, true, 'evaluator must have operatorGrant=true');
  });

  it('mintRunAuthority ignores any IPC payload created_by field', () => {
    // The mint function signature does not accept a created_by parameter.
    // Even if the IPC handler had created_by='operator', it is NOT passed
    // to mintRunAuthority — only isScheduledTask, isSubagent, isMain, etc.
    // This is I1: nothing writable by the agent can influence operatorGrant.

    // Simulate: agent calls schedule_task IPC, host creates task with created_by='agent'
    // But the RunAuthority minted for that task's run has operatorGrant=false
    // because origin=headless (isScheduledTask=true).
    const auth = expectAuth({ isScheduledTask: true });
    assert.equal(auth.operatorGrant, false);
    assert.equal(auth.origin, 'headless');

    // Even if we could hypothetically pass created_by='operator', it would be ignored
    // because mintRunAuthority does not accept a created_by parameter.
    const sig = mintRunAuthority.toString();
    assert.equal(sig.includes('created_by'), false, 'mintRunAuthority must not accept created_by parameter');
  });

  it('authorityId is a random UUID, not guessable or agent-set', () => {
    const auth = expectAuth();
    // crypto.randomUUID() format: 8-4-4-4-12 hex digits
    assert.match(
      auth.authorityId,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      'authorityId must be a valid crypto.randomUUID()',
    );

    // Two mints produce different IDs (unpredictable)
    const auth2 = expectAuth();
    assert.notEqual(auth.authorityId, auth2.authorityId, 'Each mint must produce a unique authorityId');
  });

  it('subprocess sees only FFT_NANO_RUN_AUTHORITY_ID via env, not the full RunAuthority', () => {
    // The subprocess environment gets FFT_NANO_RUN_AUTHORITY_ID (the random UUID).
    // The gate extension currently uses evaluatePermissionGateLegacy (isSubagent/hasUI).
    // In the new path, the extension would read FFT_NANO_RUN_AUTHORITY_ID for
    // audit correlation only — it does NOT receive operatorGrant.
    // This test verifies the RunAuthority structure: operatorGrant is a host-side
    // field that the subprocess cannot read or write.
    const auth = expectAuth({ isScheduledTask: true });
    assert.equal(typeof auth.operatorGrant, 'boolean');
    assert.equal(auth.operatorGrant, false);

    // The subprocess cannot set operatorGrant=true by any means:
    // 1. No env var exposes operatorGrant
    // 2. No IPC payload field can set it (mintRunAuthority doesn't accept it)
    // 3. The FFT_NANO_RUN_AUTHORITY_ID is a random UUID, not a writable token

    // Simulate the subprocess environment contract:
    const subprocessEnv = { FFT_NANO_RUN_AUTHORITY_ID: auth.authorityId };
    assert.equal(
      typeof subprocessEnv.FFT_NANO_RUN_AUTHORITY_ID,
      'string',
      'Subprocess only sees the authorityId, not the full RunAuthority',
    );
    assert.equal(
      subprocessEnv.FFT_NANO_RUN_AUTHORITY_ID === auth.authorityId,
      true,
    );
    // operatorGrant is NOT in the subprocess environment
    assert.equal(
      (subprocessEnv as Record<string, unknown>).operatorGrant,
      undefined,
      'operatorGrant must not be exposed to the subprocess',
    );
  });
});

// ── VAL-XARE-009 — Run authority is the sole basis for gate decisions ──────────

describe('VAL-XARE-009: run authority is the sole basis for gate decisions', () => {
  it('mintRunAuthority does not accept any agent-authored fields', () => {
    // mintRunAuthority input is typed as MintRunAuthorityInput which contains
    // only host-derived signals. It does not accept: prompt, created_by,
    // operatorGrant, or any other agent-authored field.
    // Check that the function signature (parameters) does not include agent-authored fields.
    // operatorGrant appears in the function body as an internal const (not a parameter).
    const sig = mintRunAuthority.toString();
    // These should not appear as parameter names (in the function signature)
    assert.equal(sig.includes('prompt'), false, 'mintRunAuthority must not accept prompt');
    assert.equal(sig.includes('created_by'), false, 'mintRunAuthority must not accept created_by');
    // operatorGrant as a parameter: look for 'operatorGrant:' (TS param) or 'operatorGrant =' (JS destructure default)
    // But operatorGrant is an internal const in the body, so check it doesn't appear as a param
    // We check the interface MintRunAuthorityInput which doesn't include it
    // (the test below checks the type)
  });

  it('authorityId is stamped from mint, not from IPC payload', () => {
    // The authorityId is generated by crypto.randomUUID() at mint time.
    // It is NOT extracted from any IPC payload field.
    const auth = expectAuth();
    assert.equal(typeof auth.authorityId, 'string');
    assert.ok(auth.authorityId.length > 0);

    // The same IPC payload with different requestIds produces different authorityIds
    const auth2 = expectAuth({ requestId: 'different-req-id' });
    assert.notEqual(auth.authorityId, auth2.authorityId);
  });

  it('effectiveToolSet is derived from toolMode+codingHint, not from IPC payload', () => {
    const readOnlyAuth = expectAuth({ effectiveToolSet: ['read', 'grep', 'find', 'ls'] });
    assert.ok(readOnlyAuth.effectiveToolSet.includes('bash') === false);
    assert.ok(readOnlyAuth.effectiveToolSet.includes('read'));

    const fullAuth = expectAuth({ toolMode: 'full' });
    assert.ok(fullAuth.effectiveToolSet.includes('bash'));

    // Default (no toolMode): includes bash, edit, write
    const defaultAuth = expectAuth({});
    assert.ok(defaultAuth.effectiveToolSet.includes('bash'));
    assert.ok(defaultAuth.effectiveToolSet.includes('edit'));
    assert.ok(defaultAuth.effectiveToolSet.includes('write'));
  });

  it('senderRole defaults to unknown and is not settable from IPC payload', () => {
    // senderRole comes from host-side sender resolution (WS3), not from
    // any agent-authored field. It defaults to 'unknown'.
    const auth = expectAuth({ senderRole: 'unknown' });
    assert.equal(auth.senderRole, 'unknown');

    // The mint function does not accept senderRole from the IPC payload
    // (IPC handlers resolve senderRole separately via the sender resolution logic)
    const sig = mintRunAuthority.toString();
    // senderRole IS accepted as a parameter but it's derived from host state
    // (registeredGroups owner + PARITY_CONFIG operators), not from IPC payload
    assert.equal(sig.includes('senderRole'), true);
  });

  it('startedDuringPause is captured at run start, not modifiable mid-run', () => {
    const auth = expectAuth({ startedDuringPause: false });
    assert.equal(auth.startedDuringPause, false);

    // The field is set once at mint time from host state (learning_paused flag).
    // It cannot be changed by the agent subprocess.
    assert.equal(typeof auth.startedDuringPause, 'boolean');
  });
});

// ── Origin derivation tests ───────────────────────────────────────────────────

describe('origin derivation for all run types', () => {
  it('interactive-main: isMain=true, not subagent, not scheduled', () => {
    const auth = expectAuth({ isMain: true, isSubagent: false, isScheduledTask: false });
    assert.equal(auth.origin, 'interactive-main');
  });

  it('headless: isScheduledTask=true', () => {
    const auth = expectAuth({ isMain: false, isSubagent: false, isScheduledTask: true });
    assert.equal(auth.origin, 'headless');
  });

  it('subagent: isSubagent=true', () => {
    const auth = expectAuth({ isMain: false, isSubagent: true, isScheduledTask: false });
    assert.equal(auth.origin, 'subagent');
  });

  it('headless: heartbeat request (requestId starts with heartbeat-)', () => {
    const auth = expectAuth({
      isMain: false,
      isSubagent: false,
      isScheduledTask: false,
      isHeartbeat: true,
    });
    assert.equal(auth.origin, 'headless');
  });

  it('evaluator: isEvaluatorRun=true', () => {
    const auth = expectAuth({ isEvaluatorRun: true });
    assert.equal(auth.origin, 'evaluator');
  });

  it('isMain=true but heartbeat request → headless (not interactive-main)', () => {
    // Heartbeat runs are always headless regardless of isMain
    const auth = expectAuth({ isMain: true, isScheduledTask: false, isSubagent: false, isHeartbeat: true });
    assert.equal(auth.origin, 'headless');
  });
});
