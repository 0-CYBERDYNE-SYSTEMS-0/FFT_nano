import assert from 'node:assert/strict';
import child_process from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import test from 'node:test';

import {
  checkWorktreeCleanliness,
  purgeOldMemoryTrash,
  purgeOldTestGroups,
} from '../src/workspace-maintenance.js';

function mkTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function gitInit(cwd: string): void {
  child_process.execSync('git init -q', { cwd, stdio: 'pipe' });
  child_process.execSync('git config user.email test@example.com', {
    cwd,
    stdio: 'pipe',
  });
  child_process.execSync('git config user.name Test', { cwd, stdio: 'pipe' });
}

function gitCommitAll(cwd: string, message: string): void {
  child_process.execSync('git add -A', { cwd, stdio: 'pipe' });
  child_process.execSync(`git commit -q -m "${message}"`, {
    cwd,
    stdio: 'pipe',
  });
}

function setMtime(filePath: string, mtime: Date): void {
  const ts = mtime.getTime() / 1000;
  fs.utimesSync(filePath, ts, ts);
}

function setMtimeRecursive(target: string, mtime: Date): void {
  const ts = mtime.getTime() / 1000;
  const stack: string[] = [target];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    const stat = fs.statSync(current);
    fs.utimesSync(current, ts, ts);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(current)) {
        stack.push(path.join(current, entry));
      }
    }
  }
}

// ---------------------------------------------------------------------------
// checkWorktreeCleanliness — fixture git repos
// ---------------------------------------------------------------------------

test('checkWorktreeCleanliness reports clean repo as clean', () => {
  const root = mkTempDir('fft-wm-clean-');
  try {
    gitInit(root);
    fs.writeFileSync(path.join(root, 'README.md'), '# fixture\n');
    gitCommitAll(root, 'initial');
    const result = checkWorktreeCleanliness({
      cwd: root,
      runGitStatus: (cwd) =>
        child_process.execSync('git status --short', {
          cwd,
          encoding: 'utf-8',
        }),
    });
    assert.equal(result.clean, true);
    assert.equal(result.modifiedCount, 0);
    assert.equal(result.untrackedCount, 0);
    assert.equal(result.modifiedFiles.length, 0);
    assert.equal(result.untrackedFiles.length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('checkWorktreeCleanliness counts tracked modifications and untracked files separately', () => {
  const root = mkTempDir('fft-wm-mods-');
  try {
    gitInit(root);
    fs.writeFileSync(path.join(root, 'README.md'), '# fixture\n');
    fs.writeFileSync(path.join(root, 'tracked.ts'), 'export const x = 1;\n');
    gitCommitAll(root, 'initial');

    // Modify a tracked file (M), add an untracked file (??), and stage a
    // new file (A). Use direct git porcelain output to keep the test
    // decoupled from local git defaults.
    fs.writeFileSync(path.join(root, 'tracked.ts'), 'export const x = 2;\n');
    fs.writeFileSync(path.join(root, 'scratch.ts'), 'temp\n');

    const statusOutput = [
      ' M tracked.ts',
      '?? scratch.ts',
      '',
    ].join('\n');
    const result = checkWorktreeCleanliness({
      cwd: root,
      runGitStatus: () => statusOutput,
    });
    assert.equal(result.clean, false);
    assert.equal(result.modifiedCount, 1);
    assert.equal(result.untrackedCount, 1);
    assert.deepEqual(result.modifiedFiles, ['tracked.ts']);
    assert.deepEqual(result.untrackedFiles, ['scratch.ts']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('checkWorktreeCleanliness treats .env.local (and rotated variants) as whitelisted', () => {
  const statusOutput = [
    ' M tracked.ts',
    '?? .env.local',
    '?? .env.local.bak',
    '?? .env.local.2026-07-01',
    '?? reports/run-2026-07.txt',
    '',
  ].join('\n');
  const result = checkWorktreeCleanliness({
    cwd: '/tmp/no-such-worktree',
    whitelist: ['.env.local', '.env.local.*'],
    runGitStatus: () => statusOutput,
  });
  assert.equal(result.modifiedCount, 1);
  assert.equal(result.untrackedCount, 1);
  assert.deepEqual(result.modifiedFiles, ['tracked.ts']);
  assert.deepEqual(result.untrackedFiles, ['reports/run-2026-07.txt']);
  // The three whitelisted .env.local* entries should not surface as
  // untracked or modified but should appear in whitelistHits for audit.
  assert.equal(result.whitelistHits.length, 3);
  assert.ok(result.whitelistHits.includes('.env.local'));
  assert.ok(result.whitelistHits.includes('.env.local.bak'));
  assert.ok(
    result.whitelistHits.includes('.env.local.2026-07-01'),
  );
});

test('checkWorktreeCleanliness surfaces git status errors as warnings', () => {
  const result = checkWorktreeCleanliness({
    cwd: '/tmp/no-such-worktree',
    runGitStatus: () => {
      throw new Error('not a git repository');
    },
  });
  assert.equal(result.clean, true);
  assert.equal(result.modifiedCount, 0);
  assert.equal(result.untrackedCount, 0);
  assert.ok(
    result.warnings.some((line) => line.includes('not a git repository')),
  );
});

// ---------------------------------------------------------------------------
// purgeOldMemoryTrash — fixture trash directory
// ---------------------------------------------------------------------------

test('purgeOldMemoryTrash moves old files into dated archive and leaves recent files', () => {
  const root = mkTempDir('fft-wm-trash-');
  const trashDir = path.join(root, 'memory', 'trash');
  const archiveRoot = path.join(root, 'memory');
  fs.mkdirSync(trashDir, { recursive: true });

  const oldDate = new Date('2026-01-15T00:00:00.000Z');
  const recentDate = new Date('2026-07-01T00:00:00.000Z');
  const fixedNow = new Date('2026-07-07T00:00:00.000Z');

  // Three old files: should be archived.
  for (const name of ['old-a.md', 'old-b.md', 'old-c.md']) {
    const file = path.join(trashDir, name);
    fs.writeFileSync(file, `# ${name}\n`);
    setMtime(file, oldDate);
  }
  // One recent file: should remain in trash.
  const recentPath = path.join(trashDir, 'recent.md');
  fs.writeFileSync(recentPath, '# recent\n');
  setMtime(recentPath, recentDate);

  try {
    const result = purgeOldMemoryTrash({
      memoryTrashDir: trashDir,
      archiveRoot,
      now: () => fixedNow,
      retentionDays: 30,
      enabled: true,
    });
    assert.equal(result.skipped, false);
    assert.equal(result.scanned, 4);
    assert.equal(result.archivedFiles.length, 3);
    assert.equal(result.skippedRecent.length, 1);
    assert.equal(result.skippedRecent[0], 'recent.md');
    assert.equal(result.retentionDays, 30);
    assert.ok(result.archiveBucket);
    assert.ok(result.archiveBucket!.endsWith('trash-archive-2026-07'));
    assert.ok(fs.existsSync(result.archiveBucket!));
    assert.equal(
      fs.existsSync(path.join(result.archiveBucket!, 'old-a.md')),
      true,
    );
    assert.equal(
      fs.existsSync(path.join(result.archiveBucket!, 'old-b.md')),
      true,
    );
    assert.equal(
      fs.existsSync(path.join(result.archiveBucket!, 'old-c.md')),
      true,
    );
    // Recent file stays put; since it is the only file remaining, the trash
    // dir is NOT auto-removed (we only auto-remove when fully empty).
    assert.equal(fs.existsSync(recentPath), true);
    assert.equal(result.deletedSourceDir, false);
    assert.equal(result.errors.length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('purgeOldMemoryTrash removes the source trash directory when emptied', () => {
  const root = mkTempDir('fft-wm-trash-empty-');
  const trashDir = path.join(root, 'memory', 'trash');
  const archiveRoot = path.join(root, 'memory');
  fs.mkdirSync(trashDir, { recursive: true });

  const oldDate = new Date('2026-01-15T00:00:00.000Z');
  const fixedNow = new Date('2026-07-07T00:00:00.000Z');
  for (const name of ['stale-1.md', 'stale-2.md']) {
    const file = path.join(trashDir, name);
    fs.writeFileSync(file, `# ${name}\n`);
    setMtime(file, oldDate);
  }

  try {
    const result = purgeOldMemoryTrash({
      memoryTrashDir: trashDir,
      archiveRoot,
      now: () => fixedNow,
      retentionDays: 30,
      enabled: true,
    });
    assert.equal(result.archivedFiles.length, 2);
    assert.equal(result.deletedSourceDir, true);
    assert.equal(fs.existsSync(trashDir), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('purgeOldMemoryTrash is a no-op when maintenance is disabled', () => {
  const root = mkTempDir('fft-wm-trash-skip-');
  const trashDir = path.join(root, 'memory', 'trash');
  const archiveRoot = path.join(root, 'memory');
  fs.mkdirSync(trashDir, { recursive: true });
  const file = path.join(trashDir, 'old.md');
  fs.writeFileSync(file, '# old\n');
  setMtime(file, new Date('2026-01-15T00:00:00.000Z'));

  try {
    const result = purgeOldMemoryTrash({
      memoryTrashDir: trashDir,
      archiveRoot,
      retentionDays: 30,
      enabled: false,
    });
    assert.equal(result.skipped, true);
    assert.equal(result.archivedFiles.length, 0);
    assert.equal(fs.existsSync(file), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('purgeOldMemoryTrash handles missing trash directory gracefully', () => {
  const root = mkTempDir('fft-wm-trash-missing-');
  try {
    const result = purgeOldMemoryTrash({
      memoryTrashDir: path.join(root, 'memory', 'trash'),
      archiveRoot: path.join(root, 'memory'),
      retentionDays: 30,
      enabled: true,
    });
    assert.equal(result.scanned, 0);
    assert.equal(result.errors.length, 0);
    assert.equal(result.archivedFiles.length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// purgeOldTestGroups — fixture groups directory
// ---------------------------------------------------------------------------

test('purgeOldTestGroups archives stale test-*/scratch-*/temp-* dirs and leaves real ones alone', () => {
  const root = mkTempDir('fft-wm-groups-');
  const groupsDir = path.join(root, 'groups');
  const archiveRoot = path.join(root, 'archive', 'purged-groups');
  fs.mkdirSync(groupsDir, { recursive: true });
  fs.mkdirSync(archiveRoot, { recursive: true });

  const oldDate = new Date('2026-01-15T00:00:00.000Z');
  const recentDate = new Date('2026-07-01T00:00:00.000Z');
  const fixedNow = new Date('2026-07-07T00:00:00.000Z');

  // Stale groups that should be archived + removed.
  const staleGroups = ['test-alice', 'scratch-bob', 'temp-charlie'];
  for (const name of staleGroups) {
    const dir = path.join(groupsDir, name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'MEMORY.md'), `# ${name}\n`);
    setMtimeRecursive(dir, oldDate);
  }
  // Recent test group: should NOT be archived.
  const recentDir = path.join(groupsDir, 'test-recent');
  fs.mkdirSync(recentDir, { recursive: true });
  fs.writeFileSync(path.join(recentDir, 'MEMORY.md'), '# recent\n');
  setMtimeRecursive(recentDir, recentDate);
  // Real production group: must NEVER be archived.
  const prodDir = path.join(groupsDir, 'main');
  fs.mkdirSync(prodDir, { recursive: true });
  fs.writeFileSync(path.join(prodDir, 'MEMORY.md'), '# prod\n');
  setMtimeRecursive(prodDir, oldDate);
  // Non-pattern group: must NEVER be archived.
  const otherDir = path.join(groupsDir, 'family-chat');
  fs.mkdirSync(otherDir, { recursive: true });
  fs.writeFileSync(path.join(otherDir, 'MEMORY.md'), '# family\n');
  setMtimeRecursive(otherDir, oldDate);

  try {
    const result = purgeOldTestGroups({
      groupsDir,
      archiveRoot,
      now: () => fixedNow,
      retentionDays: 90,
      enabled: true,
      protectedFolders: ['family-chat'],
    });
    assert.equal(result.skipped, false);
    assert.equal(result.matchedFolders.length, 3);
    assert.equal(result.archivedTarballs.length, 3);
    assert.equal(result.removedFolders.length, 3);
    assert.equal(result.errors.length, 0);
    assert.ok(
      result.archivedTarballs.every((p) => p.startsWith(archiveRoot)),
    );
    for (const folder of staleGroups) {
      assert.equal(fs.existsSync(path.join(groupsDir, folder)), false);
    }
    assert.equal(fs.existsSync(path.join(groupsDir, 'test-recent')), true);
    assert.equal(fs.existsSync(path.join(groupsDir, 'main')), true);
    assert.equal(fs.existsSync(path.join(groupsDir, 'family-chat')), true);

    // Sanity check: at least one tarball extractable with tar -tzf.
    const head = child_process
      .execSync(`tar -tzf ${result.archivedTarballs[0]}`, {
        encoding: 'utf-8',
      })
      .trim()
      .split('\n');
    assert.ok(head.some((line) => line.endsWith('MEMORY.md')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('purgeOldTestGroups is a no-op when maintenance is disabled', () => {
  const root = mkTempDir('fft-wm-groups-skip-');
  const groupsDir = path.join(root, 'groups');
  const archiveRoot = path.join(root, 'archive', 'purged-groups');
  fs.mkdirSync(groupsDir, { recursive: true });

  const oldDate = new Date('2026-01-15T00:00:00.000Z');
  const dir = path.join(groupsDir, 'test-stale');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'MEMORY.md'), '# stale\n');
  setMtimeRecursive(dir, oldDate);

  try {
    const result = purgeOldTestGroups({
      groupsDir,
      archiveRoot,
      retentionDays: 90,
      enabled: false,
    });
    assert.equal(result.skipped, true);
    assert.equal(result.matchedFolders.length, 0);
    assert.equal(fs.existsSync(dir), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('purgeOldTestGroups reports nothing matched when groups dir is empty', () => {
  const root = mkTempDir('fft-wm-groups-empty-');
  const groupsDir = path.join(root, 'groups');
  fs.mkdirSync(groupsDir, { recursive: true });
  try {
    const result = purgeOldTestGroups({
      groupsDir,
      archiveRoot: path.join(root, 'archive'),
      retentionDays: 90,
      enabled: true,
    });
    assert.equal(result.matchedFolders.length, 0);
    assert.equal(result.archivedTarballs.length, 0);
    assert.equal(result.removedFolders.length, 0);
    assert.equal(result.errors.length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
