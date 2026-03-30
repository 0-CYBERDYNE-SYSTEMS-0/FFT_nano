import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import test from 'node:test';

import {
  closeDatabase,
  getMessagesSince,
  getNewMessages,
  getPromptTranscriptMessages,
  initDatabaseAtPath,
  storeChatMetadata,
  storeHostMessage,
} from '../src/db.js';

test('message fetchers exclude assistant-origin and tui-sender rows without dropping user text', () => {
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
      id: 'u2',
      chatJid: 'chat-1',
      sender: 'user@jid',
      senderName: 'User',
      content: 'FarmFriend: can you check irrigation?',
      timestamp: '2026-03-22T10:00:01.500Z',
      isFromMe: false,
    });
    storeHostMessage({
      id: 'wa-self',
      chatJid: 'chat-1',
      sender: 'chat-1',
      senderName: 'chat-1',
      content: 'FarmFriend: outbound whatsapp echo',
      timestamp: '2026-03-22T10:00:01.750Z',
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
      ['u1', 'u2'],
    );
    // getMessagesSince includes assistant messages for conversation context
    assert.deepEqual(
      sinceRows.map((row) => row.id),
      ['u1', 'a1', 'u2', 'wa-self'],
    );
  } finally {
    closeDatabase();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('getPromptTranscriptMessages preserves chronological assistant and user context', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-db-transcript-'));
  const dbPath = path.join(tmpRoot, 'messages.db');

  try {
    initDatabaseAtPath(dbPath);
    storeChatMetadata('chat-2', '2026-03-22T09:59:59.000Z', 'Chat 2');

    storeHostMessage({
      id: 'u1',
      chatJid: 'chat-2',
      sender: 'user@jid',
      senderName: 'User',
      content: 'show me the news',
      timestamp: '2026-03-22T10:00:00.000Z',
      isFromMe: false,
    });
    storeHostMessage({
      id: 'a1',
      chatJid: 'chat-2',
      sender: 'FarmFriend',
      senderName: 'FarmFriend',
      content: 'FarmFriend: here are the headlines',
      timestamp: '2026-03-22T10:00:01.000Z',
      isFromMe: true,
    });
    storeHostMessage({
      id: 'u2',
      chatJid: 'chat-2',
      sender: 'user@jid',
      senderName: 'User',
      content: 'tell me more about the second one',
      timestamp: '2026-03-22T10:00:02.000Z',
      isFromMe: false,
    });

    const rows = getPromptTranscriptMessages('chat-2', 8);

    assert.deepEqual(
      rows.map((row) => row.id),
      ['u1', 'a1', 'u2'],
    );
    assert.deepEqual(
      rows.map((row) => row.is_from_me),
      [0, 1, 0],
    );
  } finally {
    closeDatabase();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
