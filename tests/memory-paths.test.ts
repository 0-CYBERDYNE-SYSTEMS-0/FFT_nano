import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

import { MAIN_GROUP_FOLDER, MAIN_WORKSPACE_DIR } from '../src/config.js';
import {
  ensureMemoryScaffold,
  isAllowedMemoryRelativePath,
  resolveAllowedMemoryFilePath,
  resolveGroupWorkspaceDir,
  resolveMemoryDir,
  resolveMemoryPath,
  resolveSoulPath,
} from '../src/memory-paths.js';

test('resolves main workspace and non-main group paths', () => {
  assert.equal(resolveGroupWorkspaceDir(MAIN_GROUP_FOLDER), MAIN_WORKSPACE_DIR);
  assert.equal(
    resolveMemoryPath('demo-group'),
    path.join(process.cwd(), 'groups', 'demo-group', 'MEMORY.md'),
  );
  assert.equal(
    resolveMemoryDir('demo-group'),
    path.join(process.cwd(), 'groups', 'demo-group', 'memory'),
  );
  assert.equal(
    resolveSoulPath('demo-group'),
    path.join(process.cwd(), 'groups', 'demo-group', 'SOUL.md'),
  );
});

test('ensures memory scaffold files and folder exist', () => {
  const folder = `test-memory-paths-${Date.now()}`;
  const workspaceDir = path.join(process.cwd(), 'groups', folder);
  try {
    const out = ensureMemoryScaffold(folder);
    assert.equal(fs.existsSync(out.memoryPath), true);
    assert.equal(fs.existsSync(out.memoryDir), true);
  } finally {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test('allowed memory path validation blocks traversal', () => {
  assert.equal(isAllowedMemoryRelativePath('MEMORY.md'), true);
  assert.equal(isAllowedMemoryRelativePath('memory/2026-02-15.md'), true);
  assert.equal(isAllowedMemoryRelativePath('SOUL.md'), false);
  assert.equal(isAllowedMemoryRelativePath('CLAUDE.md'), false);
  assert.equal(isAllowedMemoryRelativePath('../secret.md'), false);
  assert.equal(isAllowedMemoryRelativePath('notes.md'), false);
});

test('resolveAllowedMemoryFilePath resolves inside workspace only', () => {
  const p = resolveAllowedMemoryFilePath(MAIN_GROUP_FOLDER, 'MEMORY.md');
  assert.equal(p, path.join(MAIN_WORKSPACE_DIR, 'MEMORY.md'));
  assert.throws(
    () => resolveAllowedMemoryFilePath(MAIN_GROUP_FOLDER, '../outside.md'),
    /not an allowed memory file/i,
  );
});
