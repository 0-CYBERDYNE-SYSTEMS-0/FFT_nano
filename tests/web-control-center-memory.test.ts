// Env vars MUST be set before importing the modules under test so that
// config.js / app-config.js resolve GROUPS_DIR and MAIN_WORKSPACE_DIR
// from the temp directory used by this test.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-web-mem-'));
const TMP_GROUPS = path.join(TMP_ROOT, 'groups');
const TMP_WORKSPACE = path.join(TMP_ROOT, 'workspace');
fs.mkdirSync(TMP_GROUPS, { recursive: true });
fs.mkdirSync(TMP_WORKSPACE, { recursive: true });

process.env.FFT_NANO_GROUPS_DIR = TMP_GROUPS;
process.env.FFT_NANO_MAIN_WORKSPACE_DIR = TMP_WORKSPACE;

// dynamic imports must come after env setup
const { initDatabaseAtPath, closeDatabase } = await import('../src/db.js');
const {
  listControlCenterKnowledgeFiles,
  listControlCenterMemoryFiles,
  listControlCenterMemoryGroups,
  readControlCenterKnowledgeFile,
  readControlCenterMemoryFile,
  readControlCenterSkillFile,
  rollbackControlCenterMemoryFile,
  writeControlCenterKnowledgeFile,
  writeControlCenterMemoryFile,
  writeControlCenterSkillFile,
} = await import('../src/web-control-center.ts');

const { test, after } = await import('node:test');

const DB_PATH = path.join(TMP_ROOT, 'messages.db');
initDatabaseAtPath(DB_PATH);

after(() => {
  closeDatabase();
  try {
    fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

test('listControlCenterMemoryGroups always includes the main group', () => {
  const { groups } = listControlCenterMemoryGroups() as {
    groups: Array<{ folder: string; isMain: boolean; isGlobal: boolean }>;
  };
  const main = groups.find((g) => g.isMain);
  assert.ok(main, 'main group should be present');
  assert.equal(typeof main?.workspaceDir, 'string');
  for (const g of groups) {
    assert.equal(typeof g.folder, 'string');
    assert.equal(typeof g.isMain, 'boolean');
  }
});

test('memory file read/write/rollback round-trip in the main workspace', () => {
  const initial = writeControlCenterMemoryFile({
    group: 'main',
    path: 'MEMORY.md',
    content: 'first version\n',
  });
  assert.ok(initial.size > 0);

  const second = writeControlCenterMemoryFile({
    group: 'main',
    path: 'MEMORY.md',
    content: 'second version with more text\n',
  });
  assert.ok(second.size > initial.size);

  const readBack = readControlCenterMemoryFile({
    group: 'main',
    path: 'MEMORY.md',
  });
  assert.equal(readBack.content, 'second version with more text\n');

  const fileList = listControlCenterMemoryFiles({ group: 'main' }) as {
    files: Array<{ path: string; kind: string; exists: boolean }>;
  };
  const memoryFile = fileList.files.find((f) => f.path === 'MEMORY.md');
  assert.ok(memoryFile);
  assert.equal(memoryFile?.kind, 'doc');
  assert.equal(memoryFile?.exists, true);

  const rolled = rollbackControlCenterMemoryFile({
    group: 'main',
    path: 'MEMORY.md',
  });
  assert.ok(rolled.version);

  const afterRollback = readControlCenterMemoryFile({
    group: 'main',
    path: 'MEMORY.md',
  });
  assert.equal(afterRollback.content, 'first version\n');
});

test('memory read rejects paths outside the allowlist', () => {
  assert.throws(
    () => readControlCenterMemoryFile({ group: 'main', path: '../etc/passwd' }),
    /not an allowed memory file/,
  );
});

test('memory file list scans canonical and memory subdirectories', () => {
  // Use the main workspace for this test so we don't need to override GROUPS_DIR.
  writeControlCenterMemoryFile({
    group: 'main',
    path: 'canonical/test-hot.md',
    content: '# hot\n',
  });
  writeControlCenterMemoryFile({
    group: 'main',
    path: 'memory/test-notes.md',
    content: '# notes\n',
  });
  const fileList = listControlCenterMemoryFiles({ group: 'main' }) as {
    files: Array<{ path: string; kind: string; exists: boolean }>;
  };
  const hot = fileList.files.find((f) => f.path === 'canonical/test-hot.md');
  const notes = fileList.files.find((f) => f.path === 'memory/test-notes.md');
  assert.ok(hot, 'canonical file should be listed');
  assert.ok(notes, 'memory file should be listed');
  assert.equal(hot?.kind, 'canonical');
  assert.equal(notes?.kind, 'memory');
});

test('knowledge wiki file read/write round-trip', () => {
  // Trigger scaffold by listing files first.
  const before = listControlCenterKnowledgeFiles() as {
    files: Array<{ path: string; kind: string }>;
  };
  const indexFile = before.files.find((f) => f.path === 'wiki/index.md');
  assert.ok(indexFile, 'wiki/index.md should be scaffolded');

  const written = writeControlCenterKnowledgeFile({
    path: 'wiki/index.md',
    content: '# Updated Wiki Index\n- new entry\n',
    mode: 'replace',
  });
  assert.ok(written.size > 0);

  const readBack = readControlCenterKnowledgeFile({ path: 'wiki/index.md' });
  assert.match(readBack.content, /Updated Wiki Index/);

  // Append should keep the prior content.
  const appended = writeControlCenterKnowledgeFile({
    path: 'wiki/index.md',
    content: '\n- appended line\n',
    mode: 'append',
  });
  const afterAppend = readControlCenterKnowledgeFile({ path: 'wiki/index.md' });
  assert.match(afterAppend.content, /appended line/);
  assert.match(afterAppend.content, /Updated Wiki Index/);
  assert.ok(appended.size > written.size);
});

test('knowledge file write rejects paths outside the wiki', () => {
  assert.throws(
    () =>
      writeControlCenterKnowledgeFile({
        path: '../escape.md',
        content: 'nope',
        mode: 'replace',
      }),
    /not an allowed knowledge file/,
  );
});

test('skill file read/write round-trip allows nested SKILL.md paths', () => {
  // Regression: prior regex only allowed one path segment, so
  // runtime/<name>/SKILL.md failed to load even though the catalog
  // returns exactly that structure.
  const skillRoot = path.join(TMP_ROOT, 'skills');
  const skillDir = path.join(skillRoot, 'runtime', 'nested-skill');
  fs.mkdirSync(skillDir, { recursive: true });
  const skillFile = path.join(skillDir, 'SKILL.md');
  fs.writeFileSync(
    skillFile,
    '---\nname: nested-skill\ndescription: test\n---\n# nested\n',
    'utf-8',
  );

  const roots = [
    { id: 'skills-project', path: skillRoot, label: 'Project Skills' },
  ];
  const read = readControlCenterSkillFile(
    { root: 'skills-project', path: 'runtime/nested-skill/SKILL.md' },
    roots,
  );
  assert.equal(read.exists, true);
  assert.match(read.content, /name: nested-skill/);

  const written = writeControlCenterSkillFile(
    {
      root: 'skills-project',
      path: 'runtime/nested-skill/SKILL.md',
      content: '# updated nested\n',
    },
    roots,
  );
  assert.ok(written.size > 0);
  assert.equal(
    fs.readFileSync(skillFile, 'utf-8'),
    '# updated nested\n',
  );
});

test('skill file read rejects paths that are not SKILL.md', () => {
  const skillRoot = path.join(TMP_ROOT, 'skills');
  fs.mkdirSync(path.join(skillRoot, 'runtime', 'nested-skill'), {
    recursive: true,
  });
  const roots = [
    { id: 'skills-project', path: skillRoot, label: 'Project Skills' },
  ];
  assert.throws(
    () =>
      readControlCenterSkillFile(
        { root: 'skills-project', path: 'runtime/nested-skill/README.md' },
        roots,
      ),
    /Only SKILL\.md files under a skill directory are editable/,
  );
});
