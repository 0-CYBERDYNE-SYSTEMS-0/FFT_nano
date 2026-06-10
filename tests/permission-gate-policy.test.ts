import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluatePermissionGate, isProtectedPath } from '../src/permission-gate-policy.js';
import type { RunAuthority } from '../src/types.js';

/** Build a minimal RunAuthority for testing */
function makeAuth(overrides: Partial<RunAuthority> = {}): RunAuthority {
  return {
    authorityId: 'test-auth-id',
    requestId: 'test-request-id',
    groupFolder: 'test-group',
    startedAt: '2025-01-01T00:00:00.000Z',
    effectiveToolSet: ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls', 'agent'],
    operatorGrant: false,
    senderRole: 'operator',
    startedDuringPause: false,
    ...overrides,
  } as RunAuthority;
}

test('main interactive runs confirm destructive bash commands', () => {
  // interactive-main + operatorGrant=true → confirm for destructive bash
  const auth = makeAuth({ origin: 'interactive-main', operatorGrant: true });
  const decision = evaluatePermissionGate({
    toolName: 'bash',
    input: { command: 'git reset --hard' },
    runAuthority: auth,
  });

  assert.equal(decision.action, 'confirm');
});

test('subagents block destructive bash commands outright', () => {
  // subagent origin → block for destructive bash
  const auth = makeAuth({ origin: 'subagent', operatorGrant: false });
  const decision = evaluatePermissionGate({
    toolName: 'bash',
    input: { command: 'rm -rf .' },
    runAuthority: auth,
  });

  assert.deepEqual(decision, {
    action: 'block',
    reason:
      'Destructive command blocked (rm -r (recursive delete)). Subagents cannot execute destructive commands.',
  });
});

test('protected paths are detected and gated', () => {
  assert.equal(isProtectedPath('.env'), true);
  assert.equal(isProtectedPath('src/.git/config'), true);
  assert.equal(isProtectedPath('workspace/node_modules/pkg/index.js'), true);
  assert.equal(isProtectedPath('src/app.ts'), false);

  // interactive-main with operatorGrant → confirm for protected path write
  const auth = makeAuth({ origin: 'interactive-main', operatorGrant: true });
  const decision = evaluatePermissionGate({
    toolName: 'write',
    input: { path: '.env' },
    runAuthority: auth,
  });
  assert.equal(decision.action, 'confirm');
});
