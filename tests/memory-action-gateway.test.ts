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
