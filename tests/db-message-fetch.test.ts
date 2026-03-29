import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import test from 'node:test';

import {
  closeDatabase,
  getMessagesSince,
  getNewMessages,
  initDatabaseAtPath,
  storeChatMetadata,
  storeHostMessage,
} from '../src/db.js';

test('message fetchers exclude assistant-prefixed and tui-sender rows', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-db-fetch-'));
  const dbPath = path.join(tmpRoot, 'messages.db');

  try {
    initDatabaseAtPath(dbPath);
    storeChatMetadata('chat-1', '2026-03-22T09:59:59.000Z', 'Chat 1');

    storeHostMessage({
      id: 'u1',
      chatJid: 'chat-1',
      sender: 'user@jid',
      senderName: 'User',
      content: 'Need help with irrigation',
      timestamp: '2026-03-22T10:00:00.000Z',
      isFromMe: false,
    });
    storeHostMessage({
      id: 'a1',
      chatJid: 'chat-1',
      sender: 'FarmFriend',
      senderName: 'FarmFriend',
      content: 'FarmFriend: Here is your update',
      timestamp: '2026-03-22T10:00:01.000Z',
      isFromMe: true,
    });
    storeHostMessage({
      id: 't1',
      chatJid: 'chat-1',
      sender: '__fft_tui__',
      senderName: 'TUI',
      content: 'hidden',
      timestamp: '2026-03-22T10:00:02.000Z',
      isFromMe: false,
    });

    const { messages } = getNewMessages(['chat-1'], '', 'FarmFriend');
    const sinceRows = getMessagesSince('chat-1', '', 'FarmFriend');

    assert.deepEqual(
      messages.map((row) => row.id),
      ['u1'],
    );
    // getMessagesSince includes assistant messages for conversation context
    assert.deepEqual(
      sinceRows.map((row) => row.id),
      ['u1', 'a1'],
    );
  } finally {
    closeDatabase();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
