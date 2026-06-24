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
  classifyWikiPages,
  ensureKnowledgeWikiScaffold,
  listArchivedCaptures,
  readKnowledgeWikiStatus,
  reingestArchivedCapture,
  runKnowledgeWikiLint,
  SCAFFOLD_VERSION,
  upgradeKnowledgeWikiScaffold,
  writeWikiPageTriageManifest,
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
  // W1: ensureKnowledgeWikiScaffold writes the SCAFFOLD_VERSION stamp, so
  // a fresh-scaffold workspace's lint passes the version check. Zero hard
  // errors; the legacy "low-content" warnings (no raw captures, no
  // progress) still fire.
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

import { buildKnowledgeNightlyPrompt } from '../src/knowledge-wiki-task.js';

test('seeded qualia-schema.md is a knowledge-base schema, not a memory schema', () => {
  const workspaceDir = makeTmpDir('fft-knowledge-schema-');
  try {
    ensureKnowledgeWikiScaffold({ workspaceDir });
    const schemaBody = fs.readFileSync(
      path.join(workspaceDir, 'knowledge', 'schema', 'qualia-schema.md'),
      'utf-8',
    );
    // The schema must declare itself explicitly NOT a memory schema.
    assert.match(schemaBody, /NOT a memory schema/i);
    // Karpathy-faithful: pages cite sources and surface contradictions, not
    // the memory-style "Decisions / Open Questions" vocabulary.
    assert.match(schemaBody, /Required frontmatter/);
    assert.match(schemaBody, /\*\*Sources\*\*/); // a 'Sources' section
    assert.match(schemaBody, /Contradictions/);
    assert.match(schemaBody, /raw\//);
    // The schema must explicitly point readers away from the memory subsystem.
    assert.match(schemaBody, /canonical\/identity\.md/);
    assert.match(schemaBody, /memory\/YYYY-MM-DD\.md/);
    // Negative: the old memory-style section names should not appear as
    // ##-level top-level sections any more (the schema uses *bold* list
    // items now, not headings).
    assert.doesNotMatch(schemaBody, /^## Facts\b/m);
    assert.doesNotMatch(schemaBody, /^## Decisions\b/m);
    assert.doesNotMatch(schemaBody, /^## Open Questions\b/m);
  } finally {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test('seeded knowledge/README.md frames the wiki as a source library', () => {
  const workspaceDir = makeTmpDir('fft-knowledge-readme-');
  try {
    ensureKnowledgeWikiScaffold({ workspaceDir });
    const readme = fs.readFileSync(
      path.join(workspaceDir, 'knowledge', 'README.md'),
      'utf-8',
    );
    assert.match(readme, /knowledge base, not a memory system/i);
    assert.match(readme, /external sources/);
    assert.match(readme, /operator owns/);
  } finally {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test('nightly librarian prompt targets external sources and forbids memory writes', () => {
  const prompt = buildKnowledgeNightlyPrompt();
  // Must explicitly say what the wiki is for and what it is not for.
  assert.match(prompt, /knowledge-base curator/i);
  assert.match(prompt, /NOT a memory task/i);
  // Must read from the operator's source-of-truth dir.
  assert.match(prompt, /knowledge\/raw\//);
  // Must forbid mutating raw captures.
  assert.match(prompt, /Never modify anything in `knowledge\/raw\/`/);
  // Must forbid writing the agent's own working memory into the wiki.
  assert.match(prompt, /Never write the agent's own working notes/i);
  // Must require source citations on non-obvious claims.
  assert.match(prompt, /\[raw\/[^\]]+\]/);
  // Must mention contradictions surfacing (Karpathy: "noting where new data
  // contradicts old claims").
  assert.match(prompt, /contradict/i);
});

// ---- W1: scaffold version + non-destructive upgrade ------------------------

test('ensureKnowledgeWikiScaffold writes SCAFFOLD_VERSION on first scaffold', () => {
  const workspaceDir = makeTmpDir('fft-knowledge-version-');
  try {
    ensureKnowledgeWikiScaffold({ workspaceDir });
    const versionPath = path.join(
      workspaceDir,
      'knowledge',
      '.scaffold-version',
    );
    assert.equal(fs.existsSync(versionPath), true);
    assert.equal(
      fs.readFileSync(versionPath, 'utf-8').trim(),
      String(SCAFFOLD_VERSION),
    );
  } finally {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test('upgradeKnowledgeWikiScaffold is a no-op when already at SCAFFOLD_VERSION', () => {
  const workspaceDir = makeTmpDir('fft-knowledge-upgrade-noop-');
  try {
    // First pass: ensure writes the v2 stamp.
    ensureKnowledgeWikiScaffold({ workspaceDir });
    const readme = fs.readFileSync(
      path.join(workspaceDir, 'knowledge', 'README.md'),
      'utf-8',
    );
    // Second pass: upgrade should report already-current.
    const result = upgradeKnowledgeWikiScaffold({
      workspaceDir,
      now: new Date('2026-06-23T20:00:00.000Z'),
    });
    assert.equal(result.upgraded, false);
    assert.equal(result.reason, 'already-current');
    assert.equal(result.currentVersion, SCAFFOLD_VERSION);
    assert.equal(result.changed.length, 0);
    // README is unchanged.
    assert.equal(
      fs.readFileSync(
        path.join(workspaceDir, 'knowledge', 'README.md'),
        'utf-8',
      ),
      readme,
    );
  } finally {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test('upgradeKnowledgeWikiScaffold overwrites stale README, preserves page bodies, writes backups', () => {
  const workspaceDir = makeTmpDir('fft-knowledge-upgrade-real-');
  try {
    // Bootstrap the scaffold, then corrupt the README to simulate a
    // pre-v2 workspace that has drifted.
    ensureKnowledgeWikiScaffold({ workspaceDir });
    const readmePath = path.join(workspaceDir, 'knowledge', 'README.md');
    const schemaPath = path.join(
      workspaceDir,
      'knowledge',
      'schema',
      'qualia-schema.md',
    );
    const versionPath = path.join(
      workspaceDir,
      'knowledge',
      '.scaffold-version',
    );
    // Manually set the version stamp back to v0 to simulate a pre-W1
    // workspace, and write a stale README.
    fs.writeFileSync(versionPath, '0\n', 'utf-8');
    const staleReadme = [
      '# Stale Knowledge Wiki',
      '',
      'maintain high-signal operational knowledge',
    ].join('\n');
    fs.writeFileSync(readmePath, `${staleReadme}\n`, 'utf-8');
    // Add a hand-written wiki page that must NOT be touched.
    const pagePath = path.join(
      workspaceDir,
      'knowledge',
      'wiki',
      'custom-page.md',
    );
    const customBody = [
      '---',
      'type: entity',
      'sources: 1',
      'updated: 2026-06-20',
      'confidence: high',
      'tags: [test]',
      '---',
      '',
      '# Custom Page',
      '',
      'A page the operator wrote that must survive the upgrade.',
    ].join('\n');
    fs.writeFileSync(pagePath, customBody, 'utf-8');

    const result = upgradeKnowledgeWikiScaffold({
      workspaceDir,
      now: new Date('2026-06-23T20:00:00.000Z'),
    });
    assert.equal(result.upgraded, true);
    assert.equal(result.reason, 'applied');
    assert.equal(result.currentVersion, 0);
    assert.equal(result.targetVersion, SCAFFOLD_VERSION);
    assert.equal(result.changed.includes('knowledge/README.md'), true);
    // The new v2 README is in place.
    const newReadme = fs.readFileSync(readmePath, 'utf-8');
    assert.match(newReadme, /knowledge base, not a memory system/i);
    assert.match(newReadme, /operator owns/);
    // The schema is unchanged (already v2), so it is not in changed.
    assert.equal(
      result.changed.includes('knowledge/schema/qualia-schema.md'),
      false,
    );
    // Custom page body is byte-identical.
    assert.equal(fs.readFileSync(pagePath, 'utf-8'), customBody);
    // The stale README was backed up.
    assert.equal(result.backupRelativeDir !== null, true);
    const backupReadme = path.join(
      workspaceDir,
      result.backupRelativeDir!,
      'knowledge',
      'README.md',
    );
    assert.equal(fs.existsSync(backupReadme), true);
    assert.equal(fs.readFileSync(backupReadme, 'utf-8'), `${staleReadme}\n`);
    // Version stamp is updated to SCAFFOLD_VERSION.
    assert.equal(
      fs.readFileSync(versionPath, 'utf-8').trim(),
      String(SCAFFOLD_VERSION),
    );
    // Idempotent on a re-run.
    const again = upgradeKnowledgeWikiScaffold({
      workspaceDir,
      now: new Date('2026-06-23T20:05:00.000Z'),
    });
    assert.equal(again.upgraded, false);
    assert.equal(again.reason, 'already-current');
  } finally {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test('upgradeKnowledgeWikiScaffold never overwrites index/progress/log live content', () => {
  const workspaceDir = makeTmpDir('fft-knowledge-upgrade-data-');
  try {
    ensureKnowledgeWikiScaffold({ workspaceDir });
    const versionPath = path.join(
      workspaceDir,
      'knowledge',
      '.scaffold-version',
    );
    const readmePath = path.join(workspaceDir, 'knowledge', 'README.md');
    const indexPath = path.join(workspaceDir, 'knowledge', 'wiki', 'index.md');
    const progressPath = path.join(
      workspaceDir,
      'knowledge',
      'wiki',
      'progress.md',
    );
    const logPath = path.join(workspaceDir, 'knowledge', 'wiki', 'log.md');

    // Simulate a pre-v2 workspace with curated/appended live content.
    fs.writeFileSync(versionPath, '0\n', 'utf-8');
    fs.writeFileSync(readmePath, '# Stale\n\nold wording\n', 'utf-8');
    const curatedIndex = '# Wiki Index\n\n## Pages\n- [Foo](./foo.md)\n';
    const curatedProgress = '# Progress Tracker\n\n- 2026-06-01 did things\n';
    const appendedLog =
      '# Maintenance Log (Append Only)\n\n- real history line\n';
    fs.writeFileSync(indexPath, curatedIndex, 'utf-8');
    fs.writeFileSync(progressPath, curatedProgress, 'utf-8');
    fs.writeFileSync(logPath, appendedLog, 'utf-8');

    const result = upgradeKnowledgeWikiScaffold({
      workspaceDir,
      now: new Date('2026-06-23T21:00:00.000Z'),
    });
    assert.equal(result.upgraded, true);
    // README (static doctrine) WAS overlaid.
    assert.equal(result.changed.includes('knowledge/README.md'), true);
    // Live data files were NOT in the change set.
    assert.equal(result.changed.includes('knowledge/wiki/index.md'), false);
    assert.equal(result.changed.includes('knowledge/wiki/progress.md'), false);
    assert.equal(result.changed.includes('knowledge/wiki/log.md'), false);
    // And their content is byte-identical (the upgrade appends one [upgrade]
    // line to log.md via appendKnowledgeWikiLog, so log.md is allowed to grow
    // by that single appended line but must still contain the prior history).
    assert.equal(fs.readFileSync(indexPath, 'utf-8'), curatedIndex);
    assert.equal(fs.readFileSync(progressPath, 'utf-8'), curatedProgress);
    assert.match(fs.readFileSync(logPath, 'utf-8'), /real history line/);
  } finally {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  }
});

// ---- W2: page triage routing ------------------------------------------------

test('classifyWikiPages buckets legacy pages; never moves files', () => {
  const workspaceDir = makeTmpDir('fft-knowledge-triage-');
  try {
    ensureKnowledgeWikiScaffold({ workspaceDir });
    // Plant three representative pages in a workspace with NO raw captures.
    const wikiDir = path.join(workspaceDir, 'knowledge', 'wiki');
    fs.writeFileSync(
      path.join(wikiDir, 'source-derived-page.md'),
      [
        '---',
        'type: entity',
        'sources: 1',
        'updated: 2026-06-20',
        'confidence: high',
        'tags: [test]',
        '---',
        '',
        '# Source Derived',
        '',
        '## Sources',
        '',
        'Cited from [raw/2026-06-20_test.md].',
      ].join('\n'),
      'utf-8',
    );
    fs.writeFileSync(
      path.join(wikiDir, 'memory-shaped-page.md'),
      [
        '# Memory Shaped',
        '',
        '## Facts',
        '- One fact',
        '',
        '## Decisions',
        '- A decision',
        '',
        '## Open Questions',
        '- A question',
      ].join('\n'),
      'utf-8',
    );
    fs.writeFileSync(
      path.join(wikiDir, 'pre-v2-source-page.md'),
      [
        '# Pre-v2 Source Page',
        '',
        '## Facts',
        '- fact one',
        '',
        '## Decisions',
        '- decision one',
        '',
        '## Sources',
        '',
        'https://example.com — 2026-06-01',
      ].join('\n'),
      'utf-8',
    );

    const entries = classifyWikiPages({ workspaceDir });
    const byName: Record<string, ReturnType<typeof classifyWikiPages>[number]> =
      {};
    for (const e of entries) byName[e.fileName] = e;
    assert.equal(
      byName['source-derived-page.md'].classification,
      'source-derived',
    );
    assert.equal(
      byName['source-derived-page.md'].proposedAction,
      'keep-and-flag-for-librarian-reformat',
    );
    assert.equal(
      byName['memory-shaped-page.md'].classification,
      'memory-shaped',
    );
    assert.equal(
      byName['memory-shaped-page.md'].proposedDestination !== null,
      true,
    );
    // The pre-v2 source-shaped page (no [raw/...] citations, has Decisions,
    // has Sources URL) is correctly classified as ambiguous.
    assert.equal(byName['pre-v2-source-page.md'].classification, 'ambiguous');

    // writeWikiPageTriageManifest writes a manifest and never moves files.
    const manifest = writeWikiPageTriageManifest({
      workspaceDir,
      now: new Date('2026-06-23T20:00:00.000Z'),
    });
    assert.equal(fs.existsSync(manifest.manifestAbsolutePath), true);
    assert.equal(manifest.entries.length, entries.length);
    // Files are still in the original location.
    assert.equal(
      fs.existsSync(path.join(wikiDir, 'memory-shaped-page.md')),
      true,
    );
    assert.equal(
      fs.existsSync(path.join(wikiDir, 'source-derived-page.md')),
      true,
    );
  } finally {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  }
});

// ---- W3: raw intake reconnection -------------------------------------------

test('reingestArchivedCapture promotes an archived capture to active raw/', () => {
  const workspaceDir = makeTmpDir('fft-knowledge-reingest-');
  try {
    ensureKnowledgeWikiScaffold({ workspaceDir });
    const rawDir = path.join(workspaceDir, 'knowledge', 'raw');
    const archivedDir = path.join(rawDir, '_archived');
    fs.mkdirSync(archivedDir, { recursive: true });
    const archivedPath = path.join(archivedDir, '2026-06-20_test-capture.md');
    fs.writeFileSync(
      archivedPath,
      '# Raw Capture\n\n- source: manual\n\n## Note\n\nTest body.\n',
      'utf-8',
    );

    // Sanity: live raw/ starts empty.
    const before = readKnowledgeWikiStatus({ workspaceDir });
    assert.equal(before.rawCaptureCount, 0);

    // listArchivedCaptures returns the file.
    const list = listArchivedCaptures({ workspaceDir });
    assert.equal(list.includes('2026-06-20_test-capture.md'), true);

    // Reingest moves it to active raw/.
    const result = reingestArchivedCapture({
      workspaceDir,
      archivedFileName: '2026-06-20_test-capture.md',
      now: new Date('2026-06-23T20:00:00.000Z'),
    });
    assert.equal(result.status, 'moved');
    assert.equal(
      fs.existsSync(path.join(rawDir, '2026-06-20_test-capture.md')),
      true,
    );
    const after = readKnowledgeWikiStatus({ workspaceDir });
    assert.equal(after.rawCaptureCount, 1);
    // The reingest file carries a re-ingested provenance marker.
    const body = fs.readFileSync(
      path.join(rawDir, '2026-06-20_test-capture.md'),
      'utf-8',
    );
    assert.match(body, /re-ingested.*promoted from _archived/);

    // Not-found path returns a clean error.
    const notFound = reingestArchivedCapture({
      workspaceDir,
      archivedFileName: 'does-not-exist.md',
    });
    assert.equal(notFound.status, 'not-found');
  } finally {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test('buildKnowledgeNightlyPrompt now references knowledge/raw/_archived/', () => {
  const prompt = buildKnowledgeNightlyPrompt();
  assert.match(prompt, /knowledge\/raw\/_archived\//);
  // Old requirement (read live raw/) must still be present.
  assert.match(prompt, /knowledge\/raw\//);
});

// ---- W4: hardened lint -----------------------------------------------------

test('runKnowledgeWikiLint flags pages missing v2 frontmatter and citations', () => {
  const workspaceDir = makeTmpDir('fft-knowledge-lint-conformance-');
  try {
    ensureKnowledgeWikiScaffold({ workspaceDir });
    const wikiDir = path.join(workspaceDir, 'knowledge', 'wiki');
    // Pre-v2 page: legacy schema, no frontmatter, no [raw/...] citations,
    // has ## Decisions.
    fs.writeFileSync(
      path.join(wikiDir, 'legacy-page.md'),
      [
        '# Legacy Page',
        '',
        '## Facts',
        '- fact',
        '',
        '## Decisions',
        '- decision',
      ].join('\n'),
      'utf-8',
    );
    // v2-conformant page: has frontmatter + ## Sources + [raw/...] citation.
    const rawDir = path.join(workspaceDir, 'knowledge', 'raw');
    fs.mkdirSync(rawDir, { recursive: true });
    fs.writeFileSync(
      path.join(rawDir, '2026-06-20_test.md'),
      '# Raw Capture\n\n## Note\n\nbody\n',
      'utf-8',
    );
    fs.writeFileSync(
      path.join(wikiDir, 'v2-conformant-page.md'),
      [
        '---',
        'type: entity',
        'sources: 1',
        'updated: 2026-06-20',
        'confidence: high',
        'tags: [test]',
        '---',
        '',
        '# V2 Conformant',
        '',
        '## Summary',
        'Conforms to v2.',
        '',
        '## Sources',
        '',
        'Cited from [raw/2026-06-20_test.md].',
      ].join('\n'),
      'utf-8',
    );

    const lint = runKnowledgeWikiLint({
      workspaceDir,
      now: new Date('2026-06-23T20:00:00.000Z'),
    });
    // The pre-v2 page produces a per-page warning naming each issue.
    const warnings = lint.warnings.join('\n');
    assert.match(warnings, /Page \`legacy-page.md\` is not v2-conformant/);
    assert.match(
      warnings,
      /missing frontmatter: type, sources, updated, confidence, tags/,
    );
    assert.match(warnings, /no \[raw\/...\] citations/);
    assert.match(warnings, /memory-style headings: Decisions/);
    // The v2-conformant page does NOT appear in the warning list.
    assert.equal(
      /Page \`v2-conformant-page.md\` is not v2-conformant/.test(warnings),
      false,
    );
    // ensureKnowledgeWikiScaffold writes the SCAFFOLD_VERSION stamp, so a
    // freshly-scaffolded workspace has zero hard errors. The per-page
    // warnings carry the conformance signal.
    assert.equal(lint.errors.length, 0);
  } finally {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  }
});
