import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import test from 'node:test';

import { closeDatabase, getTaskById, initDatabaseAtPath } from '../src/db.js';
import {
  ensureKnowledgeNightlyTask,
  KNOWLEDGE_NIGHTLY_TASK_ID,
} from '../src/knowledge-wiki-task.js';
import {
  captureKnowledgeRawNote,
  ensureKnowledgeWikiScaffold,
  readKnowledgeWikiStatus,
  runKnowledgeWikiLint,
} from '../src/knowledge-wiki.js';

function makeTmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('ensureKnowledgeWikiScaffold creates required directories and files', () => {
  const workspaceDir = makeTmpDir('fft-knowledge-');
  const result = ensureKnowledgeWikiScaffold({ workspaceDir });

  assert.equal(result.createdPaths.length > 0, true);
  assert.equal(
    fs.existsSync(
      path.join(workspaceDir, 'knowledge', 'schema', 'qualia-schema.md'),
    ),
    true,
  );
  assert.equal(
    fs.existsSync(path.join(workspaceDir, 'knowledge', 'wiki', 'progress.md')),
    true,
  );
  assert.equal(
    fs.existsSync(path.join(workspaceDir, 'knowledge', 'wiki', 'log.md')),
    true,
  );
});

test('captureKnowledgeRawNote stores note and updates status counters', () => {
  const workspaceDir = makeTmpDir('fft-knowledge-capture-');
  ensureKnowledgeWikiScaffold({ workspaceDir });

  const capture = captureKnowledgeRawNote({
    workspaceDir,
    text: 'Pump #2 pressure dropped from 58psi to 41psi near dusk.',
    source: 'telegram:test',
    now: new Date('2026-04-22T03:14:00.000Z'),
  });

  assert.equal(fs.existsSync(capture.absolutePath), true);
  assert.match(capture.relativePath, /^knowledge\/raw\/20260422T031400Z-/);
  const status = readKnowledgeWikiStatus({ workspaceDir });
  assert.equal(status.rawCaptureCount, 1);
  assert.equal(status.ready, true);
});

test('runKnowledgeWikiLint writes report and flags low-content warnings', () => {
  const workspaceDir = makeTmpDir('fft-knowledge-lint-');
  ensureKnowledgeWikiScaffold({ workspaceDir });

  const lint = runKnowledgeWikiLint({
    workspaceDir,
    now: new Date('2026-04-22T05:00:00.000Z'),
  });

  assert.equal(fs.existsSync(lint.reportAbsolutePath), true);
  assert.equal(lint.errors.length, 0);
  assert.equal(lint.warnings.length > 0, true);
  assert.match(lint.reportRelativePath, /^knowledge\/reports\/lint-/);
});

test('ensureKnowledgeNightlyTask provisions one stable scheduled task', () => {
  const tmpRoot = makeTmpDir('fft-knowledge-task-');
  const dbPath = path.join(tmpRoot, 'messages.db');

  try {
    initDatabaseAtPath(dbPath);

    const skipped = ensureKnowledgeNightlyTask({
      mainChatJid: null,
      now: new Date('2026-04-22T06:00:00.000Z'),
    });
    assert.equal(skipped.ensured, false);
    assert.equal(skipped.created, false);

    const created = ensureKnowledgeNightlyTask({
      mainChatJid: 'telegram:12345',
      now: new Date('2026-04-22T06:00:00.000Z'),
    });
    assert.equal(created.ensured, true);
    assert.equal(created.created, true);
    assert.equal(created.taskId, KNOWLEDGE_NIGHTLY_TASK_ID);

    const row = getTaskById(KNOWLEDGE_NIGHTLY_TASK_ID);
    assert.equal(row?.chat_jid, 'telegram:12345');
    assert.equal(row?.group_folder, 'main');
    assert.equal(row?.schedule_type, 'cron');

    const existing = ensureKnowledgeNightlyTask({
      mainChatJid: 'telegram:12345',
      now: new Date('2026-04-22T06:10:00.000Z'),
    });
    assert.equal(existing.created, false);
    assert.equal(existing.ensured, true);
  } finally {
    closeDatabase();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
