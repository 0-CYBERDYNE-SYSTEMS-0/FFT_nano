// WS1.3: Allow these headless-style test runs to spawn against sandbox=none.
process.env.FFT_NANO_ALLOW_UNSANDBOXED_HEADLESS = '1';

import assert from 'node:assert/strict';
import test from 'node:test';

import { resolvePiRunLifecyclePolicy } from '../src/pi-runner.ts';

function makeInput(overrides: Record<string, unknown> = {}) {
  return {
    prompt: 'do the thing',
    groupFolder: 'test-group',
    chatJid: 'telegram:test',
    isMain: false,
    ...overrides,
  };
}

function withEnv(env: Record<string, string | undefined>, fn: () => void) {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(env)) {
    saved[key] = process.env[key];
    if (env[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = env[key];
    }
  }
  try {
    fn();
  } finally {
    for (const key of Object.keys(env)) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  }
}

test('interactive policy defaults to 20m hard timeout with stale detection disabled', () => {
  withEnv(
    {
      FFT_NANO_INTERACTIVE_TIMEOUT_MS: undefined,
      FFT_NANO_INTERACTIVE_STALE_MS: undefined,
      FFT_NANO_INTERACTIVE_TOOL_STALE_MS: undefined,
      FFT_NANO_INTERACTIVE_WAIT_STALE_MS: undefined,
    },
    () => {
      const policy = resolvePiRunLifecyclePolicy({
        input: makeInput({ requestId: 'chat-1', codingHint: 'none' }),
        codingHint: 'none',
        groupTimeoutMs: 0,
      });
      assert.equal(policy.hardTimeoutMs, 20 * 60 * 1000);
      assert.equal(policy.staleAfterMs, null);
      assert.equal(policy.toolActiveStaleMs, null);
      assert.equal(policy.waitStateStaleMs, null);
    },
  );
});

test('interactive policy honors FFT_NANO_INTERACTIVE_TIMEOUT_MS', () => {
  withEnv(
    {
      FFT_NANO_INTERACTIVE_TIMEOUT_MS: '300000',
      FFT_NANO_INTERACTIVE_STALE_MS: undefined,
    },
    () => {
      const policy = resolvePiRunLifecyclePolicy({
        input: makeInput({ requestId: 'chat-1' }),
        codingHint: 'none',
        groupTimeoutMs: 0,
      });
      assert.equal(policy.hardTimeoutMs, 300_000);
    },
  );
});

test('interactive stale detection re-enables when FFT_NANO_INTERACTIVE_STALE_MS is set', () => {
  withEnv(
    {
      FFT_NANO_INTERACTIVE_TIMEOUT_MS: undefined,
      FFT_NANO_INTERACTIVE_STALE_MS: '45000',
      FFT_NANO_INTERACTIVE_TOOL_STALE_MS: undefined,
      FFT_NANO_INTERACTIVE_WAIT_STALE_MS: undefined,
    },
    () => {
      const policy = resolvePiRunLifecyclePolicy({
        input: makeInput({ requestId: 'chat-1' }),
        codingHint: 'none',
        groupTimeoutMs: 0,
      });
      assert.equal(policy.staleAfterMs, 45_000);
      assert.notEqual(policy.toolActiveStaleMs, null);
      assert.notEqual(policy.waitStateStaleMs, null);
    },
  );
});

test('explicit null staleAfterMs override disables the detector instead of falling back', () => {
  withEnv(
    {
      FFT_NANO_INTERACTIVE_TIMEOUT_MS: undefined,
      FFT_NANO_INTERACTIVE_STALE_MS: '45000',
      FFT_NANO_INTERACTIVE_TOOL_STALE_MS: undefined,
      FFT_NANO_INTERACTIVE_WAIT_STALE_MS: undefined,
    },
    () => {
      const policy = resolvePiRunLifecyclePolicy({
        input: makeInput({
          requestId: 'chat-1',
          lifecyclePolicyOverride: {
            staleAfterMs: null,
            toolActiveStaleMs: null,
            waitStateStaleMs: null,
          },
        }),
        codingHint: 'none',
        groupTimeoutMs: 0,
      });
      assert.equal(policy.staleAfterMs, null);
      assert.equal(policy.toolActiveStaleMs, null);
      assert.equal(policy.waitStateStaleMs, null);
    },
  );
});

test('override hardTimeoutMs wins over the interactive default', () => {
  withEnv(
    {
      FFT_NANO_INTERACTIVE_TIMEOUT_MS: undefined,
      FFT_NANO_INTERACTIVE_STALE_MS: undefined,
    },
    () => {
      const policy = resolvePiRunLifecyclePolicy({
        input: makeInput({
          requestId: 'chat-1',
          lifecyclePolicyOverride: { hardTimeoutMs: 3_600_000 },
        }),
        codingHint: 'none',
        groupTimeoutMs: 0,
      });
      assert.equal(policy.hardTimeoutMs, 3_600_000);
    },
  );
});
