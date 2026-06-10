import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'path';
import test from 'node:test';

import {
  checkMutationBudget,
  clearPerRunCounters,
  recordMutation,
} from '../src/mutation-budget.js';
import { recordMutationAuditEvent } from '../src/mutation-audit.js';

// ---------------------------------------------------------------------------
// Helper: isolate a temp group folder for mutation audit JSONL tests
// ---------------------------------------------------------------------------

function tempGroup(): string {
  return `mut-test-${Date.now().toString(36)}`;
}

function auditPath(group: string): string {
  // resolveGroupFolderPath returns <PROJECT_ROOT>/groups/<group>,
  // so logs dir is <PROJECT_ROOT>/groups/<group>/logs
  return path.join(
    process.cwd(),
    'groups',
    group,
    'logs',
    'mutation-audit.jsonl',
  );
}

function readAuditLines(group: string): string[] {
  const p = auditPath(group);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf-8').trim().split('\n').filter(Boolean);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('checkMutationBudget allows mutation when per-run budget is not exhausted', () => {
  clearPerRunCounters('test-auth-1');
  const result = checkMutationBudget({
    groupFolder: 'test-group',
    attribution: { authorityId: 'test-auth-1', senderRole: 'operator' },
    mutationType: 'skill',
  });
  assert.equal(result.allowed, true);
  assert.equal(result.reason, undefined);
});

test('checkMutationBudget allows mutation when rolling window is not exhausted', () => {
  // Rolling window check queries SQLite. In the test environment, no DB is initialized,
  // so getRollingWindowCount returns 0 and the check passes.
  const result = checkMutationBudget({
    groupFolder: 'nonexistent-group',
    attribution: { authorityId: 'test-auth-2', senderRole: 'member' },
    mutationType: 'memory',
  });
  assert.equal(result.allowed, true);
});

test('checkMutationBudget returns perRunHit=true when per-run budget exceeded', () => {
  // Set up: exhaust per-run budget for this authority
  clearPerRunCounters('test-auth-exhausted');
  for (let i = 0; i < 5; i++) {
    recordMutation({
      groupFolder: 'test-group',
      attribution: { authorityId: 'test-auth-exhausted', senderRole: 'operator' },
      mutationType: 'skill',
    });
  }
  const result = checkMutationBudget({
    groupFolder: 'test-group',
    attribution: { authorityId: 'test-auth-exhausted', senderRole: 'operator' },
    mutationType: 'skill',
  });
  assert.equal(result.allowed, false);
  assert.equal(result.perRunHit, true);
  assert.ok(result.reason?.includes('per-run'));
});

test('checkMutationBudget skips per-run check for authorityId=unknown', () => {
  // Even with many prior mutations under 'unknown', per-run check should not block
  clearPerRunCounters('unknown');
  for (let i = 0; i < 100; i++) {
    recordMutation({
      groupFolder: 'test-group',
      attribution: { authorityId: 'unknown', senderRole: 'unknown' },
      mutationType: 'skill',
    });
  }
  const result = checkMutationBudget({
    groupFolder: 'test-group',
    attribution: { authorityId: 'unknown', senderRole: 'unknown' },
    mutationType: 'skill',
  });
  // Per-run check is skipped for 'unknown', rolling window returns 0 (no DB),
  // so this should be allowed
  assert.equal(result.allowed, true);
});

test('recordMutation increments per-run counter for known authority', () => {
  clearPerRunCounters('test-auth-inc');
  assert.equal(
    checkMutationBudget({
      groupFolder: 'g',
      attribution: { authorityId: 'test-auth-inc', senderRole: 'operator' },
      mutationType: 'skill',
    }).allowed,
    true,
  );
  recordMutation({
    groupFolder: 'g',
    attribution: { authorityId: 'test-auth-inc', senderRole: 'operator' },
    mutationType: 'skill',
  });
  // Second mutation should still be allowed (budget is 5)
  assert.equal(
    checkMutationBudget({
      groupFolder: 'g',
      attribution: { authorityId: 'test-auth-inc', senderRole: 'operator' },
      mutationType: 'skill',
    }).allowed,
    true,
  );
});

test('recordMutation does NOT increment per-run counter for authorityId=unknown', () => {
  clearPerRunCounters('unknown');
  // Record 10 mutations with 'unknown' authority
  for (let i = 0; i < 10; i++) {
    recordMutation({
      groupFolder: 'test-group',
      attribution: { authorityId: 'unknown', senderRole: 'unknown' },
      mutationType: 'memory',
    });
  }
  // Per-run check should still pass (not incremented for 'unknown')
  const result = checkMutationBudget({
    groupFolder: 'test-group',
    attribution: { authorityId: 'unknown', senderRole: 'unknown' },
    mutationType: 'memory',
  });
  assert.equal(result.allowed, true);
});

test('recordMutationAuditEvent writes a JSONL line for successful mutation', () => {
  const group = tempGroup();
  try {
    recordMutationAuditEvent(group, {
      kind: 'mutation',
      authorityId: 'auth-1',
      senderRole: 'operator',
      mutationType: 'skill',
      action: 'skill_create',
      targetName: 'test-skill',
      success: true,
    });
    const lines = readAuditLines(group);
    assert.equal(lines.length, 1);
    const parsed = JSON.parse(lines[0]);
    assert.equal(parsed.kind, 'mutation');
    assert.equal(parsed.authorityId, 'auth-1');
    assert.equal(parsed.mutationType, 'skill');
    assert.equal(parsed.action, 'skill_create');
    assert.equal(parsed.success, true);
    assert.ok(parsed.ts); // timestamp present
    assert.ok(parsed.group_id); // groupId added
  } finally {
    fs.rmSync(path.join(process.cwd(), 'groups', group), {
      recursive: true,
      force: true,
    });
  }
});

test('recordMutationAuditEvent writes a JSONL line for rejected mutation (noop)', () => {
  const group = tempGroup();
  try {
    recordMutationAuditEvent(group, {
      kind: 'noop',
      authorityId: 'auth-2',
      senderRole: 'member',
      mutationType: 'memory',
      action: 'memory_append',
      targetName: 'MEMORY.md',
      noopReason: 'per-run memory mutation budget exceeded (5/5)',
      success: false,
    });
    const lines = readAuditLines(group);
    assert.equal(lines.length, 1);
    const parsed = JSON.parse(lines[0]);
    assert.equal(parsed.kind, 'noop');
    assert.equal(parsed.authorityId, 'auth-2');
    assert.equal(parsed.mutationType, 'memory');
    assert.equal(parsed.noopReason, 'per-run memory mutation budget exceeded (5/5)');
    assert.equal(parsed.success, false);
  } finally {
    fs.rmSync(path.join(process.cwd(), 'groups', group), {
      recursive: true,
      force: true,
    });
  }
});

test('recordMutationAuditEvent is best-effort (does not throw on bad path)', () => {
  // Should not throw even with an invalid group path
  recordMutationAuditEvent('/nonexistent/../../etc/passwd', {
    kind: 'mutation',
    authorityId: 'auth-3',
    senderRole: 'operator',
    mutationType: 'skill',
    action: 'skill_patch',
    success: true,
  });
  // If we get here without throwing, the test passes
});

test('clearPerRunCounters resets counters for an authority', () => {
  clearPerRunCounters('test-auth-reset');
  recordMutation({
    groupFolder: 'g',
    attribution: { authorityId: 'test-auth-reset', senderRole: 'operator' },
    mutationType: 'skill',
  });
  clearPerRunCounters('test-auth-reset');
  const result = checkMutationBudget({
    groupFolder: 'g',
    attribution: { authorityId: 'test-auth-reset', senderRole: 'operator' },
    mutationType: 'skill',
  });
  assert.equal(result.allowed, true);
});
