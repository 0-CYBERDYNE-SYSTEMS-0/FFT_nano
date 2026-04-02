import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluatePermissionGate,
  isProtectedPath,
} from '../src/permission-gate-policy.js';

test('main interactive runs confirm destructive bash commands', () => {
  const decision = evaluatePermissionGate({
    toolName: 'bash',
    input: { command: 'git reset --hard' },
    isSubagent: false,
    hasUI: true,
  });

  assert.equal(decision.action, 'confirm');
});

test('subagents block destructive bash commands outright', () => {
  const decision = evaluatePermissionGate({
    toolName: 'bash',
    input: { command: 'rm -rf .' },
    isSubagent: true,
    hasUI: true,
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

  const decision = evaluatePermissionGate({
    toolName: 'write',
    input: { path: '.env' },
    isSubagent: false,
    hasUI: true,
  });
  assert.equal(decision.action, 'confirm');
});
