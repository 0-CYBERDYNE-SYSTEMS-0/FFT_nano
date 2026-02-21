import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

import { proto } from '@whiskeysockets/baileys';

import { STORE_DIR } from './config.js';
import { NewMessage, ScheduledTask, TaskRunLog } from './types.js';

let db: Database.Database;

export function initDatabase(): void {
  const dbPath = path.join(STORE_DIR, 'messages.db');
  initDatabaseAtPath(dbPath);
}

export function initDatabaseAtPath(dbPath: string): void {
  if (db) {
    try {
      db.close();
    } catch {
      /* ignore */
    }
  }

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  db = new Database(dbPath);
  db.exec(`
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
      PRIMARY KEY (id, chat_jid),
      FOREIGN KEY (chat_jid) REFERENCES chats(jid)
    );
    CREATE INDEX IF NOT EXISTS idx_timestamp ON messages(timestamp);

    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id TEXT PRIMARY KEY,
      group_folder TEXT NOT NULL,
      chat_jid TEXT NOT NULL,
      prompt TEXT NOT NULL,
      schedule_type TEXT NOT NULL,
      schedule_value TEXT NOT NULL,
      schedule_json TEXT,
      session_target TEXT,
      wake_mode TEXT,
      delivery_mode TEXT,
      delivery_channel TEXT,
      delivery_to TEXT,
      delivery_webhook_url TEXT,
      timeout_seconds INTEGER,
      stagger_ms INTEGER,
      delete_after_run INTEGER DEFAULT 0,
      consecutive_errors INTEGER DEFAULT 0,
      next_run TEXT,
      last_run TEXT,
      last_result TEXT,
      status TEXT DEFAULT 'active',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_next_run ON scheduled_tasks(next_run);
    CREATE INDEX IF NOT EXISTS idx_status ON scheduled_tasks(status);

    CREATE TABLE IF NOT EXISTS task_run_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      run_at TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      status TEXT NOT NULL,
      result TEXT,
      error TEXT,
      FOREIGN KEY (task_id) REFERENCES scheduled_tasks(id)
    );
    CREATE INDEX IF NOT EXISTS idx_task_run_logs ON task_run_logs(task_id, run_at);
  `);

  // Add sender_name column if it doesn't exist (migration for existing DBs)
  try {
    db.exec(`ALTER TABLE messages ADD COLUMN sender_name TEXT`);
  } catch {
    /* column already exists */
  }

  const scheduledTaskMigrations = [
    `ALTER TABLE scheduled_tasks ADD COLUMN schedule_json TEXT`,
    `ALTER TABLE scheduled_tasks ADD COLUMN session_target TEXT`,
    `ALTER TABLE scheduled_tasks ADD COLUMN wake_mode TEXT`,
    `ALTER TABLE scheduled_tasks ADD COLUMN delivery_mode TEXT`,
    `ALTER TABLE scheduled_tasks ADD COLUMN delivery_channel TEXT`,
    `ALTER TABLE scheduled_tasks ADD COLUMN delivery_to TEXT`,
    `ALTER TABLE scheduled_tasks ADD COLUMN delivery_webhook_url TEXT`,
    `ALTER TABLE scheduled_tasks ADD COLUMN timeout_seconds INTEGER`,
    `ALTER TABLE scheduled_tasks ADD COLUMN stagger_ms INTEGER`,
    `ALTER TABLE scheduled_tasks ADD COLUMN delete_after_run INTEGER DEFAULT 0`,
    `ALTER TABLE scheduled_tasks ADD COLUMN consecutive_errors INTEGER DEFAULT 0`,
  ];
  for (const migration of scheduledTaskMigrations) {
    try {
      db.exec(migration);
    } catch {
      /* column already exists */
    }
  }

  // Add context_mode column if it doesn't exist (migration for existing DBs)
  try {
    db.exec(
      `ALTER TABLE scheduled_tasks ADD COLUMN context_mode TEXT DEFAULT 'isolated'`,
    );
  } catch {
    /* column already exists */
  }

  const hadMessagesFts =
    !!db
      .prepare(
        `SELECT 1 AS present FROM sqlite_master WHERE type='table' AND name='messages_fts'`,
      )
      .get();

  // Episodic memory index over chat transcripts.
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
      chat_jid UNINDEXED,
      sender_name,
      content,
      timestamp UNINDEXED,
      content='messages',
      content_rowid='rowid'
    );

    CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
      INSERT INTO messages_fts(rowid, chat_jid, sender_name, content, timestamp)
      VALUES (new.rowid, new.chat_jid, coalesce(new.sender_name, ''), coalesce(new.content, ''), coalesce(new.timestamp, ''));
    END;

    CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, chat_jid, sender_name, content, timestamp)
      VALUES ('delete', old.rowid, old.chat_jid, coalesce(old.sender_name, ''), coalesce(old.content, ''), coalesce(old.timestamp, ''));
    END;

    CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, chat_jid, sender_name, content, timestamp)
      VALUES ('delete', old.rowid, old.chat_jid, coalesce(old.sender_name, ''), coalesce(old.content, ''), coalesce(old.timestamp, ''));
      INSERT INTO messages_fts(rowid, chat_jid, sender_name, content, timestamp)
      VALUES (new.rowid, new.chat_jid, coalesce(new.sender_name, ''), coalesce(new.content, ''), coalesce(new.timestamp, ''));
    END;
  `);
  if (!hadMessagesFts) {
    db.exec(`INSERT INTO messages_fts(messages_fts) VALUES ('rebuild')`);
  }
}

export function closeDatabase(): void {
  if (!db) return;
  db.close();
  // @ts-expect-error allow tests to reset singleton
  db = undefined;
}

/**
 * Store chat metadata only (no message content).
 * Used for all chats to enable group discovery without storing sensitive content.
 */
export function storeChatMetadata(
  chatJid: string,
  timestamp: string,
  name?: string,
): void {
  if (name) {
    // Update with name, preserving existing timestamp if newer
    db.prepare(
      `
      INSERT INTO chats (jid, name, last_message_time) VALUES (?, ?, ?)
      ON CONFLICT(jid) DO UPDATE SET
        name = excluded.name,
        last_message_time = MAX(last_message_time, excluded.last_message_time)
    `,
    ).run(chatJid, name, timestamp);
  } else {
    // Update timestamp only, preserve existing name if any
    db.prepare(
      `
      INSERT INTO chats (jid, name, last_message_time) VALUES (?, ?, ?)
      ON CONFLICT(jid) DO UPDATE SET
        last_message_time = MAX(last_message_time, excluded.last_message_time)
    `,
    ).run(chatJid, chatJid, timestamp);
  }
}

/**
 * Update chat name without changing timestamp for existing chats.
 * New chats get the current time as their initial timestamp.
 * Used during group metadata sync.
 */
export function updateChatName(chatJid: string, name: string): void {
  db.prepare(
    `
    INSERT INTO chats (jid, name, last_message_time) VALUES (?, ?, ?)
    ON CONFLICT(jid) DO UPDATE SET name = excluded.name
  `,
  ).run(chatJid, name, new Date().toISOString());
}

export interface ChatInfo {
  jid: string;
  name: string;
  last_message_time: string;
}

/**
 * Get all known chats, ordered by most recent activity.
 */
export function getAllChats(): ChatInfo[] {
  return db
    .prepare(
      `
    SELECT jid, name, last_message_time
    FROM chats
    ORDER BY last_message_time DESC
  `,
    )
    .all() as ChatInfo[];
}

/**
 * Get timestamp of last group metadata sync.
 */
export function getLastGroupSync(): string | null {
  // Store sync time in a special chat entry
  const row = db
    .prepare(`SELECT last_message_time FROM chats WHERE jid = '__group_sync__'`)
    .get() as { last_message_time: string } | undefined;
  return row?.last_message_time || null;
}

/**
 * Record that group metadata was synced.
 */
export function setLastGroupSync(): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT OR REPLACE INTO chats (jid, name, last_message_time) VALUES ('__group_sync__', '__group_sync__', ?)`,
  ).run(now);
}

/**
 * Store a message with full content.
 * Only call this for registered groups where message history is needed.
 */
export function storeTextMessage(input: {
  id: string;
  chatJid: string;
  sender: string;
  senderName: string;
  content: string;
  timestamp: string;
  isFromMe: boolean;
}): void {
  db.prepare(
    `INSERT OR REPLACE INTO messages (id, chat_jid, sender, sender_name, content, timestamp, is_from_me) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
    input.chatJid,
    input.sender,
    input.senderName,
    input.content,
    input.timestamp,
    input.isFromMe ? 1 : 0,
  );
}

export function storeHostMessage(input: {
  id: string;
  chatJid: string;
  sender: string;
  senderName: string;
  content: string;
  timestamp: string;
  isFromMe: boolean;
}): void {
  storeTextMessage(input);
}

export interface ChatHistoryMessageRow {
  sender: string;
  sender_name: string;
  content: string;
  timestamp: string;
  is_from_me: number;
}

export function getChatHistory(chatJid: string, limit = 120): ChatHistoryMessageRow[] {
  const safeLimit = Number.isFinite(limit)
    ? Math.max(1, Math.min(400, Math.floor(limit)))
    : 120;
  const rows = db
    .prepare(
      `
      SELECT sender, sender_name, content, timestamp, is_from_me
      FROM messages
      WHERE chat_jid = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `,
    )
    .all(chatJid, safeLimit) as ChatHistoryMessageRow[];
  rows.reverse();
  return rows;
}

export function storeMessage(
  msg: proto.IWebMessageInfo,
  chatJid: string,
  isFromMe: boolean,
  pushName?: string,
): void {
  if (!msg.key) return;

  const content =
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.imageMessage?.caption ||
    msg.message?.videoMessage?.caption ||
    '';

  const timestamp = new Date(Number(msg.messageTimestamp) * 1000).toISOString();
  const sender = msg.key.participant || msg.key.remoteJid || '';
  const senderName = pushName || sender.split('@')[0];
  const msgId = msg.key.id || '';

  storeTextMessage({
    id: msgId,
    chatJid,
    sender,
    senderName,
    content,
    timestamp,
    isFromMe,
  });
}

export function getNewMessages(
  jids: string[],
  lastTimestamp: string,
  botPrefix: string,
): { messages: NewMessage[]; newTimestamp: string } {
  if (jids.length === 0) return { messages: [], newTimestamp: lastTimestamp };

  const placeholders = jids.map(() => '?').join(',');
  // Filter out bot's own messages by checking content prefix (not is_from_me, since user shares the account)
  const sql = `
    SELECT id, chat_jid, sender, sender_name, content, timestamp
    FROM messages
    WHERE timestamp > ? AND chat_jid IN (${placeholders}) AND content NOT LIKE ? AND sender != ?
    ORDER BY timestamp
  `;

  const rows = db
    .prepare(sql)
    .all(lastTimestamp, ...jids, `${botPrefix}:%`, '__fft_tui__') as NewMessage[];

  let newTimestamp = lastTimestamp;
  for (const row of rows) {
    if (row.timestamp > newTimestamp) newTimestamp = row.timestamp;
  }

  return { messages: rows, newTimestamp };
}

export function getMessagesSince(
  chatJid: string,
  sinceTimestamp: string,
  botPrefix: string,
): NewMessage[] {
  // Filter out bot's own messages by checking content prefix
  const sql = `
    SELECT id, chat_jid, sender, sender_name, content, timestamp
    FROM messages
    WHERE chat_jid = ? AND timestamp > ? AND content NOT LIKE ? AND sender != ?
    ORDER BY timestamp
  `;
  return db
    .prepare(sql)
    .all(chatJid, sinceTimestamp, `${botPrefix}:%`, '__fft_tui__') as NewMessage[];
}

export function createTask(
  task: Omit<ScheduledTask, 'last_run' | 'last_result'>,
): void {
  db.prepare(
    `
    INSERT INTO scheduled_tasks (
      id, group_folder, chat_jid, prompt, schedule_type, schedule_value, context_mode,
      schedule_json, session_target, wake_mode, delivery_mode, delivery_channel, delivery_to,
      delivery_webhook_url, timeout_seconds, stagger_ms, delete_after_run, consecutive_errors,
      next_run, status, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    task.id,
    task.group_folder,
    task.chat_jid,
    task.prompt,
    task.schedule_type,
    task.schedule_value,
    task.context_mode || 'isolated',
    task.schedule_json ?? null,
    task.session_target ?? null,
    task.wake_mode ?? null,
    task.delivery_mode ?? null,
    task.delivery_channel ?? null,
    task.delivery_to ?? null,
    task.delivery_webhook_url ?? null,
    task.timeout_seconds ?? null,
    task.stagger_ms ?? null,
    task.delete_after_run ?? 0,
    task.consecutive_errors ?? 0,
    task.next_run,
    task.status,
    task.created_at,
  );
}

export function getTaskById(id: string): ScheduledTask | undefined {
  return db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(id) as
    | ScheduledTask
    | undefined;
}

export function getTasksForGroup(groupFolder: string): ScheduledTask[] {
  return db
    .prepare(
      'SELECT * FROM scheduled_tasks WHERE group_folder = ? ORDER BY created_at DESC',
    )
    .all(groupFolder) as ScheduledTask[];
}

export function getAllTasks(): ScheduledTask[] {
  return db
    .prepare('SELECT * FROM scheduled_tasks ORDER BY created_at DESC')
    .all() as ScheduledTask[];
}

export function updateTask(
  id: string,
  updates: Partial<
    Pick<
      ScheduledTask,
      'prompt' | 'schedule_type' | 'schedule_value' | 'next_run' | 'status'
    >
  >,
): void {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.prompt !== undefined) {
    fields.push('prompt = ?');
    values.push(updates.prompt);
  }
  if (updates.schedule_type !== undefined) {
    fields.push('schedule_type = ?');
    values.push(updates.schedule_type);
  }
  if (updates.schedule_value !== undefined) {
    fields.push('schedule_value = ?');
    values.push(updates.schedule_value);
  }
  if (updates.next_run !== undefined) {
    fields.push('next_run = ?');
    values.push(updates.next_run);
  }
  if (updates.status !== undefined) {
    fields.push('status = ?');
    values.push(updates.status);
  }

  if (fields.length === 0) return;

  values.push(id);
  db.prepare(
    `UPDATE scheduled_tasks SET ${fields.join(', ')} WHERE id = ?`,
  ).run(...values);
}

export function deleteTask(id: string): void {
  // Delete child records first (FK constraint)
  db.prepare('DELETE FROM task_run_logs WHERE task_id = ?').run(id);
  db.prepare('DELETE FROM scheduled_tasks WHERE id = ?').run(id);
}

export function getDueTasks(): ScheduledTask[] {
  const now = new Date().toISOString();
  return db
    .prepare(
      `
    SELECT * FROM scheduled_tasks
    WHERE status = 'active' AND next_run IS NOT NULL AND next_run <= ?
    ORDER BY next_run
  `,
    )
    .all(now) as ScheduledTask[];
}

export function getNextDueTaskTime(): string | null {
  const row = db
    .prepare(
      `
    SELECT next_run
    FROM scheduled_tasks
    WHERE status = 'active' AND next_run IS NOT NULL
    ORDER BY next_run ASC
    LIMIT 1
  `,
    )
    .get() as { next_run?: string | null } | undefined;
  return row?.next_run || null;
}

export function updateTaskAfterRun(
  id: string,
  nextRun: string | null,
  lastResult: string,
): void {
  const now = new Date().toISOString();
  db.prepare(
    `
    UPDATE scheduled_tasks
    SET next_run = ?, last_run = ?, last_result = ?, status = CASE WHEN ? IS NULL THEN 'completed' ELSE status END
    WHERE id = ?
  `,
  ).run(nextRun, now, lastResult, nextRun, id);
}

export function updateTaskAfterRunV2(input: {
  id: string;
  nextRun: string | null;
  lastResult: string;
  status: ScheduledTask['status'];
  consecutiveErrors: number;
}): void {
  const now = new Date().toISOString();
  db.prepare(
    `
    UPDATE scheduled_tasks
    SET next_run = ?,
        last_run = ?,
        last_result = ?,
        status = ?,
        consecutive_errors = ?
    WHERE id = ?
  `,
  ).run(
    input.nextRun,
    now,
    input.lastResult,
    input.status,
    input.consecutiveErrors,
    input.id,
  );
}

export function logTaskRun(log: TaskRunLog): void {
  db.prepare(
    `
    INSERT INTO task_run_logs (task_id, run_at, duration_ms, status, result, error)
    VALUES (?, ?, ?, ?, ?, ?)
  `,
  ).run(
    log.task_id,
    log.run_at,
    log.duration_ms,
    log.status,
    log.result,
    log.error,
  );
}

export function getTaskRunLogs(taskId: string, limit = 10): TaskRunLog[] {
  return db
    .prepare(
      `
    SELECT task_id, run_at, duration_ms, status, result, error
    FROM task_run_logs
    WHERE task_id = ?
    ORDER BY run_at DESC
    LIMIT ?
  `,
    )
    .all(taskId, limit) as TaskRunLog[];
}

export interface TranscriptSearchRow {
  rowid: number;
  chat_jid: string;
  sender_name: string;
  content: string;
  timestamp: string;
  snippet: string;
  rank: number;
}

function buildFtsQuery(raw: string): string {
  const tokens = (raw.toLowerCase().match(/[a-z0-9][a-z0-9_-]*/g) || []).filter(
    (token) => token.length > 1,
  );
  if (tokens.length === 0) {
    const fallback = raw.trim().replace(/"/g, ' ').slice(0, 80);
    return fallback ? `"${fallback}"` : '';
  }
  const unique = Array.from(new Set(tokens)).slice(0, 12);
  return unique.map((token) => `"${token}"`).join(' OR ');
}

export function searchMessagesByFts(
  chatJids: string[],
  query: string,
  limit = 10,
): TranscriptSearchRow[] {
  if (!db || chatJids.length === 0 || !query.trim()) return [];

  const ftsQuery = buildFtsQuery(query);
  if (!ftsQuery) return [];

  const placeholders = chatJids.map(() => '?').join(',');
  const sql = `
    SELECT
      m.rowid as rowid,
      m.chat_jid,
      m.sender_name,
      m.content,
      m.timestamp,
      snippet(messages_fts, 2, '[', ']', '...', 20) AS snippet,
      bm25(messages_fts) AS rank
    FROM messages_fts
    JOIN messages m ON m.rowid = messages_fts.rowid
    WHERE messages_fts MATCH ? AND m.chat_jid IN (${placeholders})
    ORDER BY rank ASC
    LIMIT ?
  `;

  return db.prepare(sql).all(ftsQuery, ...chatJids, limit) as TranscriptSearchRow[];
}
