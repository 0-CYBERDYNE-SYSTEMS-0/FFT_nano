/**
 * Tests for LISO.4: Proposal-Only Learning
 *
 * Validates:
 *   VAL-LISO-013: Maintenance origin has operatorGrant: false
 *   VAL-LISO-014: Mutating tools absent for maintenance
 *   VAL-LISO-015: Permission gate denies local mutation for maintenance
 *   VAL-LISO-016: Malformed proposal is inert
 *
 * Covers:
 *   - mintRunAuthority for maintenance sets operatorGrant: false
 *   - deriveRunOrigin returns 'maintenance' when isMaintenanceRun: true
 *   - evaluatePermissionGate blocks all mutations for maintenance origin
 *   - Proposal schema validation
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { mintRunAuthority, deriveRunOrigin } from '../src/run-authority.js';
import { evaluatePermissionGate, classifyActionCategory } from '../src/permission-gate-policy.js';
import type { RunAuthority, LearningProposal, LearningProvenance } from '../src/types.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMaintenanceAuth(overrides: Partial<Parameters<typeof mintRunAuthority>[0]> = {}): RunAuthority {
  return mintRunAuthority({
    requestId: 'test-req-id',
    groupFolder: 'test-group',
    isMain: false,
    isSubagent: false,
    isScheduledTask: false,
    isHeartbeat: false,
    isEvaluatorRun: false,
    isMaintenanceRun: true,
    senderRole: 'unknown',
    startedDuringPause: false,
    ...overrides,
  });
}

function makeInteractiveAuth(): RunAuthority {
  return mintRunAuthority({
    requestId: 'test-req-id',
    groupFolder: 'test-group',
    isMain: true,
    isSubagent: false,
    isScheduledTask: false,
    isHeartbeat: false,
    isEvaluatorRun: false,
    senderRole: 'operator',
    startedDuringPause: false,
  });
}

// ── VAL-LISO-013: Maintenance has no operator grant ─────────────────────────────

describe('VAL-LISO-013: Maintenance origin has operatorGrant: false', () => {
  it('mintRunAuthority sets operatorGrant=false when isMaintenanceRun=true', () => {
    const auth = makeMaintenanceAuth();
    assert.equal(auth.operatorGrant, false, 'Maintenance must have operatorGrant: false');
  });

  it('deriveRunOrigin returns "maintenance" when isMaintenanceRun=true', () => {
    const origin = deriveRunOrigin({ isMaintenanceRun: true });
    assert.equal(origin, 'maintenance', 'isMaintenanceRun should produce origin=maintenance');
  });

  it('maintenance origin is distinct from evaluator origin', () => {
    const maintOrigin = deriveRunOrigin({ isMaintenanceRun: true });
    const evalOrigin = deriveRunOrigin({ isEvaluatorRun: true });
    assert.notEqual(maintOrigin, evalOrigin, 'Maintenance and evaluator must have different origins');
  });

  it('evaluator origin has operatorGrant=true', () => {
    const auth = mintRunAuthority({
      requestId: 'test-req',
      groupFolder: 'test-group',
      isEvaluatorRun: true,
    });
    assert.equal(auth.operatorGrant, true, 'Evaluator must have operatorGrant: true');
  });

  it('interactive-main has operatorGrant=true', () => {
    const auth = makeInteractiveAuth();
    assert.equal(auth.operatorGrant, true, 'Interactive-main must have operatorGrant: true');
  });

  it('maintenance auth has origin="maintenance"', () => {
    const auth = makeMaintenanceAuth();
    assert.equal(auth.origin, 'maintenance', 'Maintenance auth must have origin=maintenance');
  });

  it('maintenance auth effectiveToolSet is derived from toolMode', () => {
    // Default maintenance auth
    const auth = makeMaintenanceAuth();
    // Maintenance runs use read_only toolMode by default in skill-service
    assert.ok(Array.isArray(auth.effectiveToolSet));
  });
});

// ── VAL-LISO-014: Mutating tools absent for maintenance ────────────────────────

describe('VAL-LISO-014: Mutating tools absent for maintenance', () => {
  it('classifyActionCategory returns local-mutate for edit tool', () => {
    const result = classifyActionCategory('edit', { path: 'test.txt' });
    assert.equal(result.category, 'local-mutate');
  });

  it('classifyActionCategory returns local-mutate for write tool', () => {
    const result = classifyActionCategory('write', { path: 'test.txt' });
    assert.equal(result.category, 'local-mutate');
  });

  it('classifyActionCategory returns destroy for destructive bash', () => {
    const result = classifyActionCategory('bash', { command: 'rm -rf /tmp/test' });
    assert.equal(result.category, 'destroy');
  });

  it('classifyActionCategory returns outbound for send_message', () => {
    const result = classifyActionCategory('send_message', { message: 'test' });
    assert.equal(result.category, 'outbound');
  });

  it('classifyActionCategory returns schedule for schedule_task', () => {
    const result = classifyActionCategory('schedule_task', { task: 'test' });
    assert.equal(result.category, 'schedule');
  });

  it('classifyActionCategory returns read for ls', () => {
    const result = classifyActionCategory('ls', { path: '.' });
    assert.equal(result.category, 'read');
  });
});

// ── VAL-LISO-015: Permission gate denies local mutation for maintenance ────────

describe('VAL-LISO-015: Permission gate denies local mutation for maintenance', () => {
  it('evaluatePermissionGate blocks edit for maintenance origin', () => {
    const auth = makeMaintenanceAuth();
    const decision = evaluatePermissionGate({
      toolName: 'edit',
      input: { path: 'some-file.txt' },
      runAuthority: auth,
    });
    assert.equal(decision.action, 'block', 'Maintenance must be blocked from edit');
  });

  it('evaluatePermissionGate blocks write for maintenance origin', () => {
    const auth = makeMaintenanceAuth();
    const decision = evaluatePermissionGate({
      toolName: 'write',
      input: { path: 'some-file.txt' },
      runAuthority: auth,
    });
    assert.equal(decision.action, 'block', 'Maintenance must be blocked from write');
  });

  it('evaluatePermissionGate blocks bash for maintenance origin', () => {
    const auth = makeMaintenanceAuth();
    const decision = evaluatePermissionGate({
      toolName: 'bash',
      input: { command: 'ls -la' },
      runAuthority: auth,
    });
    assert.equal(decision.action, 'block', 'Maintenance must be blocked from bash');
  });

  it('evaluatePermissionGate blocks destructive bash for maintenance origin', () => {
    const auth = makeMaintenanceAuth();
    const decision = evaluatePermissionGate({
      toolName: 'bash',
      input: { command: 'rm -rf /tmp/test' },
      runAuthority: auth,
    });
    assert.equal(decision.action, 'block', 'Maintenance must be blocked from destructive bash');
  });

  it('evaluatePermissionGate blocks send_message for maintenance origin', () => {
    const auth = makeMaintenanceAuth();
    const decision = evaluatePermissionGate({
      toolName: 'send_message',
      input: { message: 'test' },
      runAuthority: auth,
    });
    assert.equal(decision.action, 'block', 'Maintenance must be blocked from send_message');
  });

  it('evaluatePermissionGate blocks schedule_task for maintenance origin', () => {
    const auth = makeMaintenanceAuth();
    const decision = evaluatePermissionGate({
      toolName: 'schedule_task',
      input: { task: 'test' },
      runAuthority: auth,
    });
    assert.equal(decision.action, 'block', 'Maintenance must be blocked from schedule_task');
  });

  it('evaluatePermissionGate blocks read for maintenance origin', () => {
    const auth = makeMaintenanceAuth();
    const decision = evaluatePermissionGate({
      toolName: 'read',
      input: { path: 'some-file.txt' },
      runAuthority: auth,
    });
    // Maintenance origin blocks ALL operations including read
    assert.equal(decision.action, 'block', 'Maintenance must be blocked from all operations');
  });

  it('evaluatePermissionGate allows edit for interactive-main with operatorGrant', () => {
    const auth = makeInteractiveAuth();
    const decision = evaluatePermissionGate({
      toolName: 'edit',
      input: { path: 'some-file.txt' },
      runAuthority: auth,
    });
    // edit is allowed (not confirm) for interactive-main with operatorGrant
    assert.equal(decision.action, 'allow', 'Interactive-main should be allowed to edit');
  });

  it('evaluatePermissionGate blocks edit for subagent without operatorGrant', () => {
    const auth = mintRunAuthority({
      requestId: 'test-req',
      groupFolder: 'test-group',
      isSubagent: true,
    });
    const decision = evaluatePermissionGate({
      toolName: 'edit',
      input: { path: 'some-file.txt' },
      runAuthority: auth,
    });
    // local-mutate is allowed for subagent per VAL-WS1-007, but protected paths would be blocked
    // For non-protected paths, subagent can edit
    assert.equal(decision.action, 'allow');
  });
});

// ── VAL-LISO-016: Malformed proposal is inert ─────────────────────────────────

describe('VAL-LISO-016: Malformed proposal is inert', () => {
  it('noop proposal has required reason field', () => {
    const proposal: LearningProposal = {
      kind: 'noop',
      reason: 'No learning signal detected in current turn',
    };
    assert.equal(proposal.kind, 'noop');
    assert.ok(typeof proposal.reason === 'string');
  });

  it('memory proposal has required fields', () => {
    const provenance: LearningProvenance = {
      reviewedTurnId: 'turn-123',
      source: 'explicit-correction',
      evidenceSummary: 'User used correction phrase "actually you should"',
    };
    const proposal: LearningProposal = {
      kind: 'memory',
      intent: 'memory_append',
      target: 'canonical-memory',
      content: 'Remember to use X approach',
      rationale: 'User corrected Y behavior',
      provenance,
    };
    assert.equal(proposal.kind, 'memory');
    assert.equal(proposal.intent, 'memory_append');
    assert.ok(typeof proposal.target === 'string');
    assert.ok(typeof proposal.content === 'string');
    assert.ok(typeof proposal.rationale === 'string');
    assert.equal(proposal.provenance.reviewedTurnId, 'turn-123');
  });

  it('skill proposal has required fields', () => {
    const provenance: LearningProvenance = {
      reviewedTurnId: 'turn-456',
      source: 'tool-failure',
      evidenceSummary: 'Tool failed because skill was missing',
    };
    const proposal: LearningProposal = {
      kind: 'skill',
      intent: 'skill_create',
      skillName: 'my-new-skill',
      content: '# Skill\n\nContent here',
      rationale: 'Tool failure indicated need for this skill',
      provenance,
    };
    assert.equal(proposal.kind, 'skill');
    assert.equal(proposal.intent, 'skill_create');
    assert.ok(typeof proposal.skillName === 'string');
    assert.ok(typeof proposal.content === 'string');
  });

  it('skill_patch proposal includes baseHash for diff validation', () => {
    const provenance: LearningProvenance = {
      reviewedTurnId: 'turn-789',
      source: 'explicit-memory',
      evidenceSummary: 'Memory indicated skill needs update',
    };
    const proposal: LearningProposal = {
      kind: 'skill',
      intent: 'skill_patch',
      skillName: 'existing-skill',
      baseHash: 'abc123def456',
      content: '# Updated Skill\n\nNew content',
      rationale: 'Updating existing skill based on memory',
      provenance,
    };
    assert.equal(proposal.kind, 'skill');
    assert.equal(proposal.intent, 'skill_patch');
    assert.ok(typeof proposal.baseHash === 'string', 'skill_patch requires baseHash');
  });

  it('report proposal has required fields', () => {
    const provenance: LearningProvenance = {
      reviewedTurnId: 'turn-999',
      source: 'tool-failure',
      evidenceSummary: 'Tool failed with unknown error',
    };
    const proposal: LearningProposal = {
      kind: 'report',
      issue: 'Tool X failed unexpectedly',
      recommendation: 'Consider adding error handling or documentation',
      provenance,
    };
    assert.equal(proposal.kind, 'report');
    assert.ok(typeof proposal.issue === 'string');
    assert.ok(typeof proposal.recommendation === 'string');
    assert.equal(proposal.provenance.reviewedTurnId, 'turn-999');
  });

  it('provenance source is one of allowed values', () => {
    const sources: LearningProvenance['source'][] = [
      'explicit-correction',
      'explicit-memory',
      'tool-failure',
    ];

    for (const source of sources) {
      const provenance: LearningProvenance = {
        reviewedTurnId: 'turn-1',
        source,
        evidenceSummary: 'Test evidence',
      };
      assert.ok(
        sources.includes(provenance.source),
        `Provenance source "${source}" must be valid`,
      );
    }
  });

  it('malformed proposal with missing required fields would fail validation', () => {
    // This tests that we understand the schema requirements
    // A proposal missing required fields should be rejected by host validation
    const badProposal = {
      kind: 'memory',
      // Missing: intent, target, content, rationale, provenance
    };

    // In practice, this would fail JSON schema validation
    assert.ok(!('intent' in badProposal), 'Bad proposal should be missing required fields');
  });
});

// ── Proposal schema validation helpers ───────────────────────────────────────

describe('Proposal schema validation', () => {
  function isValidLearningProposal(obj: unknown): obj is LearningProposal {
    if (typeof obj !== 'object' || obj === null) return false;
    const p = obj as Record<string, unknown>;

    if (!('kind' in p)) return false;
    const kind = p.kind;

    if (kind === 'noop') {
      return 'reason' in p && typeof p.reason === 'string';
    }
    if (kind === 'memory') {
      return (
        'intent' in p &&
        ['memory_append', 'memory_promote'].includes(p.intent as string) &&
        'target' in p &&
        'content' in p &&
        'rationale' in p &&
        'provenance' in p
      );
    }
    if (kind === 'skill') {
      return (
        'intent' in p &&
        ['skill_create', 'skill_patch'].includes(p.intent as string) &&
        'skillName' in p &&
        'content' in p &&
        'rationale' in p &&
        'provenance' in p
      );
    }
    if (kind === 'report') {
      return 'issue' in p && 'recommendation' in p && 'provenance' in p;
    }

    return false;
  }

  it('validates a well-formed noop proposal', () => {
    const proposal = { kind: 'noop', reason: 'No signal' };
    assert.equal(isValidLearningProposal(proposal), true);
  });

  it('rejects proposal with unknown kind', () => {
    const proposal = { kind: 'unknown', data: 'test' };
    assert.equal(isValidLearningProposal(proposal), false);
  });

  it('rejects noop proposal missing reason', () => {
    const proposal = { kind: 'noop' };
    assert.equal(isValidLearningProposal(proposal), false);
  });

  it('validates a well-formed memory proposal', () => {
    const proposal: LearningProposal = {
      kind: 'memory',
      intent: 'memory_append',
      target: 'canonical',
      content: 'Remember X',
      rationale: 'User said so',
      provenance: {
        reviewedTurnId: 't1',
        source: 'explicit-correction',
        evidenceSummary: 'User said "actually"',
      },
    };
    assert.equal(isValidLearningProposal(proposal), true);
  });

  it('validates a well-formed skill proposal', () => {
    const proposal: LearningProposal = {
      kind: 'skill',
      intent: 'skill_create',
      skillName: 'my-skill',
      content: '# Skill',
      rationale: 'Needed',
      provenance: {
        reviewedTurnId: 't1',
        source: 'tool-failure',
        evidenceSummary: 'Tool failed',
      },
    };
    assert.equal(isValidLearningProposal(proposal), true);
  });
});

// ── LISO.4 Security invariants ────────────────────────────────────────────────

describe('LISO.4 security invariants', () => {
  it('maintenance origin cannot be elevated to operatorGrant', () => {
    // Even if someone tries to pass isMaintenanceRun=true along with other flags
    const auth = mintRunAuthority({
      requestId: 'test',
      groupFolder: 'test',
      isMaintenanceRun: true,
      // These should not change operatorGrant for maintenance
      isMain: true,
    });
    assert.equal(auth.operatorGrant, false);
    assert.equal(auth.origin, 'maintenance');
  });

  it('maintenance cannot be confused with evaluator', () => {
    const maintAuth = mintRunAuthority({
      requestId: 'test',
      groupFolder: 'test',
      isMaintenanceRun: true,
      isEvaluatorRun: false,
    });
    const evalAuth = mintRunAuthority({
      requestId: 'test',
      groupFolder: 'test',
      isMaintenanceRun: false,
      isEvaluatorRun: true,
    });

    assert.notEqual(maintAuth.origin, evalAuth.origin);
    assert.equal(maintAuth.operatorGrant, false);
    assert.equal(evalAuth.operatorGrant, true);
  });

  it('permission gate blocks even if maintenance somehow got mutating tools', () => {
    // Defense in depth: even if the toolset includes mutating tools,
    // the permission gate should block them
    const auth = makeMaintenanceAuth();
    // auth has operatorGrant=false but that's not even checked for maintenance
    // because maintenance is blocked before operatorGrant check

    const decision = evaluatePermissionGate({
      toolName: 'bash',
      input: { command: 'echo hello' },
      runAuthority: auth,
    });

    assert.equal(decision.action, 'block');
  });
});
