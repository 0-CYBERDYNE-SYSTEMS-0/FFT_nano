import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

import { MAIN_GROUP_FOLDER, MAIN_WORKSPACE_DIR } from '../src/config.js';
import {
  ensureDailyMemoryJournal,
  ensureMemoryScaffold,
  isAllowedMemoryRelativePath,
  resolveAllowedMemoryFilePath,
  resolveCanonicalDir,
  resolveGroupWorkspaceDir,
  resolveMemoryDir,
  resolveMemoryPath,
  resolveSoulPath,
} from '../src/memory-paths.js';
import { getEffectiveTimezone, getLocalDateKey } from '../src/time-context.js';

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
    resolveCanonicalDir('demo-group'),
    path.join(process.cwd(), 'groups', 'demo-group', 'canonical'),
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
    assert.equal(fs.existsSync(out.nanoPath), true);
    assert.equal(fs.existsSync(out.soulPath), true);
    assert.equal(fs.existsSync(out.todosPath), true);
    assert.equal(fs.existsSync(out.memoryPath), true);
    assert.equal(fs.existsSync(out.memoryDir), true);
    assert.equal(fs.existsSync(out.canonicalDir), true);
    assert.equal(fs.existsSync(path.join(out.canonicalDir, '_hot.md')), true);
  } finally {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test('allowed memory path validation blocks traversal', () => {
  assert.equal(isAllowedMemoryRelativePath('MEMORY.md'), true);
  assert.equal(isAllowedMemoryRelativePath('memory/2026-02-15.md'), true);
  assert.equal(isAllowedMemoryRelativePath('canonical/_hot.md'), true);
  assert.equal(isAllowedMemoryRelativePath('SOUL.md'), true);
  assert.equal(isAllowedMemoryRelativePath('NANO.md'), true);
  assert.equal(isAllowedMemoryRelativePath('TODOS.md'), true);
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


test('ensureDailyMemoryJournal creates today\'s memory/YYYY-MM-DD.md with section template', () => {
  const folder = `test-daily-journal-${Date.now()}`;
  const workspaceDir = path.join(process.cwd(), 'groups', folder);
  try {
    const out = ensureDailyMemoryJournal(folder, {
      now: () => new Date('2026-06-23T15:00:00.000Z'),
    });
    assert.equal(out.created, true);
    const expectedKey = getLocalDateKey(
      new Date('2026-06-23T15:00:00.000Z'),
      getEffectiveTimezone(),
    );
    assert.equal(out.relPath, `memory/${expectedKey}.md`);
    const body = fs.readFileSync(out.absolutePath, 'utf-8');
    assert.match(body, new RegExp(`# ${expectedKey}`));
    assert.match(body, /## Session Notes/);
    assert.match(body, /## Decisions/);
    assert.match(body, /## Open Questions/);
  } finally {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test('ensureDailyMemoryJournal is idempotent: re-running does not overwrite', () => {
  const folder = `test-daily-journal-idem-${Date.now()}`;
  const workspaceDir = path.join(process.cwd(), 'groups', folder);
  try {
    const first = ensureDailyMemoryJournal(folder, {
      now: () => new Date('2026-06-23T15:00:00.000Z'),
    });
    fs.appendFileSync(first.absolutePath, '\n## Operator-added\n- keep this\n');
    const second = ensureDailyMemoryJournal(folder, {
      now: () => new Date('2026-06-23T16:00:00.000Z'),
    });
    assert.equal(second.created, false);
    const body = fs.readFileSync(second.absolutePath, 'utf-8');
    assert.match(body, /## Operator-added/);
  } finally {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test('ensureMemoryScaffold creates today\'s daily journal in addition to MEMORY.md', () => {
  const folder = `test-scaffold-journal-${Date.now()}`;
  const workspaceDir = path.join(process.cwd(), 'groups', folder);
  try {
    const out = ensureMemoryScaffold(folder);
    const memoryDir = out.memoryDir;
    const entries = fs.readdirSync(memoryDir).filter((n) => n.endsWith('.md'));
    assert.ok(entries.length >= 1, 'expected at least one daily journal file');
    const todayFile = entries.find((n) => /^\d{4}-\d{2}-\d{2}\.md$/.test(n));
    assert.ok(todayFile, `expected YYYY-MM-DD.md in ${memoryDir}, got ${entries.join(',')}`);
    const body = fs.readFileSync(path.join(memoryDir, todayFile), 'utf-8');
    assert.match(body, /## Session Notes/);
    const memoryBody = fs.readFileSync(out.memoryPath, 'utf-8');
    assert.match(memoryBody, /Layer split/);
  } finally {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  }
});
