import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  determinePromptPreflightDecision,
  readPromptRuntimeState,
  resolvePromptPreflightOutcome,
  writePromptRuntimeState,
} from '../src/prompt-lifecycle.js';

test('determinePromptPreflightDecision continues when prior usage is healthy', () => {
  const decision = determinePromptPreflightDecision({
    preflightRebaseEnabled: true,
    flushEnabled: true,
    softTokenThreshold: 48_000,
    hardTokenThreshold: 64_000,
    currentPromptChars: 4_000,
    runMode: 'interactive',
    previousTotalTokens: 12_000,
    overflowDetected: false,
    alreadyFlushedEpoch: false,
  });

  assert.equal(decision, 'continue');
});

test('determinePromptPreflightDecision requests flush before continue inside soft range', () => {
  const decision = determinePromptPreflightDecision({
    preflightRebaseEnabled: true,
    flushEnabled: true,
    softTokenThreshold: 48_000,
    hardTokenThreshold: 64_000,
    currentPromptChars: 8_000,
    runMode: 'interactive',
    previousTotalTokens: 50_000,
    overflowDetected: false,
    alreadyFlushedEpoch: false,
  });

  assert.equal(decision, 'flush_then_continue');
});

test('determinePromptPreflightDecision rebases on overflow or hard threshold', () => {
  assert.equal(
    determinePromptPreflightDecision({
      preflightRebaseEnabled: true,
      flushEnabled: true,
      softTokenThreshold: 48_000,
      hardTokenThreshold: 64_000,
      currentPromptChars: 4_000,
      runMode: 'interactive',
      previousTotalTokens: 70_000,
      overflowDetected: false,
      alreadyFlushedEpoch: false,
    }),
    'rebase_session',
  );

  assert.equal(
    determinePromptPreflightDecision({
      preflightRebaseEnabled: true,
      flushEnabled: true,
      softTokenThreshold: 48_000,
      hardTokenThreshold: 64_000,
      currentPromptChars: 4_000,
      runMode: 'interactive',
      previousTotalTokens: 12_000,
      overflowDetected: true,
      alreadyFlushedEpoch: false,
    }),
    'rebase_session',
  );
});

test('determinePromptPreflightDecision rebases on projected prompt size and aborts on corrupted state', () => {
  assert.equal(
    determinePromptPreflightDecision({
      preflightRebaseEnabled: true,
      flushEnabled: true,
      softTokenThreshold: 48_000,
      hardTokenThreshold: 64_000,
      currentPromptChars: 180_000,
      runMode: 'interactive',
      previousTotalTokens: 20_000,
      overflowDetected: false,
      alreadyFlushedEpoch: false,
    }),
    'rebase_session',
  );

  assert.equal(
    determinePromptPreflightDecision({
      preflightRebaseEnabled: true,
      flushEnabled: true,
      softTokenThreshold: 48_000,
      hardTokenThreshold: 64_000,
      currentPromptChars: 2_000,
      runMode: 'heartbeat',
      stateCorrupted: true,
      previousTotalTokens: 0,
      overflowDetected: false,
      alreadyFlushedEpoch: false,
    }),
    'abort',
  );
});

test('prompt runtime state round-trips and flags corruption', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-prompt-state-'));
  const statePath = path.join(tmpRoot, 'prompt-state.json');

  try {
    writePromptRuntimeState(statePath, {
      version: 1,
      sessionEpoch: 2,
      lastTotalTokens: 1234,
      lastPreflightDecision: 'continue',
      cacheEntries: {},
    });

    assert.equal(readPromptRuntimeState(statePath).sessionEpoch, 2);

    fs.writeFileSync(statePath, '{not json', 'utf-8');
    const corrupted = readPromptRuntimeState(statePath);
    assert.equal(corrupted.sessionEpoch, 0);
    assert.equal(corrupted.corrupted, true);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('resolvePromptPreflightOutcome executes flush and marks the epoch only after success', async () => {
  let flushCalls = 0;
  const outcome = await resolvePromptPreflightOutcome({
    input: {
      preflightRebaseEnabled: true,
      flushEnabled: true,
      softTokenThreshold: 48_000,
      hardTokenThreshold: 64_000,
      currentPromptChars: 8_000,
      runMode: 'interactive',
    },
    state: {
      version: 1,
      sessionEpoch: 3,
      lastTotalTokens: 50_000,
      cacheEntries: {},
    },
    executeFlush: async () => {
      flushCalls += 1;
      return {
        version: 1,
        sessionEpoch: 3,
        lastTotalTokens: 50_000,
        cacheEntries: {},
      };
    },
  });

  assert.equal(flushCalls, 1);
  assert.equal(outcome.flushed, true);
  assert.equal(outcome.state.flushedEpoch, 3);
  assert.equal(outcome.decision, 'rebase_session');
});

test('resolvePromptPreflightOutcome leaves state unmarked when flush fails', async () => {
  const outcome = await resolvePromptPreflightOutcome({
    input: {
      preflightRebaseEnabled: true,
      flushEnabled: true,
      softTokenThreshold: 48_000,
      hardTokenThreshold: 64_000,
      currentPromptChars: 8_000,
      runMode: 'interactive',
    },
    state: {
      version: 1,
      sessionEpoch: 3,
      lastTotalTokens: 50_000,
      cacheEntries: {},
    },
    executeFlush: async () => null,
  });

  assert.equal(outcome.flushed, false);
  assert.equal(outcome.state.flushedEpoch, undefined);
  assert.equal(outcome.decision, 'flush_then_continue');
});

test('prompt cache entry round-trips stable layer content and mtimeMap', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-prompt-state-'));
  const statePath = path.join(tmpRoot, 'prompt-state.json');

  try {
    const mtimeMap = {
      '/workspace/group/NANO.md': 12345.67,
      '/workspace/group/SOUL.md': 12346.0,
      '/workspace/group/canonical/_hot.md': null,
    };
    writePromptRuntimeState(statePath, {
      version: 1,
      sessionEpoch: 4,
      cacheEntries: {
        'main:full:none': {
          key: 'stable-key-abc',
          hash: 'stable-hash-xyz',
          content: '## Stable prompt\n\nLots of text here.\n',
          mtimeMap,
          manifest: {
            mode: 'full',
            totalChars: 100,
            contextEntries: [],
            contextBudget: {
              fileMaxChars: 1,
              totalMaxChars: 1,
              injectedTotalChars: 0,
              remainingChars: 0,
            },
            layers: [],
            baseCacheKey: 'stable-key-abc',
            basePromptHash: 'stable-hash-xyz',
            cacheHit: false,
            skillsCatalog: {
              count: 0,
              injectedChars: 0,
              truncated: false,
            },
          },
          builtAt: '2026-02-17T12:00:00.000Z',
        },
      },
    });

    const reloaded = readPromptRuntimeState(statePath);
    const entry = reloaded.cacheEntries['main:full:none'];
    assert.ok(entry);
    assert.equal(entry.key, 'stable-key-abc');
    assert.equal(entry.hash, 'stable-hash-xyz');
    assert.equal(entry.content, '## Stable prompt\n\nLots of text here.\n');
    assert.deepEqual(entry.mtimeMap, mtimeMap);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('prompt cache entry with legacy shape (no mtimeMap) reads back as empty mtimeMap', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-prompt-state-'));
  const statePath = path.join(tmpRoot, 'prompt-state.json');

  try {
    // Hand-craft a legacy entry that lacks the new mtimeMap field.
    const legacyRaw = {
      version: 1,
      sessionEpoch: 5,
      cacheEntries: {
        'group:full:auto': {
          key: 'legacy-key',
          hash: 'legacy-hash',
          content: 'old base content only',
          manifest: {
            mode: 'full',
            totalChars: 17,
            contextEntries: [],
            contextBudget: {
              fileMaxChars: 1,
              totalMaxChars: 1,
              injectedTotalChars: 0,
              remainingChars: 0,
            },
            layers: [],
            baseCacheKey: 'legacy-key',
            basePromptHash: 'legacy-hash',
            cacheHit: false,
            skillsCatalog: {
              count: 0,
              injectedChars: 0,
              truncated: false,
            },
          },
          builtAt: '2025-12-31T00:00:00.000Z',
        },
      },
    };
    fs.writeFileSync(statePath, JSON.stringify(legacyRaw, null, 2), 'utf-8');

    const reloaded = readPromptRuntimeState(statePath);
    const entry = reloaded.cacheEntries['group:full:auto'];
    assert.ok(entry);
    assert.equal(entry.key, 'legacy-key');
    assert.equal(entry.content, 'old base content only');
    // Back-compat: missing mtimeMap is normalized to {} so the host treats
    // it as a cache miss and re-primes on the first run after upgrade.
    assert.deepEqual(entry.mtimeMap, {});
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
