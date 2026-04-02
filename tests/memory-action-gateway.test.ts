import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  closeDatabase,
  initDatabaseAtPath,
  storeChatMetadata,
  storeTextMessage,
} from '../src/db.js';
import { executeMemoryAction } from '../src/memory-action-gateway.js';
import type { RegisteredGroup } from '../src/types.js';

function makeRegisteredGroups(groups: Array<{ jid: string; folder: string }>): Record<string, RegisteredGroup> {
  const out: Record<string, RegisteredGroup> = {};
  for (const g of groups) {
    out[g.jid] = {
      name: g.folder,
      folder: g.folder,
      trigger: '@FarmFriend',
      added_at: new Date().toISOString(),
    };
  }
  return out;
}

test('memory_get denies cross-group access for non-main', async () => {
  const result = await executeMemoryAction(
    {
      type: 'memory_action',
      action: 'memory_get',
      requestId: 'r1',
      params: { path: 'MEMORY.md', groupFolder: 'group-b' },
    },
    {
      sourceGroup: 'group-a',
      isMain: false,
      registeredGroups: makeRegisteredGroups([
        { jid: 'chat-a', folder: 'group-a' },
        { jid: 'chat-b', folder: 'group-b' },
      ]),
    },
  );

  assert.equal(result.status, 'error');
  assert.match(result.error || '', /cross-group memory access denied/i);
});

test('memory_get denies traversal path', async () => {
  const result = await executeMemoryAction(
    {
      type: 'memory_action',
      action: 'memory_get',
      requestId: 'r2',
      params: { path: '../secret.md' },
    },
    {
      sourceGroup: 'group-a',
      isMain: false,
      registeredGroups: makeRegisteredGroups([{ jid: 'chat-a', folder: 'group-a' }]),
    },
  );

  assert.equal(result.status, 'error');
  assert.match(result.error || '', /not an allowed memory file/i);
});

test('memory_get returns empty document when allowed file is missing', async () => {
  const groupFolder = `missing-doc-${Date.now()}`;
  const groupDir = path.join(process.cwd(), 'groups', groupFolder);
  try {
    fs.mkdirSync(groupDir, { recursive: true });
    fs.writeFileSync(path.join(groupDir, 'MEMORY.md'), '# MEMORY\n\n', 'utf-8');

    const result = await executeMemoryAction(
      {
        type: 'memory_action',
        action: 'memory_get',
        requestId: 'missing-doc',
        params: { path: 'memory/2099-01-01.md' },
      },
      {
        sourceGroup: groupFolder,
        isMain: false,
        registeredGroups: makeRegisteredGroups([{ jid: 'jid-a', folder: groupFolder }]),
      },
    );

    assert.equal(result.status, 'success');
    assert.equal(result.result?.document?.path, 'memory/2099-01-01.md');
    assert.equal(result.result?.document?.content, '');
  } finally {
    fs.rmSync(groupDir, { recursive: true, force: true });
  }
});

test('memory_get supports canonical durable memory files', async () => {
  const groupFolder = `canonical-doc-${Date.now()}`;
  const groupDir = path.join(process.cwd(), 'groups', groupFolder);
  try {
    fs.mkdirSync(path.join(groupDir, 'canonical'), { recursive: true });
    fs.writeFileSync(
      path.join(groupDir, 'canonical', '_hot.md'),
      '# _hot\n\nPinned durable context.\n',
      'utf-8',
    );

    const result = await executeMemoryAction(
      {
        type: 'memory_action',
        action: 'memory_get',
        requestId: 'canonical-doc',
        params: { path: 'canonical/_hot.md' },
      },
      {
        sourceGroup: groupFolder,
        isMain: false,
        registeredGroups: makeRegisteredGroups([{ jid: 'jid-a', folder: groupFolder }]),
      },
    );

    assert.equal(result.status, 'success');
    assert.equal(result.result?.document?.path, 'canonical/_hot.md');
    assert.match(result.result?.document?.content || '', /Pinned durable context/);
  } finally {
    fs.rmSync(groupDir, { recursive: true, force: true });
  }
});

test('memory_search sessions returns transcript hits and respects main override', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-mem-action-db-'));
  const dbPath = path.join(tmpRoot, 'messages.db');
  const groupFolder = `test-mem-search-${Date.now()}`;
  const groupDir = path.join(process.cwd(), 'groups', groupFolder);

  try {
    fs.mkdirSync(groupDir, { recursive: true });
    fs.writeFileSync(path.join(groupDir, 'MEMORY.md'), '# MEMORY\n\nTomatoes in field A.\n');

    initDatabaseAtPath(dbPath);
    storeChatMetadata('jid-group-a', new Date().toISOString(), 'Group A');
    storeTextMessage({
      id: 'msg-1',
      chatJid: 'jid-group-a',
      sender: 'farmer@jid',
      senderName: 'Farmer',
      content: 'Remember we irrigated field A tomatoes yesterday.',
      timestamp: new Date().toISOString(),
      isFromMe: false,
    });

    const registeredGroups = makeRegisteredGroups([
      { jid: 'jid-main', folder: 'main' },
      { jid: 'jid-group-a', folder: groupFolder },
    ]);

    const fromMain = await executeMemoryAction(
      {
        type: 'memory_action',
        action: 'memory_search',
        requestId: 'r3',
        params: {
          query: 'irrigated tomatoes',
          sources: 'sessions',
          groupFolder,
          topK: 5,
        },
      },
      {
        sourceGroup: 'main',
        isMain: true,
        registeredGroups,
      },
    );

    assert.equal(fromMain.status, 'success');
    const hits = fromMain.result?.hits || [];
    assert.equal(hits.length > 0, true);
    assert.equal(hits.some((h) => h.source === 'session_transcript'), true);
  } finally {
    closeDatabase();
    fs.rmSync(groupDir, { recursive: true, force: true });
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('memory_search includes NANO.md in document hits', async () => {
  const groupFolder = `test-mem-nano-${Date.now()}`;
  const groupDir = path.join(process.cwd(), 'groups', groupFolder);

  try {
    fs.mkdirSync(groupDir, { recursive: true });
    fs.writeFileSync(
      path.join(groupDir, 'NANO.md'),
      '# NANO\n\nOperational contract: greenhouse vents close before irrigation.\n',
      'utf-8',
    );
    fs.writeFileSync(path.join(groupDir, 'MEMORY.md'), '# MEMORY\n\n', 'utf-8');

    const result = await executeMemoryAction(
      {
        type: 'memory_action',
        action: 'memory_search',
        requestId: 'r-nano-search',
        params: {
          query: 'greenhouse vents close before irrigation',
          sources: 'memory',
          topK: 5,
        },
      },
      {
        sourceGroup: groupFolder,
        isMain: false,
        registeredGroups: makeRegisteredGroups([{ jid: 'jid-a', folder: groupFolder }]),
      },
    );

    assert.equal(result.status, 'success');
    const hits = result.result?.hits || [];
    assert.equal(hits.some((hit) => hit.source === 'memory_doc' && hit.path === 'NANO.md'), true);
  } finally {
    fs.rmSync(groupDir, { recursive: true, force: true });
  }
});

test('memory_search preserves legacy MEMORY.md hits when canonical files are only scaffold stubs', async () => {
  const groupFolder = `test-mem-search-legacy-fallback-${Date.now()}`;
  const groupDir = path.join(process.cwd(), 'groups', groupFolder);

  try {
    fs.mkdirSync(path.join(groupDir, 'canonical'), { recursive: true });
    fs.writeFileSync(
      path.join(groupDir, 'canonical', '_hot.md'),
      '# _hot\n\nHigh-priority durable memory retrieved before all other canon.\n',
      'utf-8',
    );
    fs.writeFileSync(
      path.join(groupDir, 'canonical', 'identity.md'),
      '# identity\n\nStable user preferences and profile facts.\n',
      'utf-8',
    );
    fs.writeFileSync(
      path.join(groupDir, 'canonical', 'constraints.md'),
      '# constraints\n\nStanding hard constraints and prohibitions.\n',
      'utf-8',
    );
    fs.writeFileSync(
      path.join(groupDir, 'canonical', 'commitments.md'),
      '# commitments\n\nActive long-lived commitments and obligations.\n',
      'utf-8',
    );
    fs.writeFileSync(
      path.join(groupDir, 'canonical', 'projects.md'),
      '# projects\n\nLong-lived project context and architecture notes.\n',
      'utf-8',
    );
    fs.writeFileSync(
      path.join(groupDir, 'MEMORY.md'),
      '# MEMORY\n\nLEGACY_SEARCH_TOKEN_2026\n',
      'utf-8',
    );

    const result = await executeMemoryAction(
      {
        type: 'memory_action',
        action: 'memory_search',
        requestId: 'r-legacy-fallback',
        params: {
          query: 'LEGACY_SEARCH_TOKEN_2026',
          sources: 'memory',
          topK: 5,
        },
      },
      {
        sourceGroup: groupFolder,
        isMain: false,
        registeredGroups: makeRegisteredGroups([{ jid: 'jid-a', folder: groupFolder }]),
      },
    );

    assert.equal(result.status, 'success');
    const hits = result.result?.hits || [];
    assert.equal(
      hits.some(
        (hit) =>
          hit.source === 'memory_doc' &&
          hit.path === 'MEMORY.md' &&
          /LEGACY_SEARCH_TOKEN_2026/.test(hit.snippet),
      ),
      true,
    );
  } finally {
    fs.rmSync(groupDir, { recursive: true, force: true });
  }
});

test('memory_write todo_upsert_task is deterministic for same entry id', async () => {
  const groupFolder = `todo-write-${Date.now()}`;
  const groupDir = path.join(process.cwd(), 'groups', groupFolder);
  try {
    fs.mkdirSync(groupDir, { recursive: true });
    const registeredGroups = makeRegisteredGroups([{ jid: 'jid-a', folder: groupFolder }]);

    const first = await executeMemoryAction(
      {
        type: 'memory_action',
        action: 'memory_write',
        requestId: 'w1',
        params: {
          intent: 'todo_upsert_task',
          payload: {
            entryId: 'T-demo',
            text: 'Ship memory contract migration',
            status: 'PENDING',
          },
        },
      },
      {
        sourceGroup: groupFolder,
        isMain: false,
        registeredGroups,
      },
    );
    assert.equal(first.status, 'success');

    const second = await executeMemoryAction(
      {
        type: 'memory_action',
        action: 'memory_write',
        requestId: 'w2',
        params: {
          intent: 'todo_upsert_task',
          payload: {
            entryId: 'T-demo',
            text: 'Ship memory contract migration',
            status: 'DONE',
          },
        },
      },
      {
        sourceGroup: groupFolder,
        isMain: false,
        registeredGroups,
      },
    );
    assert.equal(second.status, 'success');

    const todos = fs.readFileSync(path.join(groupDir, 'TODOS.md'), 'utf-8');
    const matches = todos.match(/id:T-demo/g) || [];
    assert.equal(matches.length, 1);
    assert.match(todos, /status:DONE/);
  } finally {
    fs.rmSync(groupDir, { recursive: true, force: true });
  }
});

test('memory_write memory_append rejects non-durable target paths', async () => {
  const result = await executeMemoryAction(
    {
      type: 'memory_action',
      action: 'memory_write',
      requestId: 'w3',
      params: {
        intent: 'memory_append',
        payload: {
          path: 'TODOS.md',
          content: 'should fail',
        },
      },
    },
    {
      sourceGroup: 'group-a',
      isMain: false,
      registeredGroups: makeRegisteredGroups([{ jid: 'chat-a', folder: 'group-a' }]),
    },
  );

  assert.equal(result.status, 'error');
  assert.match(result.error || '', /writable durable memory file/i);
});

test('memory_write memory_append supports canonical durable targets', async () => {
  const groupFolder = `canonical-write-${Date.now()}`;
  const groupDir = path.join(process.cwd(), 'groups', groupFolder);
  try {
    fs.mkdirSync(path.join(groupDir, 'canonical'), { recursive: true });

    const result = await executeMemoryAction(
      {
        type: 'memory_action',
        action: 'memory_write',
        requestId: 'canonical-write',
        params: {
          intent: 'memory_append',
          payload: {
            path: 'canonical/constraints.md',
            content: 'Always confirm before destructive changes.',
          },
        },
      },
      {
        sourceGroup: groupFolder,
        isMain: false,
        registeredGroups: makeRegisteredGroups([{ jid: 'jid-a', folder: groupFolder }]),
      },
    );

    assert.equal(result.status, 'success');
    const body = fs.readFileSync(path.join(groupDir, 'canonical', 'constraints.md'), 'utf-8');
    assert.match(body, /Always confirm before destructive changes\./);
  } finally {
    fs.rmSync(groupDir, { recursive: true, force: true });
  }
});

test('memory_write nano_patch updates NANO.md operational guidance', async () => {
  const groupFolder = `nano-patch-${Date.now()}`;
  const groupDir = path.join(process.cwd(), 'groups', groupFolder);
  try {
    fs.mkdirSync(groupDir, { recursive: true });
    fs.writeFileSync(path.join(groupDir, 'NANO.md'), '# NANO\n\nExisting contract.\n', 'utf-8');

    const result = await executeMemoryAction(
      {
        type: 'memory_action',
        action: 'memory_write',
        requestId: 'nano-patch',
        params: {
          intent: 'nano_patch',
          targetSection: 'Execution',
          payload: {
            content: 'Use delegated coding runs for multi-file implementation work.',
          },
        },
      },
      {
        sourceGroup: groupFolder,
        isMain: false,
        registeredGroups: makeRegisteredGroups([{ jid: 'jid-a', folder: groupFolder }]),
      },
    );

    assert.equal(result.status, 'success');
    assert.equal(result.result?.mutation?.targetPath, 'NANO.md');
    const nanoBody = fs.readFileSync(path.join(groupDir, 'NANO.md'), 'utf-8');
    assert.match(nanoBody, /## Execution/);
    assert.match(nanoBody, /Use delegated coding runs for multi-file implementation work\./);
  } finally {
    fs.rmSync(groupDir, { recursive: true, force: true });
  }
});

test('memory_write todo_move_task keeps task-board formatting on in-place updates', async () => {
  const groupFolder = `todo-move-in-place-${Date.now()}`;
  const groupDir = path.join(process.cwd(), 'groups', groupFolder);
  try {
    fs.mkdirSync(groupDir, { recursive: true });
    const registeredGroups = makeRegisteredGroups([{ jid: 'jid-a', folder: groupFolder }]);

    const seed = await executeMemoryAction(
      {
        type: 'memory_action',
        action: 'memory_write',
        requestId: 'w4-seed',
        params: {
          intent: 'todo_upsert_task',
          payload: {
            entryId: 'T-demo',
            text: 'Ship memory contract migration',
            status: 'PENDING',
          },
        },
      },
      {
        sourceGroup: groupFolder,
        isMain: false,
        registeredGroups,
      },
    );
    assert.equal(seed.status, 'success');

    const moved = await executeMemoryAction(
      {
        type: 'memory_action',
        action: 'memory_write',
        requestId: 'w4-move',
        params: {
          intent: 'todo_move_task',
          payload: {
            entryId: 'T-demo',
            to: 'task_board',
            status: 'DONE',
          },
        },
      },
      {
        sourceGroup: groupFolder,
        isMain: false,
        registeredGroups,
      },
    );
    assert.equal(moved.status, 'success');

    const todos = fs.readFileSync(path.join(groupDir, 'TODOS.md'), 'utf-8');
    assert.match(todos, /- \[x\] Ship memory contract migration <!-- id:T-demo status:DONE -->/);
    assert.doesNotMatch(todos, /- \[x\] - \[ \] Ship memory contract migration/);
  } finally {
    fs.rmSync(groupDir, { recursive: true, force: true });
  }
});
