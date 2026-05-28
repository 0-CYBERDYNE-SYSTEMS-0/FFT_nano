import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  shouldEvaluate,
  buildRefinementPrompt,
  buildArtifactVerification,
  buildEvaluatorContainerInput,
  canAutoRefineActionfulChatTask,
  extractClaimedArtifactPaths,
  isActionfulChatTask,
  type EvaluatorContext,
  type EvaluatorVerdict,
} from '../src/evaluator.js';
import { buildSystemPrompt } from '../src/system-prompt.js';
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

  // These threshold-based tests now use subagent runType since chat/cron/scheduled/heartbeat
  // always skip evaluation
  it('evaluates subagent when duration exceeds threshold', () => {
    const result = shouldEvaluate(ctx({ runType: 'subagent', durationMs: 60_000 }));
    assert.equal(result.evaluate, true);
  });

  it('evaluates subagent when tool count exceeds threshold', () => {
    const result = shouldEvaluate(ctx({ runType: 'subagent', toolsInvoked: 5 }));
    assert.equal(result.evaluate, true);
  });

  it('evaluates subagent when output length exceeds threshold', () => {
    const result = shouldEvaluate(ctx({ runType: 'subagent', agentOutput: 'x'.repeat(2000) }));
    assert.equal(result.evaluate, true);
  });

  it('skips short heartbeat runs below thresholds', () => {
    const result = shouldEvaluate(
      ctx({ runType: 'heartbeat', durationMs: 100, toolsInvoked: 0 }),
    );
    assert.equal(result.evaluate, false);
    assert.match(result.reason, /not eligible/);
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

  // VAL-EVAL-001: Chat runs always skip evaluator regardless of thresholds or forceEvaluate
  it('skips chat runs regardless of duration threshold', () => {
    const result = shouldEvaluate(
      ctx({ runType: 'chat', durationMs: 120_000, toolsInvoked: 0, agentOutput: 'short' }),
    );
    assert.equal(result.evaluate, false);
    assert.match(result.reason, /not eligible/);
  });

  it('skips chat runs regardless of tool count threshold', () => {
    const result = shouldEvaluate(
      ctx({ runType: 'chat', durationMs: 5_000, toolsInvoked: 10, agentOutput: 'short' }),
    );
    assert.equal(result.evaluate, false);
    assert.match(result.reason, /not eligible/);
  });

  it('skips chat runs regardless of output length', () => {
    const result = shouldEvaluate(
      ctx({ runType: 'chat', durationMs: 5_000, toolsInvoked: 0, agentOutput: 'x'.repeat(5000) }),
    );
    assert.equal(result.evaluate, false);
    assert.match(result.reason, /not eligible/);
  });

  it('skips chat runs even with forceEvaluate', () => {
    const result = shouldEvaluate(
      ctx({ runType: 'chat', durationMs: 120_000, toolsInvoked: 10, agentOutput: 'x'.repeat(5000), forceEvaluate: true }),
    );
    assert.equal(result.evaluate, false);
    assert.match(result.reason, /not eligible/);
  });

  // VAL-EVAL-002: Scheduled runs always skip evaluator regardless of thresholds
  it('skips scheduled runs regardless of duration threshold', () => {
    const result = shouldEvaluate(
      ctx({ runType: 'scheduled', durationMs: 120_000, toolsInvoked: 0, agentOutput: 'short' }),
    );
    assert.equal(result.evaluate, false);
    assert.match(result.reason, /not eligible/);
  });

  it('skips scheduled runs regardless of tool count threshold', () => {
    const result = shouldEvaluate(
      ctx({ runType: 'scheduled', durationMs: 5_000, toolsInvoked: 10, agentOutput: 'short' }),
    );
    assert.equal(result.evaluate, false);
    assert.match(result.reason, /not eligible/);
  });

  it('skips scheduled runs even with forceEvaluate', () => {
    const result = shouldEvaluate(
      ctx({ runType: 'scheduled', durationMs: 120_000, toolsInvoked: 10, agentOutput: 'x'.repeat(5000), forceEvaluate: true }),
    );
    assert.equal(result.evaluate, false);
    assert.match(result.reason, /not eligible/);
  });

  // VAL-EVAL-003: Cron runs always skip evaluator regardless of thresholds
  it('skips cron runs regardless of duration threshold', () => {
    const result = shouldEvaluate(
      ctx({ runType: 'cron', durationMs: 120_000, toolsInvoked: 0, agentOutput: 'short' }),
    );
    assert.equal(result.evaluate, false);
    assert.match(result.reason, /not eligible/);
  });

  it('skips cron runs regardless of tool count threshold', () => {
    const result = shouldEvaluate(
      ctx({ runType: 'cron', durationMs: 5_000, toolsInvoked: 10, agentOutput: 'short' }),
    );
    assert.equal(result.evaluate, false);
    assert.match(result.reason, /not eligible/);
  });

  it('skips cron runs even with forceEvaluate', () => {
    const result = shouldEvaluate(
      ctx({ runType: 'cron', durationMs: 120_000, toolsInvoked: 10, agentOutput: 'x'.repeat(5000), forceEvaluate: true }),
    );
    assert.equal(result.evaluate, false);
    assert.match(result.reason, /not eligible/);
  });

  // VAL-EVAL-004: Heartbeat runs always skip evaluator regardless of thresholds
  it('skips heartbeat runs regardless of duration threshold', () => {
    const result = shouldEvaluate(
      ctx({ runType: 'heartbeat', durationMs: 120_000, toolsInvoked: 0, agentOutput: 'short' }),
    );
    assert.equal(result.evaluate, false);
    assert.match(result.reason, /not eligible/);
  });

  it('skips heartbeat runs regardless of tool count threshold', () => {
    const result = shouldEvaluate(
      ctx({ runType: 'heartbeat', durationMs: 5_000, toolsInvoked: 10, agentOutput: 'short' }),
    );
    assert.equal(result.evaluate, false);
    assert.match(result.reason, /not eligible/);
  });

  it('skips heartbeat runs even with forceEvaluate', () => {
    const result = shouldEvaluate(
      ctx({ runType: 'heartbeat', durationMs: 120_000, toolsInvoked: 10, agentOutput: 'x'.repeat(5000), forceEvaluate: true }),
    );
    assert.equal(result.evaluate, false);
    assert.match(result.reason, /not eligible/);
  });

  // VAL-EVAL-005: Coding runs with changed files still trigger evaluation
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

  // VAL-EVAL-006: Subagent runs subject to threshold-based evaluation
  it('evaluates subagent run when duration exceeds threshold', () => {
    const result = shouldEvaluate(
      ctx({ runType: 'subagent', durationMs: 60_000, toolsInvoked: 0, agentOutput: 'short' }),
    );
    assert.equal(result.evaluate, true);
    assert.match(result.reason, /duration/);
  });

  it('evaluates subagent run when tool count exceeds threshold', () => {
    const result = shouldEvaluate(
      ctx({ runType: 'subagent', durationMs: 5_000, toolsInvoked: 5, agentOutput: 'short' }),
    );
    assert.equal(result.evaluate, true);
    assert.match(result.reason, /tools/);
  });

  it('evaluates subagent run when output length exceeds threshold', () => {
    const result = shouldEvaluate(
      ctx({ runType: 'subagent', durationMs: 5_000, toolsInvoked: 0, agentOutput: 'x'.repeat(2000) }),
    );
    assert.equal(result.evaluate, true);
    assert.match(result.reason, /output/);
  });

  it('skips subagent run below all thresholds', () => {
    const result = shouldEvaluate(
      ctx({ runType: 'subagent', durationMs: 5_000, toolsInvoked: 0, agentOutput: 'short' }),
    );
    assert.equal(result.evaluate, false);
    // Hits the "trivially short run" fast path (all of duration < 15s, tools < 2, output < 500)
    assert.equal(result.reason, 'trivially short run');
  });

  it('evaluates subagent run with forceEvaluate', () => {
    const result = shouldEvaluate(
      ctx({ runType: 'subagent', durationMs: 5_000, toolsInvoked: 0, agentOutput: 'short', forceEvaluate: true }),
    );
    assert.equal(result.evaluate, true);
    assert.match(result.reason, /forced/);
  });

  // VAL-EVAL-007: Empty output guard preserved for coding and subagent
  it('skips empty output for coding run type', () => {
    const result = shouldEvaluate(
      ctx({ runType: 'coding', changedFiles: ['src/foo.ts'], agentOutput: '' }),
    );
    assert.equal(result.evaluate, false);
    assert.match(result.reason, /empty/);
  });

  it('skips whitespace-only output for coding run type', () => {
    const result = shouldEvaluate(
      ctx({ runType: 'coding', changedFiles: ['src/foo.ts'], agentOutput: '   \n  ' }),
    );
    assert.equal(result.evaluate, false);
    assert.match(result.reason, /empty/);
  });

  it('skips empty output for subagent run type', () => {
    const result = shouldEvaluate(
      ctx({ runType: 'subagent', durationMs: 60_000, toolsInvoked: 5, agentOutput: '' }),
    );
    assert.equal(result.evaluate, false);
    assert.match(result.reason, /empty/);
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

  it('does not expose user-facing Messaging IPC instructions to evaluator runs', () => {
    const input = buildEvaluatorContainerInput(
      ctx({
        isMain: true,
        workspaceDirOverride: '/tmp/some-worktree',
        workspaceDir: '/tmp/some-worktree',
        agentOutput: 'Captured `knowledge/raw/network.md`.',
        forceEvaluate: true,
      }),
    );

    const systemPrompt = buildSystemPrompt(
      {
        ...(input as any),
        codingHint: input.codingHint || 'none',
      },
      {
        groupDir: '/tmp/group',
        globalDir: '/tmp/global',
        ipcDir: '/tmp/ipc/main',
      },
    ).text;

    assert.equal(input.isEvaluatorRun, true);
    assert.doesNotMatch(systemPrompt, /## Messaging IPC/);
    assert.doesNotMatch(systemPrompt, /messages\/\*\.json/);
    assert.doesNotMatch(systemPrompt, /"type":"message"/);
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
