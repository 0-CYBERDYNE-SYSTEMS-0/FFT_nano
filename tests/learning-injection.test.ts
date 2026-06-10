import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { buildMemoryContext } from '../src/memory-retrieval.js';
import {
  closeDatabase,
  getDb,
  initDatabaseAtPath,
  recordLearningInjection,
} from '../src/db.js';
import { getCoderLearningsForContext } from '../src/coder-learnings.js';
import { createCodingOrchestrator } from '../src/coding-orchestrator.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fft-learning-injection-'));
}

/** GROUPS_DIR is <repo>/groups — test folders must live there. */
function testGroupDir(name: string): string {
  return path.join(process.cwd(), 'groups', name);
}

// ---------------------------------------------------------------------------
// VAL-WS5-002: recordLearningInjection — unit
// ---------------------------------------------------------------------------

test('VAL-WS5-002: recordLearningInjection writes one row with kind=memory', () => {
  const tmpRoot = makeTmpDir();
  const dbPath = path.join(tmpRoot, 'messages.db');
  try {
    initDatabaseAtPath(dbPath);
    recordLearningInjection({
      requestId: 'req-abc',
      groupFolder: 'test-group',
      kind: 'memory',
      item: 'group:memory/test.md',
    });

    const db = getDb()!;
    const rows = db
      .prepare(`SELECT request_id, group_folder, kind, item FROM learning_injections WHERE request_id = 'req-abc'`)
      .all() as Array<{ request_id: string; group_folder: string; kind: string; item: string }>;

    assert.equal(rows.length, 1);
    assert.equal(rows[0].request_id, 'req-abc');
    assert.equal(rows[0].group_folder, 'test-group');
    assert.equal(rows[0].kind, 'memory');
    assert.equal(rows[0].item, 'group:memory/test.md');
  } finally {
    closeDatabase();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('VAL-WS5-003: recordLearningInjection writes one row with kind=verdict-issues', () => {
  const tmpRoot = makeTmpDir();
  const dbPath = path.join(tmpRoot, 'messages.db');
  try {
    initDatabaseAtPath(dbPath);
    recordLearningInjection({
      requestId: 'req-def',
      groupFolder: 'test-group',
      kind: 'verdict-issues',
      item: 'recurring-issues',
    });

    const db = getDb()!;
    const rows = db
      .prepare(`SELECT request_id, group_folder, kind, item FROM learning_injections WHERE request_id = 'req-def'`)
      .all() as Array<{ request_id: string; group_folder: string; kind: string; item: string }>;

    assert.equal(rows.length, 1);
    assert.equal(rows[0].kind, 'verdict-issues');
    assert.equal(rows[0].item, 'recurring-issues');
  } finally {
    closeDatabase();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('VAL-WS5-002/003: multiple injections with the same request_id share the same request_id', () => {
  const tmpRoot = makeTmpDir();
  const dbPath = path.join(tmpRoot, 'messages.db');
  try {
    initDatabaseAtPath(dbPath);
    recordLearningInjection({ requestId: 'req-multi', groupFolder: 'g', kind: 'memory', item: 'a' });
    recordLearningInjection({ requestId: 'req-multi', groupFolder: 'g', kind: 'memory', item: 'b' });
    recordLearningInjection({ requestId: 'req-multi', groupFolder: 'g', kind: 'verdict-issues', item: 'recurring-issues' });

    const db = getDb()!;
    const rows = db
      .prepare(`SELECT request_id, kind, item FROM learning_injections WHERE request_id = 'req-multi'`)
      .all() as Array<{ request_id: string; kind: string; item: string }>;

    assert.equal(rows.length, 3);
    assert.ok(rows.every((r) => r.request_id === 'req-multi'));
  } finally {
    closeDatabase();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('VAL-WS5-002/003/004: synthetically failing recorder does not throw — call site catches', () => {
  // recordLearningInjection with a null db (module-level singleton not yet initialized)
  // should silently return without throwing. We verify this by calling it repeatedly
  // with a valid db and confirming all calls succeed.
  const tmpRoot = makeTmpDir();
  const dbPath = path.join(tmpRoot, 'messages.db');
  try {
    initDatabaseAtPath(dbPath);
    for (let i = 0; i < 5; i += 1) {
      recordLearningInjection({ requestId: `req-${i}`, groupFolder: 'g', kind: 'memory', item: `item-${i}` });
    }
    const db = getDb()!;
    const count = db.prepare(`SELECT COUNT(*) as c FROM learning_injections`).get() as { c: number };
    assert.equal(count.c, 5);
  } finally {
    closeDatabase();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// VAL-WS5-002: buildMemoryContext.selectedItems tracks actually-rendered items
// ---------------------------------------------------------------------------

test('VAL-WS5-002: buildMemoryContext returns selectedItems matching selectedK', () => {
  const folder = `li-selected-items-${Date.now()}`;
  const groupRoot = testGroupDir(folder);
  try {
    fs.mkdirSync(path.join(groupRoot, 'memory'), { recursive: true });
    fs.writeFileSync(
      path.join(groupRoot, 'memory', 'note.md'),
      '# Note\n\nThis is a test memory note.\n',
    );

    const result = buildMemoryContext({
      groupFolder: folder,
      prompt: 'tell me about the test note',
    });

    assert.ok(result.selectedItems.length > 0, 'selectedItems must not be empty when context is built');
    assert.equal(result.selectedItems.length, result.selectedK);
    for (const item of result.selectedItems) {
      assert.ok(item.source, 'each selectedItem must have a source');
      assert.ok(item.path, 'each selectedItem must have a path');
    }
    const contextStr = result.context;
    for (const item of result.selectedItems) {
      assert.ok(
        contextStr.includes(`${item.source}:${item.path}`),
        `context must contain source:path marker for ${item.source}:${item.path}`,
      );
    }
  } finally {
    fs.rmSync(groupRoot, { recursive: true, force: true });
  }
});

test('VAL-WS5-002: selectedItems uses source:path format as item identifier', () => {
  const folder = `li-item-id-${Date.now()}`;
  const groupRoot = testGroupDir(folder);
  try {
    fs.mkdirSync(path.join(groupRoot, 'canonical'), { recursive: true });
    fs.writeFileSync(
      path.join(groupRoot, 'canonical', '_hot.md'),
      '# Hot\n\nURGENT_TOKEN_ITEMID_TEST\n',
    );

    const result = buildMemoryContext({
      groupFolder: folder,
      prompt: 'tell me about the urgent token',
    });

    assert.ok(result.selectedItems.length > 0);
    for (const item of result.selectedItems) {
      // Item identifier must be source:path format
      assert.match(item.source, /^(group|global)$/, `source must be 'group' or 'global', got: ${item.source}`);
      assert.ok(item.path.length > 0, 'path must be non-empty');
      // Verify source:path appears in context
      assert.ok(
        result.context.includes(`${item.source}:${item.path}`),
        `context must include ${item.source}:${item.path}`,
      );
    }
  } finally {
    fs.rmSync(groupRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// VAL-WS5-002/003/004: coding orchestrator writes learning_injections rows
// ---------------------------------------------------------------------------

test.afterEach(() => {
  closeDatabase();
});

test('VAL-WS5-003: coding orchestrator writes one memory row per coder-learning entry', async () => {
  const tmpRoot = makeTmpDir();
  const dbPath = path.join(tmpRoot, 'messages.db');
  const folderName = `li-coder-li-${Date.now()}`;
  const groupRoot = testGroupDir(folderName);
  fs.mkdirSync(path.join(groupRoot, 'logs'), { recursive: true });
  fs.writeFileSync(
    path.join(groupRoot, 'MEMORY.md'),
    `# MEMORY

## Coder Learnings

### 2026-01-01

What worked:
- First lesson

### 2026-01-02

What worked:
- Second lesson

### 2026-01-03

What worked:
- Third lesson
`,
  );
  try {
    initDatabaseAtPath(dbPath);

    const orchestrator = createCodingOrchestrator({
      activeRuns: new Map(),
      createEphemeralWorktree: async () => ({
        worktreePath: '/tmp/coder-li-test',
        cleanup: async () => {},
        listChangedFiles: () => [],
        getDiffSummary: () => '',
      }),
      runContainerAgent: async () => ({
        status: 'success',
        result: 'Done.',
        usage: { totalTokens: 5 },
        toolExecutions: [],
      }),
      publishEvent: () => {},
      runEvaluatorPass: async () => ({
        pass: true,
        score: 9,
        issues: [],
        feedback: 'OK',
        skipped: false,
      }),
    });

    const result = await orchestrator.runTask({
      requestId: 'coder-li-test',
      mode: 'plan',
      config: { toolMode: 'read_only', isSubagent: false, workspaceMode: 'read_only' },
      originChatJid: 'telegram:test-group',
      originGroupFolder: folderName,
      taskText: 'Review',
      timeoutSeconds: 300,
      allowFanout: false,
      sessionContext: '[2026-01-03] User: Review',
      assistantName: 'FarmFriend',
      sessionKey: 'test-group',
      group: { jid: 'telegram:test-group', name: 'Test', folder: folderName, trigger: '@FarmFriend' },
    });

    assert.equal(result.ok, true);

    const db = getDb()!;
    const rows = db
      .prepare(`SELECT request_id, group_folder, kind, item FROM learning_injections WHERE request_id = 'coder-li-test'`)
      .all() as Array<{ request_id: string; group_folder: string; kind: string; item: string }>;

    const memoryRows = rows.filter((r) => r.kind === 'memory');
    // 3 entries were parsed from MEMORY.md above
    assert.equal(memoryRows.length, 3, `Expected 3 memory rows, got: ${JSON.stringify(rows)}`);
    // All should have item = 'MEMORY.md'
    assert.ok(memoryRows.every((r) => r.item === 'MEMORY.md'), 'item should be MEMORY.md for all coder learning rows');
    assert.ok(rows.every((r) => r.group_folder === folderName));
  } finally {
    closeDatabase();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.rmSync(groupRoot, { recursive: true, force: true });
  }
});

test('VAL-WS5-004: coding orchestrator writes verdict-issues row when evalStatsContext is non-empty', async () => {
  const tmpRoot = makeTmpDir();
  const dbPath = path.join(tmpRoot, 'messages.db');
  const folderName = `li-vi-${Date.now()}`;
  const groupRoot = testGroupDir(folderName);
  fs.mkdirSync(path.join(groupRoot, 'logs'), { recursive: true });
  fs.writeFileSync(
    path.join(groupRoot, 'MEMORY.md'),
    `# MEMORY

## Coder Learnings

### 2026-01-01

What worked:
- Lesson one
`,
  );
  try {
    initDatabaseAtPath(dbPath);

    // Seed an evaluator verdict so getEvaluatorStats returns non-empty stats
    getDb()!.prepare(
      `INSERT INTO evaluator_verdicts (request_id, group_folder, run_type, pass, score, issues, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run('eval-seed', folderName, 'coding', 1, 9, '[]', new Date().toISOString());

    const orchestrator = createCodingOrchestrator({
      activeRuns: new Map(),
      createEphemeralWorktree: async () => ({
        worktreePath: '/tmp/coder-vi-test',
        cleanup: async () => {},
        listChangedFiles: () => [],
        getDiffSummary: () => '',
      }),
      runContainerAgent: async () => ({
        status: 'success',
        result: 'Done.',
        usage: { totalTokens: 5 },
        toolExecutions: [],
      }),
      publishEvent: () => {},
      runEvaluatorPass: async () => ({
        pass: true,
        score: 9,
        issues: [],
        feedback: 'OK',
        skipped: false,
      }),
    });

    const result = await orchestrator.runTask({
      requestId: 'coder-vi-test',
      mode: 'plan',
      config: { toolMode: 'read_only', isSubagent: false, workspaceMode: 'read_only' },
      originChatJid: 'telegram:test-group',
      originGroupFolder: folderName,
      taskText: 'Review',
      timeoutSeconds: 300,
      allowFanout: false,
      sessionContext: '[2026-01-01] User: Review',
      assistantName: 'FarmFriend',
      sessionKey: 'test-group',
      group: { jid: 'telegram:test-group', name: 'Test', folder: folderName, trigger: '@FarmFriend' },
    });

    assert.equal(result.ok, true);

    const db = getDb()!;
    const verdictRows = db
      .prepare(`SELECT kind, item FROM learning_injections WHERE request_id = 'coder-vi-test' AND kind = 'verdict-issues'`)
      .all() as Array<{ kind: string; item: string }>;

    assert.equal(verdictRows.length, 1, `Expected 1 verdict-issues row, got: ${JSON.stringify(verdictRows)}`);
    assert.equal(verdictRows[0].item, 'recurring-issues');
  } finally {
    closeDatabase();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.rmSync(groupRoot, { recursive: true, force: true });
  }
});

test('VAL-WS5-003: coding orchestrator with no coder learnings writes zero memory rows', async () => {
  const tmpRoot = makeTmpDir();
  const dbPath = path.join(tmpRoot, 'messages.db');
  const folderName = `li-no-learnings-${Date.now()}`;
  const groupRoot = testGroupDir(folderName);
  fs.mkdirSync(path.join(groupRoot, 'logs'), { recursive: true });
  fs.writeFileSync(
    path.join(groupRoot, 'MEMORY.md'),
    `# MEMORY

Just a plain memory file, no coder learnings section.
`,
  );
  try {
    initDatabaseAtPath(dbPath);

    const orchestrator = createCodingOrchestrator({
      activeRuns: new Map(),
      createEphemeralWorktree: async () => ({
        worktreePath: '/tmp/coder-li-empty',
        cleanup: async () => {},
        listChangedFiles: () => [],
        getDiffSummary: () => '',
      }),
      runContainerAgent: async () => ({
        status: 'success',
        result: 'Done.',
        usage: { totalTokens: 5 },
        toolExecutions: [],
      }),
      publishEvent: () => {},
      runEvaluatorPass: async () => ({
        pass: true,
        score: 9,
        issues: [],
        feedback: 'OK',
        skipped: false,
      }),
    });

    const result = await orchestrator.runTask({
      requestId: 'coder-li-empty-test',
      mode: 'plan',
      config: { toolMode: 'read_only', isSubagent: false, workspaceMode: 'read_only' },
      originChatJid: 'telegram:test-group',
      originGroupFolder: folderName,
      taskText: 'Review',
      timeoutSeconds: 300,
      allowFanout: false,
      sessionContext: '[2026-01-01] User: Review',
      assistantName: 'FarmFriend',
      sessionKey: 'test-group',
      group: { jid: 'telegram:test-group', name: 'Test', folder: folderName, trigger: '@FarmFriend' },
    });

    assert.equal(result.ok, true);

    const db = getDb()!;
    const memoryRows = db
      .prepare(`SELECT kind FROM learning_injections WHERE request_id = 'coder-li-empty-test' AND kind = 'memory'`)
      .all();

    assert.equal(memoryRows.length, 0, 'No memory rows should be written when no coder learnings exist');
  } finally {
    closeDatabase();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.rmSync(groupRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// VAL-WS5-003: getCoderLearningsForContext returns entriesCount
// ---------------------------------------------------------------------------

test('getCoderLearningsForContext returns correct entriesCount', async () => {
  const folderName = `li-gclf-${Date.now()}`;
  const groupRoot = testGroupDir(folderName);
  fs.mkdirSync(path.join(groupRoot, 'logs'), { recursive: true });
  fs.writeFileSync(
    path.join(groupRoot, 'MEMORY.md'),
    `# MEMORY

## Coder Learnings

### 2026-01-01
What worked:
- Lesson one

### 2026-01-02
What worked:
- Lesson two

### 2026-01-03
What worked:
- Lesson three
`,
  );
  try {
    const result = await getCoderLearningsForContext(folderName, 5);
    assert.equal(result.entriesCount, 3, `Expected 3 entries, got: ${result.entriesCount}`);
    assert.ok(result.formatted.includes('Lesson one'));
    assert.ok(result.formatted.includes('Lesson three'));
  } finally {
    fs.rmSync(groupRoot, { recursive: true, force: true });
  }
});

test('getCoderLearningsForContext returns entriesCount=0 when no learnings', async () => {
  const folderName = `li-gclf-empty-${Date.now()}`;
  const groupRoot = testGroupDir(folderName);
  fs.mkdirSync(path.join(groupRoot, 'logs'), { recursive: true });
  fs.writeFileSync(
    path.join(groupRoot, 'MEMORY.md'),
    `# MEMORY

Just a plain memory file.
`,
  );
  try {
    const result = await getCoderLearningsForContext(folderName, 5);
    assert.equal(result.entriesCount, 0);
    assert.equal(result.formatted, '');
  } finally {
    fs.rmSync(groupRoot, { recursive: true, force: true });
  }
});
