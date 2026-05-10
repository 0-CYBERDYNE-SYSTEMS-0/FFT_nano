import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  shouldEvaluate,
  buildRefinementPrompt,
  type EvaluatorContext,
  type EvaluatorVerdict,
} from '../src/evaluator.js';
import type { RegisteredGroup } from '../src/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const group: RegisteredGroup = {
  name: 'test',
  folder: 'test-group',
  chatJid: 'test-chat@g.us',
  isMain: false,
};

function ctx(overrides: Partial<EvaluatorContext> = {}): EvaluatorContext {
  return {
    runType: 'chat',
    originalTask: 'Summarize the crop status.',
    agentOutput: 'Here is the crop summary.',
    durationMs: 10_000,
    toolsInvoked: 0,
    group,
    chatJid: 'test-chat@g.us',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// shouldEvaluate
// ---------------------------------------------------------------------------

describe('shouldEvaluate', () => {
  it('skips trivially short chat runs', () => {
    const result = shouldEvaluate(ctx({ durationMs: 5_000, toolsInvoked: 0, agentOutput: 'ok' }));
    assert.equal(result.evaluate, false);
  });

  it('skips empty output', () => {
    const result = shouldEvaluate(ctx({ agentOutput: '' }));
    assert.equal(result.evaluate, false);
  });

  it('skips whitespace-only output', () => {
    const result = shouldEvaluate(ctx({ agentOutput: '   \n  ' }));
    assert.equal(result.evaluate, false);
  });

  it('evaluates when duration exceeds threshold', () => {
    const result = shouldEvaluate(ctx({ durationMs: 60_000 }));
    assert.equal(result.evaluate, true);
  });

  it('evaluates when tool count exceeds threshold', () => {
    const result = shouldEvaluate(ctx({ toolsInvoked: 5 }));
    assert.equal(result.evaluate, true);
  });

  it('evaluates when output length exceeds threshold', () => {
    const result = shouldEvaluate(ctx({ agentOutput: 'x'.repeat(2000) }));
    assert.equal(result.evaluate, true);
  });

  it('always evaluates heartbeat runs regardless of duration', () => {
    const result = shouldEvaluate(ctx({ runType: 'heartbeat', durationMs: 100, toolsInvoked: 0 }));
    assert.equal(result.evaluate, true);
    assert.match(result.reason, /heartbeat/);
  });

  it('always evaluates scheduled runs', () => {
    const result = shouldEvaluate(ctx({ runType: 'scheduled', durationMs: 100, toolsInvoked: 0 }));
    assert.equal(result.evaluate, true);
  });

  it('always evaluates cron runs', () => {
    const result = shouldEvaluate(ctx({ runType: 'cron', durationMs: 100, toolsInvoked: 0 }));
    assert.equal(result.evaluate, true);
  });

  it('evaluates coding run with changed files', () => {
    const result = shouldEvaluate(ctx({ runType: 'coding', changedFiles: ['src/foo.ts'], durationMs: 5_000, toolsInvoked: 0 }));
    assert.equal(result.evaluate, true);
    assert.match(result.reason, /coding/);
  });

  it('skips coding run with no changed files below threshold', () => {
    const result = shouldEvaluate(ctx({ runType: 'coding', changedFiles: [], durationMs: 5_000, toolsInvoked: 0, agentOutput: 'short' }));
    assert.equal(result.evaluate, false);
  });

  it('includes reason in result', () => {
    const result = shouldEvaluate(ctx({ durationMs: 90_000 }));
    assert.ok(result.reason.length > 0);
  });
});

// ---------------------------------------------------------------------------
// buildRefinementPrompt
// ---------------------------------------------------------------------------

describe('buildRefinementPrompt', () => {
  const verdict: EvaluatorVerdict = {
    pass: false,
    score: 4,
    issues: ['Missing crop yield data', 'No weather context included'],
    feedback: 'Response skipped critical sections of the task.',
    skipped: false,
  };

  it('includes original task text', () => {
    const prompt = buildRefinementPrompt('Analyze the harvest.', verdict);
    assert.ok(prompt.includes('Analyze the harvest.'));
  });

  it('includes score', () => {
    const prompt = buildRefinementPrompt('task', verdict);
    assert.ok(prompt.includes('4/10'));
  });

  it('includes all issues', () => {
    const prompt = buildRefinementPrompt('task', verdict);
    assert.ok(prompt.includes('Missing crop yield data'));
    assert.ok(prompt.includes('No weather context included'));
  });

  it('includes evaluator feedback', () => {
    const prompt = buildRefinementPrompt('task', verdict);
    assert.ok(prompt.includes('Response skipped critical sections'));
  });

  it('handles empty issues array gracefully', () => {
    const noIssues: EvaluatorVerdict = { ...verdict, issues: [] };
    const prompt = buildRefinementPrompt('task', noIssues);
    assert.ok(!prompt.includes('Issues found:'));
  });
});
