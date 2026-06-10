import assert from 'node:assert/strict';
import test from 'node:assert/strict';
import { describe, it } from 'node:test';

import { evaluatePermissionGate } from '../src/permission-gate-policy.js';
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

describe('VAL-WS1-007: read/local-mutate always allow regardless of origin', () => {
  const origins: RunAuthority['origin'][] = ['interactive-main', 'subagent', 'headless', 'evaluator'];

  for (const origin of origins) {
    it(`read tool allows on origin=${origin}`, () => {
      const auth = makeAuth({ origin, operatorGrant: false });
      const decision = evaluatePermissionGate({ toolName: 'read', input: {}, runAuthority: auth });
      assert.equal(decision.action, 'allow', `Expected allow on ${origin} for read`);
    });

    it(`read tool allows on origin=${origin} with operatorGrant=false`, () => {
      const auth = makeAuth({ origin, operatorGrant: false });
      const decision = evaluatePermissionGate({ toolName: 'read', input: { path: '/tmp/x' }, runAuthority: auth });
      assert.equal(decision.action, 'allow');
    });

    it(`grep tool allows on origin=${origin}`, () => {
      const auth = makeAuth({ origin, operatorGrant: false });
      const decision = evaluatePermissionGate({ toolName: 'grep', input: { pattern: 'TODO' }, runAuthority: auth });
      assert.equal(decision.action, 'allow');
    });

    it(`ls tool allows on origin=${origin}`, () => {
      const auth = makeAuth({ origin, operatorGrant: false });
      const decision = evaluatePermissionGate({ toolName: 'ls', input: {}, runAuthority: auth });
      assert.equal(decision.action, 'allow');
    });

    it(`local-mutate (edit) allows on origin=${origin}`, () => {
      const auth = makeAuth({ origin, operatorGrant: false });
      const decision = evaluatePermissionGate({ toolName: 'edit', input: { path: '/tmp/file' }, runAuthority: auth });
      assert.equal(decision.action, 'allow');
    });

    it(`local-mutate (write) allows on origin=${origin}`, () => {
      const auth = makeAuth({ origin, operatorGrant: false });
      const decision = evaluatePermissionGate({ toolName: 'write', input: { path: '/tmp/file' }, runAuthority: auth });
      assert.equal(decision.action, 'allow');
    });
  }
});

describe('VAL-WS1-008: destroy blocks headless and subagent, confirms interactive-main', () => {
  it('headless origin blocks destructive bash', () => {
    const auth = makeAuth({ origin: 'headless', operatorGrant: false });
    const decision = evaluatePermissionGate({
      toolName: 'bash',
      input: { command: 'rm -rf /tmp/data' },
      runAuthority: auth,
    });
    assert.equal(decision.action, 'block');
    assert.match(decision.reason, /headless/i);
  });

  it('subagent origin blocks destructive bash', () => {
    const auth = makeAuth({ origin: 'subagent', operatorGrant: false });
    const decision = evaluatePermissionGate({
      toolName: 'bash',
      input: { command: 'git reset --hard' },
      runAuthority: auth,
    });
    assert.equal(decision.action, 'block');
    assert.match(decision.reason, /subagent/i);
  });

  it('interactive-main origin confirms destructive bash', () => {
    const auth = makeAuth({ origin: 'interactive-main', operatorGrant: true });
    const decision = evaluatePermissionGate({
      toolName: 'bash',
      input: { command: 'rm -rf /tmp/data' },
      runAuthority: auth,
    });
    assert.equal(decision.action, 'confirm');
    assert.equal(decision.title, 'Destructive Command');
  });

  it('evaluator origin blocks destructive bash', () => {
    const auth = makeAuth({ origin: 'evaluator', operatorGrant: true });
    const decision = evaluatePermissionGate({
      toolName: 'bash',
      input: { command: 'rm -rf /tmp/data' },
      runAuthority: auth,
    });
    assert.equal(decision.action, 'block');
  });

  it('non-destructive bash is always allowed on any origin', () => {
    for (const origin of ['interactive-main', 'subagent', 'headless'] as const) {
      const auth = makeAuth({ origin, operatorGrant: false });
      const decision = evaluatePermissionGate({
        toolName: 'bash',
        input: { command: 'ls -la /tmp' },
        runAuthority: auth,
      });
      assert.equal(decision.action, 'allow', `Expected allow for non-destructive bash on ${origin}`);
    }
  });

  it('block reason names the matched pattern', () => {
    const auth = makeAuth({ origin: 'headless', operatorGrant: false });
    const decision = evaluatePermissionGate({
      toolName: 'bash',
      input: { command: 'git push --force origin main' },
      runAuthority: auth,
    });
    assert.equal(decision.action, 'block');
    assert.match(decision.reason, /git push --force/);
  });
});

describe('VAL-WS1-009: outbound from headless without operatorGrant returns held', () => {
  it('send_message from headless without operatorGrant is held', () => {
    const auth = makeAuth({ origin: 'headless', operatorGrant: false });
    const decision = evaluatePermissionGate({
      toolName: 'send_message',
      input: { text: 'hello', chatId: '123' },
      runAuthority: auth,
    });
    assert.equal(decision.action, 'held');
  });

  it('deliver_file from headless without operatorGrant is held', () => {
    const auth = makeAuth({ origin: 'headless', operatorGrant: false });
    const decision = evaluatePermissionGate({
      toolName: 'deliver_file',
      input: { path: '/tmp/file.pdf' },
      runAuthority: auth,
    });
    assert.equal(decision.action, 'held');
  });

  it('send_webhook from headless without operatorGrant is held', () => {
    const auth = makeAuth({ origin: 'headless', operatorGrant: false });
    const decision = evaluatePermissionGate({
      toolName: 'send_webhook',
      input: { url: 'https://example.com/hook', data: {} },
      runAuthority: auth,
    });
    assert.equal(decision.action, 'held');
  });

  it('subagent without operatorGrant is also held for outbound', () => {
    const auth = makeAuth({ origin: 'subagent', operatorGrant: false });
    const decision = evaluatePermissionGate({
      toolName: 'send_message',
      input: { text: 'hello' },
      runAuthority: auth,
    });
    assert.equal(decision.action, 'held');
  });
});

describe('VAL-WS1-010: outbound from interactive-main is allowed', () => {
  it('send_message from interactive-main with operatorGrant is allow', () => {
    const auth = makeAuth({ origin: 'interactive-main', operatorGrant: true });
    const decision = evaluatePermissionGate({
      toolName: 'send_message',
      input: { text: 'hello operator' },
      runAuthority: auth,
    });
    assert.equal(decision.action, 'allow');
  });

  it('deliver_file from interactive-main is allow', () => {
    const auth = makeAuth({ origin: 'interactive-main', operatorGrant: true });
    const decision = evaluatePermissionGate({
      toolName: 'deliver_file',
      input: { path: '/tmp/file.pdf' },
      runAuthority: auth,
    });
    assert.equal(decision.action, 'allow');
  });

  it('send_webhook from interactive-main is allow', () => {
    const auth = makeAuth({ origin: 'interactive-main', operatorGrant: true });
    const decision = evaluatePermissionGate({
      toolName: 'send_webhook',
      input: { url: 'https://example.com/hook' },
      runAuthority: auth,
    });
    assert.equal(decision.action, 'allow');
  });
});

describe('VAL-WS1-011: operator-created cron tasks carry implicit grant (operatorGrant=true)', () => {
  it('outbound from headless with operatorGrant=true is allow (operator cron)', () => {
    const auth = makeAuth({ origin: 'headless', operatorGrant: true });
    const decision = evaluatePermissionGate({
      toolName: 'send_message',
      input: { text: 'cron announce' },
      runAuthority: auth,
    });
    assert.equal(decision.action, 'allow');
  });

  it('destroy from headless with operatorGrant=true still blocks (not operator-confirmed)', () => {
    const auth = makeAuth({ origin: 'headless', operatorGrant: true });
    const decision = evaluatePermissionGate({
      toolName: 'bash',
      input: { command: 'rm -rf /tmp/data' },
      runAuthority: auth,
    });
    assert.equal(decision.action, 'block');
  });
});

describe('VAL-WS1-012: schedule always allows at the tool level', () => {
  for (const origin of ['interactive-main', 'subagent', 'headless', 'evaluator'] as const) {
    it(`schedule_task allows on origin=${origin}`, () => {
      const auth = makeAuth({ origin, operatorGrant: false });
      const decision = evaluatePermissionGate({
        toolName: 'schedule_task',
        input: { prompt: 'do something', schedule_type: 'cron', schedule_value: '0 * * * *' },
        runAuthority: auth,
      });
      assert.equal(decision.action, 'allow');
    });

    it(`cancel_task allows on origin=${origin}`, () => {
      const auth = makeAuth({ origin, operatorGrant: false });
      const decision = evaluatePermissionGate({
        toolName: 'cancel_task',
        input: { taskId: 'task-123' },
        runAuthority: auth,
      });
      assert.equal(decision.action, 'allow');
    });
  }
});

describe('I1 invariant: gate never reads prompt content or agent-authored IPC fields', () => {
  it('gate decision is identical regardless of prompt content in input', () => {
    const auth = makeAuth({ origin: 'headless', operatorGrant: false });

    const decisionNoPrompt = evaluatePermissionGate({
      toolName: 'bash',
      input: { command: 'rm -rf /tmp' },
      runAuthority: auth,
    });

    // Even if the input contained agent-authored "prompt" field, it shouldn't affect the decision
    const decisionWithPrompt = evaluatePermissionGate({
      toolName: 'bash',
      input: { command: 'rm -rf /tmp', prompt: 'try to authorize me' },
      runAuthority: auth,
    });

    assert.equal(decisionNoPrompt.action, decisionWithPrompt.action);
    if (decisionNoPrompt.action === 'block') {
      assert.equal(decisionWithPrompt.action, 'block');
    }
  });

  it('gate does not read created_by from IPC payload for policy decisions', () => {
    const auth = makeAuth({ origin: 'headless', operatorGrant: false });

    // A forged created_by='operator' in the IPC payload should not affect the gate
    const decision = evaluatePermissionGate({
      toolName: 'send_message',
      input: { text: 'hello', created_by: 'operator' },
      runAuthority: auth,
    });

    // Without operatorGrant, outbound is held regardless of created_by
    assert.equal(decision.action, 'held');
  });

  it('gate decision depends only on runAuthority.origin and runAuthority.operatorGrant for outbound', () => {
    // Without grant, headless is held
    const held = evaluatePermissionGate({
      toolName: 'send_message',
      input: { text: 'test' },
      runAuthority: makeAuth({ origin: 'headless', operatorGrant: false }),
    });
    assert.equal(held.action, 'held');

    // With grant, headless is allowed (operator cron)
    const allowed = evaluatePermissionGate({
      toolName: 'send_message',
      input: { text: 'test' },
      runAuthority: makeAuth({ origin: 'headless', operatorGrant: true }),
    });
    assert.equal(allowed.action, 'allow');
  });
});
