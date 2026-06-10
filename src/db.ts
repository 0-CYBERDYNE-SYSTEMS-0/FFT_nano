import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

import { proto } from '@whiskeysockets/baileys';

import { STORE_DIR } from './config.js';
import { NewMessage, ScheduledTask, TaskRunLog } from './types.js';
import { logger } from './logger.js';

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
      subagent_type TEXT,
      next_run TEXT,
      last_run TEXT,
      last_result TEXT,
      status TEXT DEFAULT 'active',
      created_by TEXT DEFAULT 'operator',
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

    CREATE TABLE IF NOT EXISTS agent_runs (
      id TEXT PRIMARY KEY,
      chat_jid TEXT NOT NULL,
      group_folder TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      prompt TEXT NOT NULL,
      created_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT,
      last_progress_at TEXT,
      current_phase TEXT,
      current_detail TEXT,
      provider TEXT,
      model TEXT,
      result TEXT,
      error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_agent_runs_chat_created ON agent_runs(chat_jid, created_at);
    CREATE INDEX IF NOT EXISTS idx_agent_runs_status ON agent_runs(status);

    CREATE TABLE IF NOT EXISTS evaluator_verdicts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id TEXT,
      group_folder TEXT NOT NULL,
      chat_jid TEXT,
      run_type TEXT NOT NULL,
      pass INTEGER NOT NULL,
      score INTEGER NOT NULL,
      issues TEXT,
      refinements INTEGER DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_eval_verdicts_group ON evaluator_verdicts(group_folder, created_at);

    CREATE TABLE IF NOT EXISTS delivery_outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dedupe_key TEXT NOT NULL UNIQUE,
      destination TEXT NOT NULL,
      body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 5,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      delivered_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_delivery_outbox_status ON delivery_outbox(status, created_at);

    CREATE TABLE IF NOT EXISTS learning_injections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id TEXT,
      group_folder TEXT NOT NULL,
      kind TEXT NOT NULL,
      item TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_learning_injections_request ON learning_injections(request_id);

    CREATE TABLE IF NOT EXISTS mutation_budget_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_folder TEXT NOT NULL,
      authority_id TEXT NOT NULL,
      sender_role TEXT NOT NULL,
      mutation_type TEXT NOT NULL,
      jid TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_mutation_budget_group_type_created
      ON mutation_budget_events(group_folder, mutation_type, created_at);
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
    `ALTER TABLE scheduled_tasks ADD COLUMN subagent_type TEXT`,
    `ALTER TABLE scheduled_tasks ADD COLUMN created_by TEXT DEFAULT 'operator'`,
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

  // Durability + self-improvement columns on agent_runs (migration for existing DBs)
  const agentRunMigrations = [
    `ALTER TABLE agent_runs ADD COLUMN recovery_state TEXT`,
    `ALTER TABLE agent_runs ADD COLUMN worktree_path TEXT`,
    `ALTER TABLE agent_runs ADD COLUMN evaluator_score INTEGER`,
    `ALTER TABLE agent_runs ADD COLUMN evaluator_pass INTEGER`,
    `ALTER TABLE agent_runs ADD COLUMN resume_attempts INTEGER`,
    `ALTER TABLE agent_runs ADD COLUMN provider TEXT`,
    `ALTER TABLE agent_runs ADD COLUMN model TEXT`,
  ];
  for (const migration of agentRunMigrations) {
    try {
      db.exec(migration);
    } catch {
      /* column already exists */
    }
  }

  // WS1.2 held-payload + operator-notification columns on delivery_outbox
  const outboxMigrations = [
    `ALTER TABLE delivery_outbox ADD COLUMN operator_notified_at TEXT`,
  ];
  for (const migration of outboxMigrations) {
    try {
      db.exec(migration);
    } catch {
      /* column already exists */
    }
  }

  // WS4.1 evaluator_verdicts: skipped + skip_reason columns
  const evaluatorVerdictMigrations = [
    `ALTER TABLE evaluator_verdicts ADD COLUMN skipped INTEGER DEFAULT 0`,
    `ALTER TABLE evaluator_verdicts ADD COLUMN skip_reason TEXT`,
  ];
  for (const migration of evaluatorVerdictMigrations) {
    try {
      db.exec(migration);
    } catch {
      /* column already exists */
    }
  }

  const hadMessagesFts = !!db
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

  triageActiveAgentRunsOnStartup();
}

export function closeDatabase(): void {
  if (!db) return;
  db.close();
  // @ts-expect-error allow tests to reset singleton
  db = undefined;
}

/** Get the current database instance (for testing only) */
export function getDb(): Database.Database | undefined {
  return db;
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
  id?: string;
  sender: string;
  sender_name: string;
  content: string;
  timestamp: string;
  is_from_me: number;
}

export interface PromptTranscriptMessageRow {
  id: string;
  chat_jid: string;
  sender: string;
  sender_name: string;
  content: string;
  timestamp: string;
  is_from_me: number;
}

export function getChatHistory(
  chatJid: string,
  limit = 120,
): ChatHistoryMessageRow[] {
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

export function getPromptTranscriptMessages(
  chatJid: string,
  limit = 24,
): PromptTranscriptMessageRow[] {
  const safeLimit = Number.isFinite(limit)
    ? Math.max(1, Math.min(200, Math.floor(limit)))
    : 24;
  const rows = db
    .prepare(
      `
      SELECT id, chat_jid, sender, sender_name, content, timestamp, is_from_me
      FROM messages
      WHERE chat_jid = ?
        AND content != '' AND content IS NOT NULL
      ORDER BY timestamp DESC
      LIMIT ?
    `,
    )
    .all(chatJid, safeLimit) as PromptTranscriptMessageRow[];
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
  if (!content) return;

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
  _botPrefix: string,
): { messages: NewMessage[]; newTimestamp: string } {
  if (jids.length === 0) return { messages: [], newTimestamp: lastTimestamp };

  const placeholders = jids.map(() => '?').join(',');
  const sql = `
    SELECT id, chat_jid, sender, sender_name, content, timestamp, is_from_me
    FROM messages
    WHERE timestamp > ? AND chat_jid IN (${placeholders})
      AND sender != ?
      AND coalesce(is_from_me, 0) != 1
      AND content != '' AND content IS NOT NULL
    ORDER BY timestamp
  `;

  const rows = db
    .prepare(sql)
    .all(lastTimestamp, ...jids, '__fft_tui__') as NewMessage[];

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
  const sql = `
    SELECT id, chat_jid, sender, sender_name, content, timestamp, is_from_me
    FROM messages
    WHERE chat_jid = ? AND timestamp > ?
      AND sender != '__fft_tui__'
      AND content != '' AND content IS NOT NULL
    ORDER BY timestamp
  `;
  return db.prepare(sql).all(chatJid, sinceTimestamp) as NewMessage[];
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
      subagent_type, next_run, status, created_by, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    task.subagent_type ?? null,
    task.next_run,
    task.status,
    task.created_by ?? 'operator',
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

// WS2.3: Get tasks pending operator approval (agent-created tasks)
export function getPendingTasks(): ScheduledTask[] {
  return db
    .prepare(
      `SELECT * FROM scheduled_tasks WHERE status = 'pending_approval' ORDER BY created_at DESC`,
    )
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

  return db
    .prepare(sql)
    .all(ftsQuery, ...chatJids, limit) as TranscriptSearchRow[];
}

export type AgentRunKind = 'agent_long';
export type AgentRunStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'aborted'
  | 'interrupted';

export type AgentRunRecoveryState = 'recoverable' | 'dead' | 'resumed';

export interface AgentRunRecord {
  id: string;
  chat_jid: string;
  group_folder: string;
  kind: AgentRunKind;
  status: AgentRunStatus;
  prompt: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  last_progress_at: string | null;
  current_phase: string | null;
  current_detail: string | null;
  provider: string | null;
  model: string | null;
  result: string | null;
  error: string | null;
  recovery_state: AgentRunRecoveryState | null;
  worktree_path: string | null;
  evaluator_score: number | null;
  evaluator_pass: number | null;
  resume_attempts: number | null;
}

export function createAgentRun(input: {
  id: string;
  chatJid: string;
  groupFolder: string;
  kind: AgentRunKind;
  prompt: string;
  createdAt?: string;
  resumeAttempts?: number;
}): AgentRunRecord {
  const createdAt = input.createdAt || new Date().toISOString();
  db.prepare(
    `
    INSERT INTO agent_runs (
      id, chat_jid, group_folder, kind, status, prompt, created_at, resume_attempts
    ) VALUES (?, ?, ?, ?, 'queued', ?, ?, ?)
  `,
  ).run(
    input.id,
    input.chatJid,
    input.groupFolder,
    input.kind,
    input.prompt,
    createdAt,
    input.resumeAttempts ?? 0,
  );
  return getAgentRunById(input.id) as AgentRunRecord;
}

export function getAgentRunById(id: string): AgentRunRecord | undefined {
  return db.prepare(`SELECT * FROM agent_runs WHERE id = ?`).get(id) as
    | AgentRunRecord
    | undefined;
}

export function listAgentRunsForChat(
  chatJid: string,
  limit = 10,
): AgentRunRecord[] {
  const safeLimit = Number.isFinite(limit)
    ? Math.max(1, Math.min(50, Math.floor(limit)))
    : 10;
  return db
    .prepare(
      `
      SELECT * FROM agent_runs
      WHERE chat_jid = ? AND kind = 'agent_long'
      ORDER BY created_at DESC
      LIMIT ?
    `,
    )
    .all(chatJid, safeLimit) as AgentRunRecord[];
}

export function listActiveAgentRuns(chatJid?: string): AgentRunRecord[] {
  const sql = chatJid
    ? `
      SELECT * FROM agent_runs
      WHERE chat_jid = ? AND kind = 'agent_long' AND status IN ('queued', 'running')
      ORDER BY created_at ASC
    `
    : `
      SELECT * FROM agent_runs
      WHERE kind = 'agent_long' AND status IN ('queued', 'running')
      ORDER BY created_at ASC
    `;
  const statement = db.prepare(sql);
  return (
    chatJid ? statement.all(chatJid) : statement.all()
  ) as AgentRunRecord[];
}

export function updateAgentRun(
  id: string,
  updates: Partial<{
    status: AgentRunStatus;
    started_at: string | null;
    finished_at: string | null;
    last_progress_at: string | null;
    current_phase: string | null;
    current_detail: string | null;
    provider: string | null;
    model: string | null;
    result: string | null;
    error: string | null;
    recovery_state: AgentRunRecoveryState | null;
    worktree_path: string | null;
    evaluator_score: number | null;
    evaluator_pass: number | null;
    resume_attempts: number | null;
  }>,
): void {
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(updates)) {
    fields.push(`${key} = ?`);
    values.push(value);
  }
  if (fields.length === 0) return;
  values.push(id);
  db.prepare(`UPDATE agent_runs SET ${fields.join(', ')} WHERE id = ?`).run(
    ...values,
  );
}

/**
 * On host restart, triage runs that were in flight instead of blindly failing
 * them. A run whose worktree still exists on disk is marked `interrupted` +
 * `recoverable` and its worktree is preserved so work can be resumed; a run
 * with no surviving worktree is marked `failed` + `dead`. The dead-path error
 * string is kept stable (`host_restarted_before_completion`) so downstream
 * consumers and existing behavior are unaffected.
 */
export function triageActiveAgentRunsOnStartup(): {
  recoverable: number;
  dead: number;
} {
  const now = new Date().toISOString();
  const inFlight = db
    .prepare(
      `SELECT id, worktree_path FROM agent_runs
       WHERE kind = 'agent_long' AND status IN ('queued', 'running')`,
    )
    .all() as Array<{ id: string; worktree_path: string | null }>;

  const markRecoverable = db.prepare(
    `UPDATE agent_runs
     SET status = 'interrupted', recovery_state = 'recoverable',
         finished_at = ?, error = 'host_restarted_mid_run'
     WHERE id = ?`,
  );
  const markDead = db.prepare(
    `UPDATE agent_runs
     SET status = 'failed', recovery_state = 'dead',
         finished_at = ?, error = 'host_restarted_before_completion'
     WHERE id = ?`,
  );

  let recoverable = 0;
  let dead = 0;
  for (const run of inFlight) {
    const hasWorktree = !!run.worktree_path && fs.existsSync(run.worktree_path);
    if (hasWorktree) {
      markRecoverable.run(now, run.id);
      recoverable += 1;
    } else {
      markDead.run(now, run.id);
      dead += 1;
    }
  }
  return { recoverable, dead };
}

/**
 * List runs that were interrupted by a restart but whose workspace survives,
 * so an operator or a resume consumer can pick them back up.
 */
export function listRecoverableAgentRuns(chatJid?: string): AgentRunRecord[] {
  const sql = chatJid
    ? `SELECT * FROM agent_runs
       WHERE chat_jid = ? AND kind = 'agent_long'
         AND status = 'interrupted' AND recovery_state = 'recoverable'
       ORDER BY created_at ASC`
    : `SELECT * FROM agent_runs
       WHERE kind = 'agent_long'
         AND status = 'interrupted' AND recovery_state = 'recoverable'
       ORDER BY created_at ASC`;
  const statement = db.prepare(sql);
  return (
    chatJid ? statement.all(chatJid) : statement.all()
  ) as AgentRunRecord[];
}

// ---------------------------------------------------------------------------
// Evaluator verdict persistence (closes the self-improvement feedback loop)
// ---------------------------------------------------------------------------

export interface EvaluatorVerdictInput {
  requestId?: string;
  groupFolder: string;
  chatJid?: string;
  runType: string;
  pass: boolean;
  score: number;
  issues: string[];
  refinements?: number;
  /** WS4.1: Whether this was a skipped evaluation (eligible-skip only) */
  skipped?: boolean;
  /** WS4.1: Reason for skip (eligible-skip only) */
  skipReason?: string;
}

export interface EvaluatorStats {
  total: number;
  passes: number;
  passRate: number;
  recentIssues: string[];
  recentSkips: number;
}

/**
 * Persist an evaluator verdict so the scoring the system already pays for is
 * no longer discarded. Recorded verdicts feed `getEvaluatorStats`, which the
 * coding orchestrator prepends to future runs as learned context.
 */
export function recordEvaluatorVerdict(input: EvaluatorVerdictInput): void {
  if (!db) return;
  db.prepare(
    `INSERT INTO evaluator_verdicts (
       request_id, group_folder, chat_jid, run_type, pass, score, issues, refinements, skipped, skip_reason, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.requestId ?? null,
    input.groupFolder,
    input.chatJid ?? null,
    input.runType,
    input.pass ? 1 : 0,
    Math.round(input.score),
    JSON.stringify(input.issues ?? []),
    input.refinements ?? 0,
    input.skipped ? 1 : 0,
    input.skipReason ?? null,
    new Date().toISOString(),
  );
}

/**
 * Rolling pass-rate and the top recurring issues for a group, used to give the
 * next run awareness of how prior runs in the same workspace fared. Issues are
 * ranked by a recency- and failure-weighted score with decay (see below), not
 * pure recency, so stale one-offs drop out and persistent failures rise.
 * Skipped rows are excluded from passRate (I3: only ground truth gates).
 */
export function getEvaluatorStats(
  groupFolder: string,
  limit = 20,
): EvaluatorStats {
  if (!db)
    return {
      total: 0,
      passes: 0,
      passRate: 0,
      recentIssues: [],
      recentSkips: 0,
    };
  const safeLimit = Number.isFinite(limit)
    ? Math.max(1, Math.min(100, Math.floor(limit)))
    : 20;
  const rows = db
    .prepare(
      `SELECT pass, skipped, issues FROM evaluator_verdicts
       WHERE group_folder = ?
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(groupFolder, safeLimit) as Array<{
    pass: number;
    skipped: number;
    issues: string | null;
  }>;

  const total = rows.length;
  const recentSkips = rows.filter((r) => r.skipped === 1).length;

  // I3: passRate is computed over non-skipped rows only.
  // Both numerator (passes) and denominator (totalNonSkipped) filter skipped=0.
  const nonSkippedRows = rows.filter((r) => r.skipped === 0);
  const totalNonSkipped = nonSkippedRows.length;
  const passes = nonSkippedRows.filter((r) => r.pass === 1).length;

  // Reliability-weighted recurring issues (rows are newest-first). Each
  // occurrence is scored by recency (newer verdicts count more, via geometric
  // decay) and by whether the verdict failed — an issue noted on a run that
  // failed is a far stronger "avoid this" signal than one noted on a run that
  // passed anyway. Issues whose accumulated score decays below the floor (old
  // one-offs, stale passing-run notes that never recurred and never correlated
  // with failure) are dropped rather than surfaced, so one bad lesson can't
  // poison every future run indefinitely.
  const RECENCY_DECAY = 0.85;
  const PASSING_WEIGHT = 0.25;
  const MIN_ISSUE_SCORE = 0.15;
  const issueScores = new Map<string, number>();
  rows.forEach((row, idx) => {
    if (!row.issues) return;
    let parsed: unknown[];
    try {
      parsed = JSON.parse(row.issues) as unknown[];
    } catch {
      return; // ignore malformed issues json
    }
    const weight =
      Math.pow(RECENCY_DECAY, idx) * (row.pass === 0 ? 1 : PASSING_WEIGHT);
    const seenInRow = new Set<string>();
    for (const issue of parsed) {
      if (typeof issue !== 'string') continue;
      if (seenInRow.has(issue)) continue; // count an issue once per verdict
      seenInRow.add(issue);
      issueScores.set(issue, (issueScores.get(issue) ?? 0) + weight);
    }
  });

  const recentIssues = [...issueScores.entries()]
    .filter(([, score]) => score >= MIN_ISSUE_SCORE)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([issue]) => issue);

  return {
    total,
    passes,
    passRate: totalNonSkipped > 0 ? passes / totalNonSkipped : 0,
    recentIssues,
    recentSkips,
  };
}

// ---------------------------------------------------------------------------
// Learning injections (WS5 — efficacy loop)
// ---------------------------------------------------------------------------

export interface LearningInjectionInput {
  requestId: string;
  groupFolder: string;
  kind: 'memory' | 'skill' | 'verdict-issues';
  item: string;
}

/**
 * Record that a learning item was injected into a prompt at an assembly point.
 * Best-effort: failures are caught and logged, never thrown — the run must
 * never be aborted by a recorder failure (VAL-WS5-002/003/004).
 */
export function recordLearningInjection(input: LearningInjectionInput): void {
  if (!db) return;
  try {
    db.prepare(
      `INSERT INTO learning_injections
         (request_id, group_folder, kind, item, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      input.requestId,
      input.groupFolder,
      input.kind,
      input.item,
      new Date().toISOString(),
    );
  } catch (err) {
    logger.warn(
      {
        err,
        requestId: input.requestId,
        groupFolder: input.groupFolder,
        kind: input.kind,
        item: input.item,
      },
      'Failed to record learning injection',
    );
  }
}

// ---------------------------------------------------------------------------
// WS5.2 — Skill efficacy join (VAL-WS5-006..009)
// ---------------------------------------------------------------------------

/** Per-skill efficacy result for one group. */
export interface SkillEfficacy {
  /** Count of joined rows for this skill (non-skipped evaluator verdicts only). */
  runsWith: number;
  /** pass / total over non-skipped joined rows. */
  passRateWith: number;
  /** Group-level baseline passRate from getEvaluatorStats(groupFolder).passRate. */
  groupBaseline: number;
}

/**
 * Per-skill efficacy: join learning_injections (kind='skill') against
 * evaluator_verdicts on request_id, scoped to groupFolder.
 *
 * Returns efficacy for skills with >= 5 matching (non-skipped) rows;
 * below the sample floor of 5, no entry is published for that skill.
 *
 * The join is scoped on group_folder (group A's data does not contaminate
 * group B's). The function is read-only — no table is modified.
 *
 * groupBaseline is the overall group passRate from getEvaluatorStats,
 * computed over all non-skipped evaluator_verdicts in the group.
 *
 * Excludes skipped evaluator_verdicts from both the passRateWith numerator
 * and denominator (I3: only ground truth gates).
 */
export function getSkillEfficacy(
  groupFolder: string,
): Map<string, SkillEfficacy> {
  if (!db) return new Map();

  // Get overall group baseline from evaluator stats (covers all evaluator_verdicts
  // in the group, not just the skill-matched subset — this is the comparison yardstick).
  const stats = getEvaluatorStats(groupFolder);
  const groupBaseline = stats.passRate;

  // Join learning_injections (kind='skill') with evaluator_verdicts on request_id.
  // Both sides are filtered by group_folder to ensure per-group isolation.
  const rows = db
    .prepare(
      `
    SELECT
      li.item AS skill_name,
      ev.pass,
      ev.skipped
    FROM learning_injections li
    JOIN evaluator_verdicts ev ON li.request_id = ev.request_id
    WHERE li.group_folder = ?
      AND li.kind = 'skill'
      AND ev.group_folder = ?
    `,
    )
    .all(groupFolder, groupFolder) as Array<{
    skill_name: string;
    pass: number;
    skipped: number | null;
  }>;

  // Group by skill_name and accumulate non-skipped pass counts.
  const skillGroups = new Map<
    string,
    { totalNonSkipped: number; passesNonSkipped: number }
  >();

  for (const row of rows) {
    if (row.skipped === 1) {
      // Skipped rows are excluded from both numerator and denominator (I3).
      continue;
    }
    const existing = skillGroups.get(row.skill_name) ?? {
      totalNonSkipped: 0,
      passesNonSkipped: 0,
    };
    existing.totalNonSkipped += 1;
    if (row.pass === 1) {
      existing.passesNonSkipped += 1;
    }
    skillGroups.set(row.skill_name, existing);
  }

  // Build result map: only skills with >= 5 non-skipped matching rows get a published entry.
  const result = new Map<string, SkillEfficacy>();
  for (const [
    skillName,
    { totalNonSkipped, passesNonSkipped },
  ] of skillGroups) {
    if (totalNonSkipped < 5) continue;
    result.set(skillName, {
      runsWith: totalNonSkipped,
      passRateWith:
        totalNonSkipped > 0 ? passesNonSkipped / totalNonSkipped : 0,
      groupBaseline,
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// WS5.2 / WS6.2 — Learning injections (read-only)
// ---------------------------------------------------------------------------

export interface LearningInjection {
  id: number;
  request_id: string | null;
  group_folder: string;
  kind: string;
  item: string;
  created_at: string;
}

/**
 * Get recent learning injections for a group, ordered by created_at descending.
 * Used by the /learning digest to show memory writes and other injections.
 */
export function getRecentLearningInjections(
  groupFolder: string,
  limit = 20,
): LearningInjection[] {
  if (!db) return [];
  const safeLimit = Number.isFinite(limit)
    ? Math.max(1, Math.min(100, Math.floor(limit)))
    : 20;
  return db
    .prepare(
      `SELECT id, request_id, group_folder, kind, item, created_at
       FROM learning_injections
       WHERE group_folder = ?
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(groupFolder, safeLimit) as LearningInjection[];
}

// ---------------------------------------------------------------------------
// Delivery outbox (at-least-once + dedupe for non-interactive finals/cron)
// ---------------------------------------------------------------------------

export type DeliveryOutboxStatus = 'pending' | 'delivered' | 'failed' | 'held';

export interface DeliveryOutboxRecord {
  id: number;
  dedupe_key: string;
  destination: string;
  body: string;
  status: DeliveryOutboxStatus;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  delivered_at: string | null;
  /** ISO timestamp when the operator was notified about this held entry. */
  operator_notified_at: string | null;
}

/**
 * Enqueue an outbound message idempotently. The `dedupeKey` is UNIQUE, so a
 * second enqueue for the same logical message is a no-op — this is what
 * prevents double-posting when a producer (cron re-run, resumed run, retry)
 * re-emits the same final. Returns the existing/new row plus whether it was a
 * duplicate so callers can skip re-delivering an already-delivered message.
 */
export function enqueueDelivery(input: {
  dedupeKey: string;
  destination: string;
  body: string;
  maxAttempts?: number;
}): { record: DeliveryOutboxRecord; duplicate: boolean } {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT OR IGNORE INTO delivery_outbox (
         dedupe_key, destination, body, status, attempts, max_attempts, created_at, updated_at
       ) VALUES (?, ?, ?, 'pending', 0, ?, ?, ?)`,
    )
    .run(
      input.dedupeKey,
      input.destination,
      input.body,
      input.maxAttempts ?? 5,
      now,
      now,
    );
  const record = db
    .prepare(`SELECT * FROM delivery_outbox WHERE dedupe_key = ?`)
    .get(input.dedupeKey) as DeliveryOutboxRecord;
  return { record, duplicate: result.changes === 0 };
}

/**
 * Enqueue a held delivery_outbox row for an outbound action that was blocked
 * at the gate because the run authority lacked operatorGrant.
 *
 * The dedupe_key is set to the IPC action's dedupe_key so that if the same
 * logical message is re-submitted (e.g. a resumed run), the UNIQUE constraint
 * makes the second insert a no-op — satisfying VAL-WS1-009's "single notification
 * per hold" requirement without a separate dedupe table.
 *
 * Returns the row and whether it was a duplicate insert.
 */
export function enqueueHeldDelivery(input: {
  dedupeKey: string;
  destination: string;
  body: string;
}): { record: DeliveryOutboxRecord; duplicate: boolean } {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT OR IGNORE INTO delivery_outbox (
         dedupe_key, destination, body, status, attempts, max_attempts,
         operator_notified_at, created_at, updated_at
       ) VALUES (?, ?, ?, 'held', 0, 0, NULL, ?, ?)`,
    )
    .run(input.dedupeKey, input.destination, input.body, now, now);
  const record = db
    .prepare(`SELECT * FROM delivery_outbox WHERE dedupe_key = ?`)
    .get(input.dedupeKey) as DeliveryOutboxRecord;
  return { record, duplicate: result.changes === 0 };
}

/**
 * All held delivery_outbox rows, oldest first. Used by the operator surfaces
 * (e.g. /tasks panel, /delivery-status) to display held payloads.
 */
export function listHeldDeliveries(): DeliveryOutboxRecord[] {
  return db
    .prepare(
      `SELECT * FROM delivery_outbox
       WHERE status = 'held'
       ORDER BY created_at ASC`,
    )
    .all() as DeliveryOutboxRecord[];
}

/**
 * Release a held delivery_outbox row back to 'pending' so it will be picked up
 * by the next flushPending cycle. Used by the operator when they approve a
 * held payload for delivery.
 */
export function releaseHeldDelivery(
  dedupeKey: string,
): DeliveryOutboxRecord | undefined {
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE delivery_outbox
     SET status = 'pending', max_attempts = 5, attempts = 0, updated_at = ?
     WHERE dedupe_key = ? AND status = 'held'`,
  ).run(now, dedupeKey);
  return db
    .prepare(`SELECT * FROM delivery_outbox WHERE dedupe_key = ?`)
    .get(dedupeKey) as DeliveryOutboxRecord | undefined;
}

/**
 * Mark a held row as having been notified to the operator. Idempotent — a
 * second notify call for the same dedupe_key is a no-op because
 * operator_notified_at is already set.
 */
export function markHeldDeliveryNotified(dedupeKey: string): void {
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE delivery_outbox
     SET operator_notified_at = COALESCE(operator_notified_at, ?), updated_at = ?
     WHERE dedupe_key = ? AND status = 'held'`,
  ).run(now, now, dedupeKey);
}

/**
 * Pending entries that still have attempts left, oldest first. Drives both the
 * inline delivery attempt and the startup/periodic flush.
 * Note: held rows are explicitly excluded — they are never auto-promoted.
 */
export function listPendingDeliveries(limit = 100): DeliveryOutboxRecord[] {
  const safeLimit = Number.isFinite(limit)
    ? Math.max(1, Math.min(500, Math.floor(limit)))
    : 100;
  return db
    .prepare(
      `SELECT * FROM delivery_outbox
       WHERE status = 'pending' AND attempts < max_attempts
       ORDER BY created_at ASC
       LIMIT ?`,
    )
    .all(safeLimit) as DeliveryOutboxRecord[];
}

export function getDeliveryByDedupeKey(
  dedupeKey: string,
): DeliveryOutboxRecord | undefined {
  return db
    .prepare(`SELECT * FROM delivery_outbox WHERE dedupe_key = ?`)
    .get(dedupeKey) as DeliveryOutboxRecord | undefined;
}

/** Mark an outbox entry delivered. Idempotent. */
export function markDeliveryDelivered(id: number): void {
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE delivery_outbox
     SET status = 'delivered', attempts = attempts + 1,
         delivered_at = ?, updated_at = ?, last_error = NULL
     WHERE id = ? AND status != 'delivered'`,
  ).run(now, now, id);
}

/**
 * Record a failed attempt. Increments the attempt counter; once the cap is hit
 * the entry is marked `failed` so the flush stops retrying it (and an operator
 * can see it stuck). Below the cap it stays `pending` for the next flush.
 */
export function markDeliveryFailedAttempt(id: number, error: string): void {
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE delivery_outbox
     SET attempts = attempts + 1,
         status = CASE WHEN attempts + 1 >= max_attempts THEN 'failed' ELSE 'pending' END,
         last_error = ?, updated_at = ?
     WHERE id = ? AND status != 'delivered'`,
  ).run(error.slice(0, 500), now, id);
}
