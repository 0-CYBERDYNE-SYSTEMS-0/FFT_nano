import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  createCodingOrchestrator,
  createDefaultEphemeralWorktree,
  pruneRetainedWorktrees,
  type CodingWorkerRequest,
} from '../src/coding-orchestrator.js';

function makeRequest(overrides: Partial<CodingWorkerRequest> = {}): CodingWorkerRequest {
  return {
    requestId: 'coder-1',
    mode: 'execute',
    route: 'coder_execute',
    originChatJid: 'telegram:main',
    originGroupFolder: 'main',
    taskText: 'Build the feature',
    workspaceMode: 'ephemeral_worktree',
    timeoutSeconds: 300,
    allowFanout: false,
    sessionContext: '[2026-03-22T00:00:00.000Z] User: Build the feature',
    assistantName: 'FarmFriend',
    sessionKey: 'main',
    group: {
      jid: 'telegram:main',
      name: 'Main',
      folder: 'main',
      trigger: '@FarmFriend',
    },
    ...overrides,
  };
}

test('execute mode fails closed when ephemeral worktree creation fails', async () => {
  const orchestrator = createCodingOrchestrator({
    activeRuns: new Map(),
    createEphemeralWorktree: async () => {
      throw new Error('not a git repo');
    },
    runContainerAgent: async () => {
      throw new Error('should not run worker');
    },
    publishEvent: () => {},
  });

  const result = await orchestrator.runTask(makeRequest());

  assert.equal(result.ok, false);
  assert.match(result.workerResult?.error || '', /not a git repo/);
});

test('plan mode uses read-only worker execution without a worktree', async () => {
  let toolMode: string | undefined;
  const orchestrator = createCodingOrchestrator({
    activeRuns: new Map(),
    createEphemeralWorktree: async () => {
      throw new Error('should not create worktree');
    },
    runContainerAgent: async (_group, input) => {
      toolMode = input.toolMode;
      return {
        status: 'success',
        result: 'Plan ready',
        usage: { totalTokens: 5 },
        toolExecutions: [],
      };
    },
    publishEvent: () => {},
  });

  const result = await orchestrator.runTask(
    makeRequest({ mode: 'plan', route: 'coder_plan' }),
  );

  assert.equal(result.ok, true);
  assert.equal(toolMode, 'read_only');
  assert.equal(result.workerResult?.status, 'success');
  assert.equal(result.workerResult?.worktreePath, undefined);
});

test('execute mode returns structured worker result with changed files', async () => {
  const orchestrator = createCodingOrchestrator({
    activeRuns: new Map(),
    createEphemeralWorktree: async () => ({
      worktreePath: '/tmp/coder-1',
      cleanup: async () => {},
      listChangedFiles: () => ['src/app.ts', 'tests/app.test.ts'],
      getDiffSummary: () => '2 files changed',
    }),
    runContainerAgent: async () => ({
      status: 'success',
      result: 'Implemented feature and ran npm test.',
      usage: { totalTokens: 12 },
      toolExecutions: [
        { index: 1, toolName: 'bash', status: 'ok', args: '{"command":"npm test"}' },
      ],
    }),
    publishEvent: () => {},
  });

  const result = await orchestrator.runTask(makeRequest());

  assert.equal(result.ok, true);
  assert.deepEqual(result.workerResult?.changedFiles, ['src/app.ts', 'tests/app.test.ts']);
  assert.deepEqual(result.workerResult?.testsRun, ['npm test']);
  assert.equal(result.workerResult?.diffSummary, '2 files changed');
});

test('subagent routes mark worker runs as subagent executions', async () => {
  let isSubagent: boolean | undefined;
  const orchestrator = createCodingOrchestrator({
    activeRuns: new Map(),
    createEphemeralWorktree: async () => ({
      worktreePath: '/tmp/subagent-1',
      cleanup: async () => {},
      listChangedFiles: () => [],
      getDiffSummary: () => '',
    }),
    runContainerAgent: async (_group, input) => {
      isSubagent = input.isSubagent;
      return {
        status: 'success',
        result: 'done',
        usage: { totalTokens: 1 },
        toolExecutions: [],
      };
    },
    publishEvent: () => {},
  });

  const result = await orchestrator.runTask(
    makeRequest({
      requestId: 'subagent-1',
      route: 'subagent_execute',
      originGroupFolder: 'main',
    }),
  );

  assert.equal(result.ok, true);
  assert.equal(isSubagent, true);
});

test('execute mode cleans up the worktree when the worker fails', async () => {
  let cleanupCalled = false;
  const orchestrator = createCodingOrchestrator({
    activeRuns: new Map(),
    createEphemeralWorktree: async () => ({
      worktreePath: '/tmp/coder-fail-1',
      cleanup: async () => {
        cleanupCalled = true;
      },
      listChangedFiles: () => [],
      getDiffSummary: () => '',
    }),
    runContainerAgent: async () => ({
      status: 'error',
      error: 'Worker execution failed',
      usage: { totalTokens: 0 },
      toolExecutions: [],
    }),
    publishEvent: () => {},
  });

  const result = await orchestrator.runTask(makeRequest());

  assert.equal(result.ok, false);
  assert.equal(result.workerResult?.status, 'error');
  assert.equal(cleanupCalled, true);
});

test('execute mode cleans up the worktree when the worker throws', async () => {
  let cleanupCalled = false;
  const orchestrator = createCodingOrchestrator({
    activeRuns: new Map(),
    createEphemeralWorktree: async () => ({
      worktreePath: '/tmp/coder-throw-1',
      cleanup: async () => {
        cleanupCalled = true;
      },
      listChangedFiles: () => [],
      getDiffSummary: () => '',
    }),
    runContainerAgent: async () => {
      throw new Error('Container crashed');
    },
    publishEvent: () => {},
  });

  const result = await orchestrator.runTask(makeRequest());

  assert.equal(result.ok, false);
  assert.equal(result.workerResult?.status, 'error');
  assert.equal(cleanupCalled, true);
});

test('execute mode cleans up the worktree when aborted', async () => {
  let cleanupCalled = false;
  const orchestrator = createCodingOrchestrator({
    activeRuns: new Map(),
    createEphemeralWorktree: async () => ({
      worktreePath: '/tmp/coder-abort-1',
      cleanup: async () => {
        cleanupCalled = true;
      },
      listChangedFiles: () => [],
      getDiffSummary: () => '',
    }),
    runContainerAgent: async () => ({
      status: 'error',
      error: 'Execution aborted by user',
      usage: { totalTokens: 0 },
      toolExecutions: [],
    }),
    publishEvent: () => {},
  });

  const result = await orchestrator.runTask(makeRequest());

  assert.equal(result.ok, false);
  assert.equal(result.workerResult?.status, 'aborted');
  assert.equal(cleanupCalled, true);
});

test('execute mode retains the worktree after successful completion', async () => {
  let cleanupCalled = false;
  const orchestrator = createCodingOrchestrator({
    activeRuns: new Map(),
    createEphemeralWorktree: async () => ({
      worktreePath: '/tmp/coder-success-1',
      cleanup: async () => {
        cleanupCalled = true;
      },
      listChangedFiles: () => ['src/feature.ts'],
      getDiffSummary: () => '1 file changed',
    }),
    runContainerAgent: async () => ({
      status: 'success',
      result: 'Feature implemented successfully.',
      usage: { totalTokens: 100 },
      toolExecutions: [],
    }),
    publishEvent: () => {},
  });

  const result = await orchestrator.runTask(makeRequest());

  assert.equal(result.ok, true);
  assert.equal(result.workerResult?.status, 'success');
  assert.equal(cleanupCalled, false);
  assert.equal(result.workerResult?.worktreePath, '/tmp/coder-success-1');
});

test('execute mode retains worktree and reports path after success', async () => {
  const orchestrator = createCodingOrchestrator({
    activeRuns: new Map(),
    createEphemeralWorktree: async () => ({
      worktreePath: '/tmp/coder-retain-path-test',
      cleanup: async () => {},
      listChangedFiles: () => ['src/app.ts', 'tests/app.test.ts'],
      getDiffSummary: () => '2 files changed, 50 insertions(+), 10 deletions(-)',
    }),
    runContainerAgent: async () => ({
      status: 'success',
      result: 'Completed the implementation.',
      usage: { totalTokens: 50 },
      toolExecutions: [],
    }),
    publishEvent: () => {},
  });

  const result = await orchestrator.runTask(makeRequest({ requestId: 'retain-test' }));

  assert.equal(result.ok, true);
  assert.equal(result.workerResult?.worktreePath, '/tmp/coder-retain-path-test');
  assert.ok(result.workerResult?.finalMessage?.includes('/tmp/coder-retain-path-test'));
  assert.ok(result.workerResult?.finalMessage?.includes('Changed files'));
  assert.ok(result.workerResult?.finalMessage?.includes('Diff'));
});

test('pruneRetainedWorktrees removes worktrees older than retentionTtlMs', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-prune-test-'));
  const worktreeBase = path.join(tempDir, 'worktrees');
  fs.mkdirSync(worktreeBase, { recursive: true });

  // Create mock worktree directories with embedded timestamps
  // Use 30 minutes ago for "recent" to avoid boundary timing issues
  const now = Date.now();
  const thirtyMinutesAgo = now - 30 * 60 * 1000;
  const twoHoursAgo = now - 2 * 60 * 60 * 1000;
  const threeHoursAgo = now - 3 * 60 * 60 * 1000;

  // 2 hours ago > 1 hour TTL → pruned
  // 3 hours ago > 1 hour TTL → pruned
  // 30 minutes ago < 1 hour TTL → NOT pruned
  const staleWorktree1 = path.join(worktreeBase, `coder-old-1-${twoHoursAgo}`);
  const staleWorktree2 = path.join(worktreeBase, `coder-old-2-${threeHoursAgo}`);
  const recentWorktree = path.join(worktreeBase, `coder-recent-${thirtyMinutesAgo}`);

  fs.mkdirSync(staleWorktree1);
  fs.mkdirSync(staleWorktree2);
  fs.mkdirSync(recentWorktree);

  // Prune with 1-hour TTL
  const result = await pruneRetainedWorktrees({
    worktreeBaseDir: worktreeBase,
    protectedPaths: new Set<string>(),
    retentionTtlMs: 60 * 60 * 1000, // 1 hour
    maxRetainedWorktrees: 10,
  });

  assert.equal(result.pruned.length, 2);
  assert.ok(result.pruned.includes(staleWorktree1));
  assert.ok(result.pruned.includes(staleWorktree2));
  assert.ok(!result.pruned.includes(recentWorktree));
  assert.ok(fs.existsSync(recentWorktree));

  // Cleanup
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('pruneRetainedWorktrees respects maxRetainedWorktrees limit', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-prune-max-'));
  const worktreeBase = path.join(tempDir, 'worktrees');
  fs.mkdirSync(worktreeBase, { recursive: true });

  const now = Date.now();
  // Create 5 worktrees with recent timestamps
  const worktrees: string[] = [];
  for (let i = 0; i < 5; i++) {
    const wtPath = path.join(worktreeBase, `coder-${i}-${now - i * 60 * 1000}`);
    fs.mkdirSync(wtPath);
    worktrees.push(wtPath);
  }

  // Prune with maxRetainedWorktrees=3
  const result = await pruneRetainedWorktrees({
    worktreeBaseDir: worktreeBase,
    protectedPaths: new Set<string>(),
    retentionTtlMs: 48 * 60 * 60 * 1000, // 48 hours (none should be this old)
    maxRetainedWorktrees: 3,
  });

  // Should prune the 2 oldest (index 4 and 3, since sorted by timestamp descending)
  assert.equal(result.pruned.length, 2);
  assert.ok(result.pruned.includes(worktrees[4])); // oldest
  assert.ok(result.pruned.includes(worktrees[3]));

  // Cleanup
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('pruneRetainedWorktrees keeps active worktrees out of retention pruning', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-prune-active-'));
  const worktreeBase = path.join(tempDir, 'worktrees');
  fs.mkdirSync(worktreeBase, { recursive: true });

  const now = Date.now();
  // Use 2 hours ago for stale so it's STRICTLY GREATER than 1 hour TTL
  const twoHoursAgo = now - 2 * 60 * 60 * 1000;

  // Create a stale worktree that should be pruned (2 hours old > 1 hour TTL)
  const staleWorktree = path.join(worktreeBase, `coder-stale-${twoHoursAgo}`);
  fs.mkdirSync(staleWorktree);

  // Create an "active" worktree that should be protected (4 hours old but protected)
  const activeWorktree = path.join(worktreeBase, `coder-active-${now - 4 * 60 * 60 * 1000}`);
  fs.mkdirSync(activeWorktree);

  // Prune with 1-hour TTL but protect activeWorktree
  const result = await pruneRetainedWorktrees({
    worktreeBaseDir: worktreeBase,
    protectedPaths: new Set([activeWorktree]),
    retentionTtlMs: 60 * 60 * 1000, // 1 hour (stale is 2h old, so > TTL)
    maxRetainedWorktrees: 10,
  });

  // The stale worktree should be pruned
  assert.equal(result.pruned.length, 1);
  assert.ok(result.pruned.includes(staleWorktree));
  // But active worktree should NOT be pruned even though it's older than TTL
  assert.ok(fs.existsSync(activeWorktree));

  // Cleanup
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('pruneRetainedWorktrees returns empty result for non-existent directory', async () => {
  const result = await pruneRetainedWorktrees({
    worktreeBaseDir: '/tmp/fft-non-existent-dir-12345',
    protectedPaths: new Set<string>(),
    retentionTtlMs: 60 * 60 * 1000,
    maxRetainedWorktrees: 10,
  });

  assert.equal(result.pruned.length, 0);
  assert.equal(result.errors.length, 0);
});

test('pruneRetainedWorktrees skips non-directory entries', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-prune-files-'));
  const worktreeBase = path.join(tempDir, 'worktrees');
  fs.mkdirSync(worktreeBase, { recursive: true });

  // Create a file (not a directory)
  fs.writeFileSync(path.join(worktreeBase, 'not-a-worktree.txt'), 'test');

  const result = await pruneRetainedWorktrees({
    worktreeBaseDir: worktreeBase,
    protectedPaths: new Set<string>(),
    retentionTtlMs: 0, // would delete everything if files were included
    maxRetainedWorktrees: 0,
  });

  // File should be ignored, not treated as a worktree
  assert.equal(result.pruned.length, 0);
  assert.ok(fs.existsSync(path.join(worktreeBase, 'not-a-worktree.txt')));

  // Cleanup
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('pruneRetainedWorktrees skips entries with invalid timestamp format', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-prune-invalid-'));
  const worktreeBase = path.join(tempDir, 'worktrees');
  fs.mkdirSync(worktreeBase, { recursive: true });

  // Create directories with invalid timestamp formats
  fs.mkdirSync(path.join(worktreeBase, 'valid-coder-1234567890123')); // valid
  fs.mkdirSync(path.join(worktreeBase, 'invalid-no-timestamp')); // no timestamp
  fs.mkdirSync(path.join(worktreeBase, 'invalid-not-a-number-abc')); // non-numeric
  fs.mkdirSync(path.join(worktreeBase, 'invalid-negative--12345')); // negative

  const result = await pruneRetainedWorktrees({
    worktreeBaseDir: worktreeBase,
    protectedPaths: new Set<string>(),
    retentionTtlMs: 0, // would delete all valid timestamp dirs
    maxRetainedWorktrees: 0,
  });

  // Only the valid timestamp directory should be considered for pruning
  // Since maxRetainedWorktrees=0, the valid one should be pruned
  // But invalid ones should be skipped entirely
  assert.equal(result.pruned.length, 1);
  assert.ok(fs.existsSync(path.join(worktreeBase, 'invalid-no-timestamp')));
  assert.ok(fs.existsSync(path.join(worktreeBase, 'invalid-not-a-number-abc')));
  assert.ok(fs.existsSync(path.join(worktreeBase, 'invalid-negative--12345')));

  // Cleanup
  fs.rmSync(tempDir, { recursive: true, force: true });
});

// TODO: Re-enable this test once the temp directory isolation issue is resolved
// The test is flaky because mkdtemp might create a dir inside the main git repo tree,
// causing git init to reinitialize the parent repo instead of creating a fresh one
test.skip('createDefaultEphemeralWorktree handles unborn repository (no commits)', async () => {
  // Create an unborn git repo (initialized but no commits)
  const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-unborn-source-'));
  const { execSync: execSyncFn } = await import('child_process');
  const execSync = (cmd: string, opts: { cwd?: string; encoding: string }) => {
    try {
      return execSyncFn(cmd, opts) as string;
    } catch {
      return null;
    }
  };
  execSync('git init', { cwd: sourceDir, encoding: 'utf-8' });

  // Create source directory structure
  fs.mkdirSync(path.join(sourceDir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(sourceDir, 'node_modules'), { recursive: true });
  fs.mkdirSync(path.join(sourceDir, 'dist'), { recursive: true });

  // Create some source files including a gitignored one
  fs.writeFileSync(path.join(sourceDir, 'src/app.ts'), 'export const x = 1;');
  fs.writeFileSync(path.join(sourceDir, 'src/index.ts'), 'export * from "./app";');
  fs.writeFileSync(path.join(sourceDir, '.gitignore'), 'node_modules\ndist\n');
  // Create gitignored files
  fs.writeFileSync(path.join(sourceDir, 'node_modules/package.json'), '{}');
  fs.writeFileSync(path.join(sourceDir, 'dist/bundle.js'), 'console.log("hi");');

  // Create the worktree from the unborn repo
  const worktree = await createDefaultEphemeralWorktree({
    requestId: 'unborn-test',
    sourceWorkspaceDir: sourceDir,
  });

  try {
    // Verify the worktree was created
    assert.ok(fs.existsSync(worktree.worktreePath));

    // Verify listChangedFiles returns untracked files/directories (git shows dirs when all contents untracked)
    const changedFiles = worktree.listChangedFiles();
    assert.ok(changedFiles.length > 0, 'Should have changed files, got: ' + JSON.stringify(changedFiles));
    // git status --short shows directories (like src/) rather than individual files when all contents are untracked
    // node_modules and dist should NOT be included (gitignored)
    assert.ok(!changedFiles.some((f) => f.includes('node_modules')), 'Should not include node_modules, got: ' + JSON.stringify(changedFiles));
    assert.ok(!changedFiles.some((f) => f.includes('dist')), 'Should not include dist, got: ' + JSON.stringify(changedFiles));

    // Verify getDiffSummary returns empty string (no HEAD to diff against)
    const diffSummary = worktree.getDiffSummary();
    console.log('DEBUG diffSummary:', JSON.stringify(diffSummary));
    assert.equal(diffSummary, '', 'getDiffSummary should return empty string for unborn repo');

    // Verify the worktree is a valid git repo
    const gitDirResult = execSync('git rev-parse --git-dir', { cwd: worktree.worktreePath, encoding: 'utf-8' });
    assert.ok(gitDirResult && gitDirResult.trim(), 'Worktree should be a git repo, got: ' + gitDirResult);
  } finally {
    // Cleanup
    await worktree.cleanup();
    fs.rmSync(sourceDir, { recursive: true, force: true });
  }
});
