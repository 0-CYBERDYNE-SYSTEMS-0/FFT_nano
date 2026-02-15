import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

import Database from 'better-sqlite3';

import {
  closeDatabase,
  initDatabaseAtPath,
  searchMessagesByFts,
} from '../src/db.js';

test('FTS migration rebuild indexes existing transcript rows', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-db-fts-'));
  const dbPath = path.join(tmpRoot, 'messages.db');

  try {
    const pre = new Database(dbPath);
    pre.exec(`
      CREATE TABLE IF NOT EXISTS chats (
        jid TEXT PRIMARY KEY,
        name TEXT,
        last_message_time TEXT
      );
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT,
        chat_jid TEXT,
        sender TEXT,
        sender_name TEXT,
        content TEXT,
        timestamp TEXT,
        is_from_me INTEGER,
        PRIMARY KEY (id, chat_jid)
      );
    `);
    pre
      .prepare(
        `INSERT INTO messages (id, chat_jid, sender, sender_name, content, timestamp, is_from_me) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'old-1',
        'jid-old',
        'user@jid',
        'User',
        'We pruned the orchard and checked irrigation lines.',
        new Date().toISOString(),
        0,
      );
    pre.close();

    initDatabaseAtPath(dbPath);
    const hits = searchMessagesByFts(['jid-old'], 'orchard irrigation', 5);
    assert.equal(hits.length > 0, true);
    assert.equal(hits[0].chat_jid, 'jid-old');
  } finally {
    closeDatabase();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
