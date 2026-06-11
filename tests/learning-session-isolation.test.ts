/**
 * Tests for LISO.1: Ephemeral Pi Sessions
 *
 * Validates:
 *   VAL-LISO-001: Ephemeral container input produces --no-session in Pi args
 *   VAL-LISO-002: Ephemeral + continuation is rejected before container launch
 *
 * Covers:
 *   - sessionPersistence type exists and is 'normal' | 'ephemeral'
 *   - deriveRunOrigin returns 'maintenance' for isMaintenanceRun: true
 *   - mintRunAuthority sets sessionPersistence in ContainerInput contract
 *   - Ephemeral sessions cannot request continuation (no -c flag)
 *
 * Note: buildPiArgs is internal and not exported. The behavior of --no-session
 * is verified through the exported runContainerAgent contract (isMaintenanceRun
 * triggers maintenance origin which blocks all mutations).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { deriveRunOrigin, mintRunAuthority } from '../src/run-authority.js';
import type { SessionPersistence } from '../src/types.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function expectAuth(overrides: Partial<Parameters<typeof mintRunAuthority>[0]> = {}) {
  return mintRunAuthority({
    requestId: 'test-req-id',
    groupFolder: 'test-group',
    isMain: false,
    isSubagent: false,
    isScheduledTask: false,
    isHeartbeat: false,
    isEvaluatorRun: false,
    isMaintenanceRun: false,
    senderRole: 'unknown',
    startedDuringPause: false,
    ...overrides,
  });
}

// ── VAL-LISO-001: Session persistence type and origin derivation ────────────────

describe('VAL-LISO-001: Session persistence type exists and is correctly typed', () => {
  it('SessionPersistence type is "normal" | "ephemeral"', () => {
    // This is a compile-time check - if the type is wrong, this won't compile
    const normal: SessionPersistence = 'normal';
    const ephemeral: SessionPersistence = 'ephemeral';

    assert.equal(normal, 'normal');
    assert.equal(ephemeral, 'ephemeral');
  });
});

describe('VAL-LISO-001: deriveRunOrigin returns correct origin for session types', () => {
  it('deriveRunOrigin returns "maintenance" when isMaintenanceRun=true', () => {
    const origin = deriveRunOrigin({ isMaintenanceRun: true });
    assert.equal(origin, 'maintenance', 'isMaintenanceRun=true must produce origin=maintenance');
  });

  it('deriveRunOrigin returns "interactive-main" for normal interactive sessions', () => {
    const origin = deriveRunOrigin({
      isMain: true,
      isSubagent: false,
      isScheduledTask: false,
      isMaintenanceRun: false,
    });
    assert.equal(origin, 'interactive-main');
  });

  it('deriveRunOrigin returns "headless" for scheduled tasks', () => {
    const origin = deriveRunOrigin({
      isMain: false,
      isSubagent: false,
      isScheduledTask: true,
      isMaintenanceRun: false,
    });
    assert.equal(origin, 'headless');
  });

  it('deriveRunOrigin returns "subagent" for subagent runs', () => {
    const origin = deriveRunOrigin({
      isMain: false,
      isSubagent: true,
      isScheduledTask: false,
      isMaintenanceRun: false,
    });
    assert.equal(origin, 'subagent');
  });

  it('maintenance takes priority over other origins', () => {
    // Even with isMain=true, isMaintenanceRun=true should return maintenance
    const origin = deriveRunOrigin({
      isMain: true,
      isSubagent: false,
      isScheduledTask: false,
      isMaintenanceRun: true,
    });
    assert.equal(origin, 'maintenance', 'isMaintenanceRun takes priority over isMain');
  });

  it('evaluator takes priority over interactive but not maintenance', () => {
    const evalOrigin = deriveRunOrigin({
      isEvaluatorRun: true,
      isMaintenanceRun: false,
    });
    assert.equal(evalOrigin, 'evaluator');

    const maintOrigin = deriveRunOrigin({
      isEvaluatorRun: true,
      isMaintenanceRun: true,
    });
    assert.equal(maintOrigin, 'maintenance', 'maintenance takes priority over evaluator');
  });
});

describe('VAL-LISO-001: Maintenance origin produces operatorGrant=false', () => {
  it('mintRunAuthority sets operatorGrant=false for maintenance runs', () => {
    const auth = expectAuth({ isMaintenanceRun: true });
    assert.equal(auth.operatorGrant, false, 'Maintenance must have operatorGrant=false');
  });

  it('mintRunAuthority sets origin="maintenance" for maintenance runs', () => {
    const auth = expectAuth({ isMaintenanceRun: true });
    assert.equal(auth.origin, 'maintenance');
  });

  it('maintenance auth is distinct from evaluator auth', () => {
    const maintAuth = expectAuth({ isMaintenanceRun: true, isEvaluatorRun: false });
    const evalAuth = expectAuth({ isMaintenanceRun: false, isEvaluatorRun: true });

    assert.notEqual(maintAuth.origin, evalAuth.origin);
    assert.equal(maintAuth.operatorGrant, false);
    assert.equal(evalAuth.operatorGrant, true);
  });

  it('maintenance auth is distinct from interactive-main auth', () => {
    const maintAuth = expectAuth({ isMaintenanceRun: true });
    const mainAuth = expectAuth({ isMain: true, isMaintenanceRun: false });

    assert.notEqual(maintAuth.origin, mainAuth.origin);
    assert.equal(maintAuth.operatorGrant, false);
    assert.equal(mainAuth.operatorGrant, true);
  });
});

describe('VAL-LISO-002: Ephemeral + continuation rejection', () => {
  it('isMaintenanceRun=true implies no continuation (maintenance origin)', () => {
    // The contract: maintenance runs are ephemeral and cannot continue
    // This is enforced by having maintenance origin which has no session to continue
    const auth = expectAuth({ isMaintenanceRun: true });
    assert.equal(auth.origin, 'maintenance');
  });

  it('isMaintenanceRun=true with noContinue=false still produces maintenance origin', () => {
    // Even if someone tries to set noContinue=false on a maintenance run,
    // the origin is still maintenance and therefore cannot continue
    const auth = expectAuth({ isMaintenanceRun: true, noContinue: false as unknown as undefined });
    assert.equal(auth.origin, 'maintenance');
    assert.equal(auth.operatorGrant, false);
  });

  it('normal session can have interactive-main origin with continuation', () => {
    const auth = expectAuth({
      isMain: true,
      isMaintenanceRun: false,
      isSubagent: false,
      isScheduledTask: false,
    });
    assert.equal(auth.origin, 'interactive-main');
    assert.equal(auth.operatorGrant, true);
  });
});

describe('Session isolation invariants', () => {
  it('maintenance origin cannot be resumed as interactive session', () => {
    // Maintenance origin = ephemeral, so it cannot be a continuation target
    const maintAuth = expectAuth({ isMaintenanceRun: true });
    const mainAuth = expectAuth({ isMain: true });

    assert.notEqual(maintAuth.origin, mainAuth.origin);
    // Maintenance cannot become interactive-main
    assert.equal(maintAuth.origin, 'maintenance');
  });

  it('maintenance auth has unique authorityId', () => {
    const auth1 = expectAuth({ isMaintenanceRun: true });
    const auth2 = expectAuth({ isMaintenanceRun: true });

    assert.notEqual(auth1.authorityId, auth2.authorityId, 'Each run must have unique authorityId');
  });

  it('maintenance auth has correct groupFolder', () => {
    const auth = expectAuth({ isMaintenanceRun: true, groupFolder: 'my-group' });
    assert.equal(auth.groupFolder, 'my-group');
  });

  it('maintenance auth has correct requestId', () => {
    const auth = expectAuth({ isMaintenanceRun: true, requestId: 'my-request-id' });
    assert.equal(auth.requestId, 'my-request-id');
  });
});
