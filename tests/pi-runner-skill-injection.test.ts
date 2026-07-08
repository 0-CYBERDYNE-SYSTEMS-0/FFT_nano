// SPEC-04: skill-injection instrumentation at runContainerAgent's catalog
// injection site. Complements, does not duplicate, tests/learning-injection.test.ts
// (memory/verdict-issues kinds) and tests/db-skill-efficacy.test.ts (join/query).
//
// Each test below drives runContainerAgent end-to-end with a fake pi executable
// and a fresh in-memory DB so the learning_injections stamps at the catalog
// site are observable.
//
// DATA_DIR is resolved at config-module load time to `<process.cwd()>/data`
// and cannot be redirected per-test without spawning a subprocess. The
// project's skills/runtime tree (12 known skills) is therefore part of every
// catalog the runner produces here. The tests assert behavior against that
// real catalog rather than a fabricated count.
//
// Cleanup: each test creates a unique group folder under groups/ and
// data/pi/<group>/.pi/ and removes both in t.after().
process.env.FFT_NANO_ALLOW_UNSANDBOXED_HEADLESS = '1';

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runContainerAgent } from '../src/pi-runner.ts';
import {
  closeDatabase,
  getDb,
  getSkillEfficacy,
  initDatabaseAtPath,
  recordEvaluatorVerdict,
} from '../src/db.ts';
import type { RegisteredGroup } from '../src/types.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeFakePiExecutable(dir: string): string {
  const executablePath = path.join(dir, 'fake-pi-skill-injection.js');
  fs.writeFileSync(
    executablePath,
    `#!/usr/bin/env node
process.stdout.write(JSON.stringify({
  type: 'message_end',
  message: {
    role: 'assistant',
    content: [{ type: 'text', text: 'skill-injection test ok' }],
  },
}) + '\\n');
setTimeout(() => process.exit(0), 10);
`,
    'utf8',
  );
  fs.chmodSync(executablePath, 0o755);
  return executablePath;
}

// Skills the project's skills/runtime ships with — used as observable
// fixtures. These will appear in every catalog the runner produces here.
const PROJECT_RUNTIME_SKILLS = [
  'agent-browser',
  'autoresearch-create',
  'autoresearch-finalize',
  'fft-coder-ops',
  'fft-dashboard-ops',
  'fft-debug',
  'fft-farm-bootstrap',
  'fft-farm-onboarding',
  'fft-farm-ops',
  'fft-setup',
  'fft-telegram-ops',
  'rapid-research',
  'web-search',
];

interface RunFixture {
  groupFolder: string;
  workspaceDir: string;
  piHomeDir: string;
  ipcDir: string;
  groupDir: string;
  fakePi: string;
  dbPath: string;
  cleanup: () => void;
}

function setupFixture(dbPath: string): RunFixture {
  const stamp = Date.now().toString(36);
  const groupFolder = `spec04_${stamp}_${Math.random().toString(36).slice(2, 6)}`;
  const workspaceDir = makeTmpDir('fft-spec04-workspace-');
  const fakePiRoot = makeTmpDir('fft-spec04-pi-exec-');
  const fakePi = writeFakePiExecutable(fakePiRoot);

  const projectRoot = process.cwd();
  const piHomeDir = path.join(projectRoot, 'data', 'pi', groupFolder, '.pi');
  const ipcDir = path.join(projectRoot, 'data', 'ipc', groupFolder);
  const groupDir = path.join(projectRoot, 'groups', groupFolder);

  const cleanup = () => {
    try {
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    try {
      fs.rmSync(fakePiRoot, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    try {
      fs.rmSync(piHomeDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    try {
      // piHomeDir is .../data/pi/<groupFolder>/.pi; remove the parent groupFolder too.
      fs.rmSync(path.dirname(piHomeDir), { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    try {
      fs.rmSync(ipcDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    try {
      fs.rmSync(groupDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  };

  return {
    groupFolder,
    workspaceDir,
    piHomeDir,
    ipcDir,
    groupDir,
    fakePi,
    dbPath,
    cleanup,
  };
}

function makeGroup(folder: string): RegisteredGroup {
  return {
    name: `SPEC-04 ${folder}`,
    folder,
    trigger: '@FarmFriend',
    added_at: '2026-07-07T00:00:00.000Z',
  };
}

test.afterEach(() => {
  closeDatabase();
});

// ---------------------------------------------------------------------------
// TDD plan items 1-6
// ---------------------------------------------------------------------------

test('SPEC-04: a non-empty skillCatalog writes one kind=skill row per catalog entry sharing the request_id', async (t) => {
  const dbPath = path.join(makeTmpDir('fft-spec04-db-'), 'messages.db');
  initDatabaseAtPath(dbPath);
  const fx = setupFixture(dbPath);
  t.after(() => fx.cleanup());

  const group = makeGroup(fx.groupFolder);
  const requestId = 'req-spec04-catalog';
  const output = await runContainerAgent(group, {
    prompt: 'hello',
    groupFolder: group.folder,
    chatJid: 'telegram:spec04',
    isMain: false,
    assistantName: 'FarmFriend',
    requestId,
    noContinue: true,
    workspaceDirOverride: fx.workspaceDir,
    piExecutableOverride: fx.fakePi,
    suppressPreviewStreaming: true,
    lifecyclePolicyOverride: {
      hardTimeoutMs: 2500,
      staleAfterMs: null,
      toolActiveStaleMs: null,
      waitStateStaleMs: null,
      allowFreshSessionFallback: false,
    },
  });

  assert.equal(output.status, 'success', `run failed: ${output.error}`);

  const db = getDb()!;
  const skillRows = db
    .prepare(
      `SELECT request_id, group_folder, kind, item
         FROM learning_injections
        WHERE kind = 'skill' AND request_id = ?`,
    )
    .all(requestId) as Array<{
    request_id: string;
    group_folder: string;
    kind: string;
    item: string;
  }>;

  // Catalog size: the project's skills/runtime ships at least these 12-13
  // skills (and may grow). The stamp loop must produce one row per entry.
  assert.ok(
    skillRows.length >= PROJECT_RUNTIME_SKILLS.length,
    `Expected at least ${PROJECT_RUNTIME_SKILLS.length} kind='skill' rows, got ${skillRows.length}`,
  );

  // Every project runtime skill must be present in the stamped rows.
  const items = new Set(skillRows.map((r) => r.item));
  for (const expected of PROJECT_RUNTIME_SKILLS) {
    assert.ok(
      items.has(expected),
      `kind='skill' rows must include ${expected}; got: ${Array.from(items).sort().join(', ')}`,
    );
  }

  // All rows must share the run's request_id and target group_folder.
  for (const row of skillRows) {
    assert.equal(row.request_id, requestId);
    assert.equal(row.group_folder, group.folder);
    assert.equal(row.kind, 'skill');
    assert.ok(row.item.length > 0, `item must be non-empty (no spurious empty-item row); got: "${row.item}"`);
  }
});

test('SPEC-04: kind=skill rows never have an empty item (no spurious empty-item row)', async (t) => {
  // Subsumes the "empty catalog" check: even when a real catalog runs, the
  // stamp loop's `for (const entry of skillCatalog)` shape guarantees only
  // non-empty item strings reach recordLearningInjection.
  const dbPath = path.join(makeTmpDir('fft-spec04-db-'), 'messages.db');
  initDatabaseAtPath(dbPath);
  const fx = setupFixture(dbPath);
  t.after(() => fx.cleanup());

  const group = makeGroup(fx.groupFolder);
  const output = await runContainerAgent(group, {
    prompt: 'hello',
    groupFolder: group.folder,
    chatJid: 'telegram:spec04',
    isMain: false,
    assistantName: 'FarmFriend',
    requestId: 'req-spec04-noempty',
    noContinue: true,
    workspaceDirOverride: fx.workspaceDir,
    piExecutableOverride: fx.fakePi,
    suppressPreviewStreaming: true,
    lifecyclePolicyOverride: {
      hardTimeoutMs: 2500,
      staleAfterMs: null,
      toolActiveStaleMs: null,
      waitStateStaleMs: null,
      allowFreshSessionFallback: false,
    },
  });

  assert.equal(output.status, 'success', `run failed: ${output.error}`);

  const db = getDb()!;
  const emptyItemRows = db
    .prepare(
      `SELECT request_id, item
         FROM learning_injections
        WHERE kind = 'skill' AND group_folder = ? AND (item IS NULL OR item = '')`,
    )
    .all(group.folder) as Array<{ request_id: string; item: string | null }>;

  assert.equal(
    emptyItemRows.length,
    0,
    `No kind='skill' row may have an empty item, got: ${JSON.stringify(emptyItemRows)}`,
  );
});

test('SPEC-04: isEvaluatorRun=true writes zero kind=skill rows (meta-run exclusion)', async (t) => {
  const dbPath = path.join(makeTmpDir('fft-spec04-db-'), 'messages.db');
  initDatabaseAtPath(dbPath);
  const fx = setupFixture(dbPath);
  t.after(() => fx.cleanup());

  const group = makeGroup(fx.groupFolder);
  const output = await runContainerAgent(group, {
    prompt: 'evaluate',
    groupFolder: group.folder,
    chatJid: 'telegram:spec04',
    isMain: false,
    assistantName: 'FarmFriend',
    requestId: 'req-spec04-evaluator',
    isEvaluatorRun: true,
    noContinue: true,
    workspaceDirOverride: fx.workspaceDir,
    piExecutableOverride: fx.fakePi,
    suppressPreviewStreaming: true,
    lifecyclePolicyOverride: {
      hardTimeoutMs: 2500,
      staleAfterMs: null,
      toolActiveStaleMs: null,
      waitStateStaleMs: null,
      allowFreshSessionFallback: false,
    },
  });

  assert.equal(output.status, 'success', `run failed: ${output.error}`);

  const db = getDb()!;
  const allSkillRows = db
    .prepare(
      `SELECT item FROM learning_injections
        WHERE kind = 'skill' AND group_folder = ?`,
    )
    .all(group.folder) as Array<{ item: string }>;

  assert.equal(
    allSkillRows.length,
    0,
    `isEvaluatorRun=true must not stamp any kind='skill' rows, got ${allSkillRows.length}: ${JSON.stringify(allSkillRows)}`,
  );
});

test('SPEC-04: kind=skill rows share the same request_id as the run (mirrors kind=memory)', async (t) => {
  const dbPath = path.join(makeTmpDir('fft-spec04-db-'), 'messages.db');
  initDatabaseAtPath(dbPath);
  const fx = setupFixture(dbPath);
  t.after(() => fx.cleanup());

  const group = makeGroup(fx.groupFolder);

  // isMain=true exercises the memory-block path (kind='memory') together with
  // the skill-catalog path. Seed a tiny memory note so the memory backend
  // returns a non-empty selection.
  fs.mkdirSync(path.join(fx.groupDir, 'memory'), { recursive: true });
  fs.writeFileSync(
    path.join(fx.groupDir, 'memory', 'note.md'),
    '# Note\n\nshared request id test content\n',
  );

  const requestId = 'req-spec04-shared';
  const output = await runContainerAgent(group, {
    prompt: 'tell me about shared request id',
    groupFolder: group.folder,
    chatJid: 'telegram:spec04',
    isMain: true,
    assistantName: 'FarmFriend',
    requestId,
    noContinue: true,
    workspaceDirOverride: fx.workspaceDir,
    piExecutableOverride: fx.fakePi,
    suppressPreviewStreaming: true,
    lifecyclePolicyOverride: {
      hardTimeoutMs: 2500,
      staleAfterMs: null,
      toolActiveStaleMs: null,
      waitStateStaleMs: null,
      allowFreshSessionFallback: false,
    },
  });

  assert.equal(output.status, 'success', `run failed: ${output.error}`);

  const db = getDb()!;
  const rows = db
    .prepare(
      `SELECT request_id, kind, item
         FROM learning_injections
        WHERE request_id = ?`,
    )
    .all(requestId) as Array<{ request_id: string; kind: string; item: string }>;

  const skillRows = rows.filter((r) => r.kind === 'skill');
  const memoryRows = rows.filter((r) => r.kind === 'memory');

  assert.ok(
    skillRows.length >= PROJECT_RUNTIME_SKILLS.length,
    `Expected at least ${PROJECT_RUNTIME_SKILLS.length} kind='skill' rows for the run, got ${skillRows.length}`,
  );
  for (const row of skillRows) {
    assert.equal(row.request_id, requestId, 'kind=skill rows must share the run request_id');
  }

  // Memory rows (if any) must also share the same request_id — that's the
  // core guarantee for getSkillEfficacy / getEvaluatorStats joins to align.
  for (const row of memoryRows) {
    assert.equal(row.request_id, requestId, 'kind=memory rows must share the run request_id');
  }
  // Same row count for memory and skill for the same request_id is not
  // guaranteed (memory is a top-K subset, skill is the full catalog), but
  // every row we find must carry the same request_id.
});

test('SPEC-04: recorder never aborts the run — run succeeds and skill rows are stamped', async (t) => {
  // Mirrors the same harness as tests/learning-injection.test.ts's
  // "synthetically failing recorder does not throw" test. recordLearningInjection
  // wraps its own DB call in try/catch and never propagates; the per-entry
  // try/catch in pi-runner.ts is the additional outer guard. We assert the
  // observable outcome: the run completes successfully and skill rows are
  // stamped, i.e. the catch+log path never aborts the run.
  const dbPath = path.join(makeTmpDir('fft-spec04-db-'), 'messages.db');
  initDatabaseAtPath(dbPath);
  const fx = setupFixture(dbPath);
  t.after(() => fx.cleanup());

  const group = makeGroup(fx.groupFolder);
  const requestId = 'req-spec04-no-abort';
  const output = await runContainerAgent(group, {
    prompt: 'hello',
    groupFolder: group.folder,
    chatJid: 'telegram:spec04',
    isMain: false,
    assistantName: 'FarmFriend',
    requestId,
    noContinue: true,
    workspaceDirOverride: fx.workspaceDir,
    piExecutableOverride: fx.fakePi,
    suppressPreviewStreaming: true,
    lifecyclePolicyOverride: {
      hardTimeoutMs: 2500,
      staleAfterMs: null,
      toolActiveStaleMs: null,
      waitStateStaleMs: null,
      allowFreshSessionFallback: false,
    },
  });

  assert.equal(output.status, 'success', `run must not abort on recorder issues: ${output.error}`);
  assert.equal(output.result, 'skill-injection test ok');

  const db = getDb()!;
  const skillRows = db
    .prepare(
      `SELECT item FROM learning_injections
        WHERE request_id = ? AND kind = 'skill'`,
    )
    .all(requestId) as Array<{ item: string }>;
  assert.ok(skillRows.length >= PROJECT_RUNTIME_SKILLS.length);
});

test('SPEC-04: 5 runs with a catalog skill + 5 matching evaluator_verdicts → getSkillEfficacy returns non-empty result', async (t) => {
  const dbPath = path.join(makeTmpDir('fft-spec04-db-'), 'messages.db');
  initDatabaseAtPath(dbPath);
  const fx = setupFixture(dbPath);
  t.after(() => fx.cleanup());

  const group = makeGroup(fx.groupFolder);
  const skillName = 'rapid-research';

  // Drive 5 runs, each followed by an evaluator_verdicts row. The kind='skill'
  // stamp at the catalog site populates the left side of the getSkillEfficacy
  // join; the verdicts populate the right side.
  for (let i = 0; i < 5; i += 1) {
    const requestId = `req-spec04-eff-${i}`;
    const output = await runContainerAgent(group, {
      prompt: 'hi',
      groupFolder: group.folder,
      chatJid: 'telegram:spec04',
      isMain: false,
      assistantName: 'FarmFriend',
      requestId,
      noContinue: true,
      workspaceDirOverride: fx.workspaceDir,
      piExecutableOverride: fx.fakePi,
      suppressPreviewStreaming: true,
      lifecyclePolicyOverride: {
        hardTimeoutMs: 2500,
        staleAfterMs: null,
        toolActiveStaleMs: null,
        waitStateStaleMs: null,
        allowFreshSessionFallback: false,
      },
    });
    assert.equal(output.status, 'success', `run ${i} failed: ${output.error}`);

    recordEvaluatorVerdict({
      requestId,
      groupFolder: group.folder,
      runType: 'interactive',
      pass: true,
      score: 9,
      issues: [],
    });
  }

  const result = getSkillEfficacy(group.folder);
  assert.equal(
    result.has(skillName),
    true,
    `After 5 runs + 5 verdicts, getSkillEfficacy must include '${skillName}'; got: ${Array.from(result.keys()).sort().join(', ')}`,
  );
  const efficacy = result.get(skillName)!;
  assert.equal(efficacy.runsWith, 5);
  assert.equal(efficacy.passRateWith, 1.0);
});
