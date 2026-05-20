import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  shouldEvaluate,
  buildEvaluatorEscalationMessage,
  buildRefinementPrompt,
  buildArtifactVerification,
  buildEvaluatorContainerInput,
  canAutoRefineActionfulChatTask,
  extractClaimedArtifactPaths,
  isActionfulChatTask,
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
    const result = shouldEvaluate(
      ctx({ durationMs: 5_000, toolsInvoked: 0, agentOutput: 'ok' }),
    );
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

  it('skips short heartbeat runs below thresholds', () => {
    const result = shouldEvaluate(
      ctx({ runType: 'heartbeat', durationMs: 100, toolsInvoked: 0 }),
    );
    assert.equal(result.evaluate, false);
    assert.match(result.reason, /trivially short/);
  });

  it('skips short scheduled runs below thresholds', () => {
    const result = shouldEvaluate(
      ctx({ runType: 'scheduled', durationMs: 100, toolsInvoked: 0 }),
    );
    assert.equal(result.evaluate, false);
  });

  it('skips short cron runs below thresholds', () => {
    const result = shouldEvaluate(
      ctx({ runType: 'cron', durationMs: 100, toolsInvoked: 0 }),
    );
    assert.equal(result.evaluate, false);
  });

  it('evaluates coding run with changed files', () => {
    const result = shouldEvaluate(
      ctx({
        runType: 'coding',
        changedFiles: ['src/foo.ts'],
        durationMs: 5_000,
        toolsInvoked: 0,
      }),
    );
    assert.equal(result.evaluate, true);
    assert.match(result.reason, /coding/);
  });

  it('skips coding run with no changed files below threshold', () => {
    const result = shouldEvaluate(
      ctx({
        runType: 'coding',
        changedFiles: [],
        durationMs: 5_000,
        toolsInvoked: 0,
        agentOutput: 'short',
      }),
    );
    assert.equal(result.evaluate, false);
  });

  it('includes reason in result', () => {
    const result = shouldEvaluate(ctx({ durationMs: 90_000 }));
    assert.ok(result.reason.length > 0);
  });
});

// ---------------------------------------------------------------------------
// actionful chat + artifact verification
// ---------------------------------------------------------------------------

describe('actionful chat detection', () => {
  it('detects capture/wiki requests in the latest inbound section', () => {
    assert.equal(
      isActionfulChatTask(
        '[NEW INBOUND MESSAGES]\nTD: research this and capture it to the wiki',
      ),
      true,
    );
  });

  it('detects deliverable creation requests', () => {
    assert.equal(
      isActionfulChatTask('Create a PDF report and send it back.'),
      true,
    );
  });

  it('detects task completion and test requests', () => {
    assert.equal(isActionfulChatTask('make the fixes and test'), true);
  });

  it('does not treat a shared noun/verb term as both roles', () => {
    assert.equal(isActionfulChatTask('why did this test fail?'), false);
  });

  it('detects explicit test commands without relying on duplicated roles', () => {
    assert.equal(isActionfulChatTask('run the tests'), true);
  });

  it('detects deploy and restart operations', () => {
    assert.equal(
      isActionfulChatTask('Deploy the app and restart the service.'),
      true,
    );
  });

  it('does not let old conversation context force blocking validation', () => {
    assert.equal(
      isActionfulChatTask(
        'TD: capture this to the wiki\n[NEW INBOUND MESSAGES]\nTD: explain only',
      ),
      false,
    );
  });

  it('keeps pure explanation requests out of blocking validation', () => {
    assert.equal(
      isActionfulChatTask('Explain the validator policy only.'),
      false,
    );
  });

  it('allows automatic refinement only for local/idempotent actionful work', () => {
    assert.equal(
      canAutoRefineActionfulChatTask('capture this research to the wiki'),
      true,
    );
    assert.equal(
      canAutoRefineActionfulChatTask('Deploy the app and restart the service.'),
      false,
    );
  });
});

describe('artifact verification', () => {
  it('extracts claimed knowledge and memory artifact paths', () => {
    assert.deepEqual(
      extractClaimedArtifactPaths(
        'Captured to `knowledge/raw/network.md` and updated MEMORY.md.',
      ),
      ['MEMORY.md', 'knowledge/raw/network.md'],
    );
  });

  it('extracts artifact paths from shell snippets without claiming the whole command', () => {
    assert.deepEqual(
      extractClaimedArtifactPaths(
        'Run `mkdir -p knowledge/raw && touch knowledge/raw/a.md`.',
      ),
      ['knowledge/raw/a.md'],
    );
  });

  it('checks claimed artifacts in the provided workspace', () => {
    const workspaceDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'fft-evaluator-artifacts-'),
    );
    fs.mkdirSync(path.join(workspaceDir, 'knowledge', 'raw'), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(workspaceDir, 'knowledge', 'raw', 'network.md'),
      '# Network\n',
      'utf8',
    );

    const verification = buildArtifactVerification({
      workspaceDir,
      agentOutput:
        'Captured `knowledge/raw/network.md` and `knowledge/raw/missing.md`.',
    });

    assert.deepEqual(verification?.existingPaths, ['knowledge/raw/network.md']);
    assert.deepEqual(verification?.missingPaths, ['knowledge/raw/missing.md']);
  });

  it('builds evaluator input with the original main/workspace settings', () => {
    const input = buildEvaluatorContainerInput(
      ctx({
        isMain: true,
        workspaceDirOverride: '/tmp/some-worktree',
        workspaceDir: '/tmp/some-worktree',
        agentOutput: 'Captured `knowledge/raw/network.md`.',
        forceEvaluate: true,
      }),
    );

    assert.equal(input.isMain, true);
    assert.equal(input.workspaceDirOverride, '/tmp/some-worktree');
    assert.equal(input.toolMode, 'read_only');
    assert.match(input.prompt, /Host Artifact Verification/);
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

describe('buildEvaluatorEscalationMessage', () => {
  it('does not expose evaluator score, issues, or feedback details', () => {
    const message = buildEvaluatorEscalationMessage('approval_required');
    assert.match(message, /could not verify/i);
    assert.match(message, /approval/i);
    assert.doesNotMatch(message, /score|issues|feedback|Quality check|Evaluator/i);
  });

  it('distinguishes retry exhaustion without internal verdict text', () => {
    const message = buildEvaluatorEscalationMessage('max_refinements');
    assert.match(message, /retried/i);
    assert.doesNotMatch(message, /score|issues|feedback|Quality check|Evaluator/i);
  });
});
