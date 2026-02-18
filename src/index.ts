import { exec, execSync, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

import makeWASocket, {
  DisconnectReason,
  WASocket,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';

import {
  ASSISTANT_NAME,
  DATA_DIR,
  FARM_STATE_ENABLED,
  IPC_POLL_INTERVAL,
  MAIN_GROUP_FOLDER,
  POLL_INTERVAL,
  STORE_DIR,
  TELEGRAM_MEDIA_MAX_MB,
  TIMEZONE,
  TRIGGER_PATTERN,
} from './config.js';
import {
  AvailableGroup,
  runContainerAgent,
  writeGroupsSnapshot,
  writeTasksSnapshot,
} from './container-runner.js';
import {
  getAllChats,
  getAllTasks,
  deleteTask,
  getLastGroupSync,
  getMessagesSince,
  getNewMessages,
  getTaskById,
  initDatabase,
  setLastGroupSync,
  storeChatMetadata,
  storeMessage,
  storeTextMessage,
  updateTask,
  updateChatName,
} from './db.js';
import { startSchedulerLoop } from './task-scheduler.js';
import {
  FarmActionRequest,
  MemoryActionRequest,
  NewMessage,
  RegisteredGroup,
} from './types.js';
import { loadJson, saveJson } from './utils.js';
import { logger } from './logger.js';
import { getContainerRuntime } from './container-runtime.js';
import {
  restartAppleContainerSystemSingleFlight,
  shouldSelfHealAppleContainer,
} from './apple-container.js';
import { acquireSingletonLock } from './singleton-lock.js';
import {
  createTelegramBot,
  isTelegramJid,
  parseTelegramChatId,
} from './telegram.js';
import type {
  TelegramBot,
  TelegramInboundCallbackQuery,
  TelegramInboundMessage,
  TelegramInlineKeyboard,
} from './telegram.js';
import { parseDelegationTrigger, type CodingHint } from './coding-delegation.js';
import { executeFarmAction } from './farm-action-gateway.js';
import { startFarmStateCollector, stopFarmStateCollector } from './farm-state-collector.js';
import { executeMemoryAction } from './memory-action-gateway.js';
import {
  appendCompactionSummaryToMemory,
  migrateCompactionsForGroup,
} from './memory-maintenance.js';
import { ensureMemoryScaffold } from './memory-paths.js';

const WHATSAPP_ENABLED = !['0', 'false', 'no'].includes(
  (process.env.WHATSAPP_ENABLED || '1').toLowerCase(),
);
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_API_BASE_URL = process.env.TELEGRAM_API_BASE_URL;
const TELEGRAM_MAIN_CHAT_ID = process.env.TELEGRAM_MAIN_CHAT_ID;
const TELEGRAM_ADMIN_SECRET = process.env.TELEGRAM_ADMIN_SECRET;
const TELEGRAM_AUTO_REGISTER = !['0', 'false', 'no'].includes(
  (process.env.TELEGRAM_AUTO_REGISTER || '1').toLowerCase(),
);
const APPLE_CONTAINER_SELF_HEAL = !['0', 'false', 'no'].includes(
  (process.env.FFT_NANO_APPLE_CONTAINER_SELF_HEAL || '1').toLowerCase(),
);
const HEARTBEAT_PROMPT =
  process.env.FFT_NANO_HEARTBEAT_PROMPT ||
  'Read HEARTBEAT.md if it exists (workspace context). Follow it strictly. Do not infer or repeat old tasks from prior chats. If nothing needs attention, reply HEARTBEAT_OK.';
const HEARTBEAT_INTERVAL_MS =
  parseDurationMs(process.env.FFT_NANO_HEARTBEAT_EVERY || '30m') || 30 * 60 * 1000;
const HEARTBEAT_ENABLED = HEARTBEAT_INTERVAL_MS > 0;

const GROUP_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const TELEGRAM_MEDIA_MAX_BYTES = TELEGRAM_MEDIA_MAX_MB * 1024 * 1024;

const TELEGRAM_COMMON_COMMANDS = [
  { command: 'help', description: 'Show command help' },
  { command: 'status', description: 'Show runtime status' },
  { command: 'id', description: 'Show this chat id' },
  { command: 'models', description: 'List available models' },
  { command: 'model', description: 'Show/set model override' },
  { command: 'think', description: 'Show/set thinking level' },
  { command: 'reasoning', description: 'Show/set reasoning visibility' },
  { command: 'new', description: 'Start a fresh session' },
  { command: 'reset', description: 'Reset session (alias for /new)' },
  { command: 'stop', description: 'Stop current run' },
  { command: 'usage', description: 'Show usage counters' },
  { command: 'queue', description: 'Show/set queue behavior' },
  { command: 'compact', description: 'Compact session context' },
] as const;

const TELEGRAM_ADMIN_COMMANDS = [
  { command: 'main', description: 'Claim this chat as main/admin' },
  { command: 'freechat', description: 'Manage non-main free-chat allowlist' },
  { command: 'coder', description: 'Delegate coding execution' },
  { command: 'coder_plan', description: 'Delegate coding plan-only' },
  { command: 'subagents', description: 'List/stop/spawn subagent runs' },
  { command: 'tasks', description: 'List scheduled tasks' },
  { command: 'task_pause', description: 'Pause a task: /task_pause <id>' },
  { command: 'task_resume', description: 'Resume a task: /task_resume <id>' },
  { command: 'task_cancel', description: 'Cancel a task: /task_cancel <id>' },
  { command: 'groups', description: 'List registered groups' },
  { command: 'reload', description: 'Refresh command state and metadata' },
  { command: 'panel', description: 'Open admin panel buttons' },
] as const;

type TelegramCommandName =
  | '/help'
  | '/status'
  | '/id'
  | '/models'
  | '/model'
  | '/think'
  | '/thinking'
  | '/t'
  | '/reasoning'
  | '/reason'
  | '/new'
  | '/reset'
  | '/stop'
  | '/usage'
  | '/queue'
  | '/compact'
  | '/subagents'
  | '/main'
  | '/tasks'
  | '/task_pause'
  | '/task_resume'
  | '/task_cancel'
  | '/groups'
  | '/reload'
  | '/panel'
  | '/coder'
  | '/coder-plan'
  | '/coder_plan'
  | '/freechat';

interface ActiveCoderRun {
  requestId: string;
  mode: 'execute' | 'plan';
  chatJid: string;
  groupName: string;
  startedAt: number;
}

type ThinkLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
type ReasoningLevel = 'off' | 'on' | 'stream';
type QueueMode =
  | 'collect'
  | 'interrupt'
  | 'followup'
  | 'steer'
  | 'steer-backlog';
type QueueDropPolicy = 'old' | 'new' | 'summarize';

interface ChatRunPreferences {
  provider?: string;
  model?: string;
  thinkLevel?: ThinkLevel;
  reasoningLevel?: ReasoningLevel;
  queueMode?: QueueMode;
  queueDebounceMs?: number;
  queueCap?: number;
  queueDrop?: QueueDropPolicy;
  freeChat?: boolean;
  nextRunNoContinue?: boolean;
}

interface ChatUsageStats {
  runs: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  tokenReports: number;
  lastProvider?: string;
  lastModel?: string;
  updatedAt: number;
}

interface ActiveChatRun {
  chatJid: string;
  startedAt: number;
  requestId?: string;
  abortController: AbortController;
}

let sock: WASocket;
let telegramBot: TelegramBot | null = null;
let lastTimestamp = '';
let registeredGroups: Record<string, RegisteredGroup> = {};
let lastAgentTimestamp: Record<string, string> = {};
let chatRunPreferences: Record<string, ChatRunPreferences> = {};
let chatUsageStats: Record<string, ChatUsageStats> = {};
const activeCoderRuns = new Map<string, ActiveCoderRun>();
const activeChatRuns = new Map<string, ActiveChatRun>();
let lastTelegramMenuMainChatId: string | null = null;
// LID to phone number mapping (WhatsApp now sends LID JIDs for self-chats)
let lidToPhoneMap: Record<string, string> = {};
// Guards to prevent duplicate loops on WhatsApp reconnect
let messageLoopRunning = false;
let ipcWatcherRunning = false;
let groupSyncTimerStarted = false;
let heartbeatLoopStarted = false;
let shuttingDown = false;

/**
 * Translate a JID from LID format to phone format if we have a mapping.
 * Returns the original JID if no mapping exists.
 */
function translateJid(jid: string): string {
  if (!jid.endsWith('@lid')) return jid;
  const lidUser = jid.split('@')[0].split(':')[0];
  const phoneJid = lidToPhoneMap[lidUser];
  if (phoneJid) {
    logger.debug({ lidJid: jid, phoneJid }, 'Translated LID to phone JID');
    return phoneJid;
  }
  return jid;
}

async function setTyping(jid: string, isTyping: boolean): Promise<void> {
  if (isTelegramJid(jid)) {
    if (!telegramBot) return;
    try {
      await telegramBot.setTyping(jid, isTyping);
    } catch (err) {
      logger.debug({ jid, err }, 'Failed to update Telegram typing status');
    }
    return;
  }

  if (!sock) return;
  try {
    await sock.sendPresenceUpdate(isTyping ? 'composing' : 'paused', jid);
  } catch (err) {
    logger.debug({ jid, err }, 'Failed to update typing status');
  }
}

function loadState(): void {
  const statePath = path.join(DATA_DIR, 'router_state.json');
  const state = loadJson<{
    last_timestamp?: string;
    last_agent_timestamp?: Record<string, string>;
    chat_run_preferences?: Record<string, ChatRunPreferences>;
    chat_usage_stats?: Record<string, ChatUsageStats>;
  }>(statePath, {});
  lastTimestamp = state.last_timestamp || '';
  lastAgentTimestamp = state.last_agent_timestamp || {};
  chatRunPreferences = state.chat_run_preferences || {};
  chatUsageStats = state.chat_usage_stats || {};
  registeredGroups = loadJson(
    path.join(DATA_DIR, 'registered_groups.json'),
    {},
  );
  logger.info(
    { groupCount: Object.keys(registeredGroups).length },
    'State loaded',
  );
}

function saveState(): void {
  saveJson(path.join(DATA_DIR, 'router_state.json'), {
    last_timestamp: lastTimestamp,
    last_agent_timestamp: lastAgentTimestamp,
    chat_run_preferences: chatRunPreferences,
    chat_usage_stats: chatUsageStats,
  });
}

function registerGroup(jid: string, group: RegisteredGroup): void {
  registeredGroups[jid] = group;
  saveJson(path.join(DATA_DIR, 'registered_groups.json'), registeredGroups);

  // Create group folder
  const groupDir = path.join(DATA_DIR, '..', 'groups', group.folder);
  fs.mkdirSync(path.join(groupDir, 'logs'), { recursive: true });

  // Memory file naming: SOUL.md is canonical. CLAUDE.md is supported for
  // backwards compatibility (older installs/groups).
  const soulFile = path.join(groupDir, 'SOUL.md');
  const legacyClaudeFile = path.join(groupDir, 'CLAUDE.md');

  // If legacy exists but SOUL doesn't, migrate in-place to avoid split-brain.
  if (!fs.existsSync(soulFile) && fs.existsSync(legacyClaudeFile)) {
    try {
      fs.renameSync(legacyClaudeFile, soulFile);
    } catch {
      // Cross-device or permission edge cases: fall back to copying.
      try {
        fs.copyFileSync(legacyClaudeFile, soulFile);
      } catch {
        /* ignore */
      }
    }
  }

  if (!fs.existsSync(soulFile)) {
    fs.writeFileSync(
      soulFile,
      `# FarmFriend\n\nThis is the memory and working directory for: ${group.name}.\n`,
    );
  }

  ensureMemoryScaffold(group.folder);

  logger.info(
    { jid, name: group.name, folder: group.folder },
    'Group registered',
  );
}

function migrateCompactionSummariesFromSoul(): void {
  const groupFolders = new Set<string>();
  for (const group of Object.values(registeredGroups)) {
    groupFolders.add(group.folder);
  }
  groupFolders.add(MAIN_GROUP_FOLDER);
  groupFolders.add('global');

  let movedSections = 0;
  for (const groupFolder of groupFolders) {
    try {
      const result = migrateCompactionsForGroup(groupFolder);
      movedSections += result.movedSections;
    } catch (err) {
      logger.debug(
        { groupFolder, err },
        'Compaction summary migration skipped for group',
      );
    }
  }

  if (movedSections > 0) {
    logger.info(
      { movedSections, groupCount: groupFolders.size },
      'Migrated legacy compaction summaries from SOUL.md to MEMORY.md',
    );
  }
}

function migrateLegacyClaudeMemoryFiles(): void {
  // Best-effort migration: if a group folder has CLAUDE.md but no SOUL.md,
  // rename it to SOUL.md to avoid split-brain naming.
  const groupsRoot = path.join(DATA_DIR, '..', 'groups');
  try {
    if (!fs.existsSync(groupsRoot)) return;
    const entries = fs.readdirSync(groupsRoot);
    for (const folder of entries) {
      const dir = path.join(groupsRoot, folder);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(dir);
      } catch {
        continue;
      }
      if (!stat.isDirectory()) continue;

      const soul = path.join(dir, 'SOUL.md');
      const legacy = path.join(dir, 'CLAUDE.md');
      if (fs.existsSync(soul) || !fs.existsSync(legacy)) continue;

      try {
        fs.renameSync(legacy, soul);
      } catch {
        try {
          fs.copyFileSync(legacy, soul);
        } catch {
          /* ignore */
        }
      }
    }
  } catch (err) {
    logger.debug({ err }, 'Legacy CLAUDE.md migration skipped');
  }
}

function maybeRegisterWhatsAppMainChat(): void {
  // Bootstrap: if the user hasn't registered a main group yet, default the
  // WhatsApp self-chat to "main" so there's always an admin/control channel.
  //
  // WhatsApp now sometimes uses LID JIDs for self-chats; we always register the
  // phone JID form (<phone>@s.whatsapp.net) because incoming messages are
  // translated to that form via translateJid().
  if (!sock?.user?.id) return;
  if (hasMainGroup()) return;

  const phoneUser = sock.user.id.split(':')[0];
  if (!phoneUser) return;

  const selfChatJid = `${phoneUser}@s.whatsapp.net`;
  registerGroup(selfChatJid, {
    name: `${ASSISTANT_NAME} (main)`,
    folder: MAIN_GROUP_FOLDER,
    trigger: `@${ASSISTANT_NAME}`,
    added_at: new Date().toISOString(),
  });
}

/**
 * Sync group metadata from WhatsApp.
 * Fetches all participating groups and stores their names in the database.
 * Called on startup, daily, and on-demand via IPC.
 */
async function syncGroupMetadata(force = false): Promise<void> {
  // Check if we need to sync (skip if synced recently, unless forced)
  if (!force) {
    const lastSync = getLastGroupSync();
    if (lastSync) {
      const lastSyncTime = new Date(lastSync).getTime();
      const now = Date.now();
      if (now - lastSyncTime < GROUP_SYNC_INTERVAL_MS) {
        logger.debug({ lastSync }, 'Skipping group sync - synced recently');
        return;
      }
    }
  }

  try {
    logger.info('Syncing group metadata from WhatsApp...');
    const groups = await sock.groupFetchAllParticipating();

    let count = 0;
    for (const [jid, metadata] of Object.entries(groups)) {
      if (metadata.subject) {
        updateChatName(jid, metadata.subject);
        count++;
      }
    }

    setLastGroupSync();
    logger.info({ count }, 'Group metadata synced');
  } catch (err) {
    logger.error({ err }, 'Failed to sync group metadata');
  }
}

/**
 * Get available groups list for the agent.
 * Returns groups ordered by most recent activity.
 */
function getAvailableGroups(): AvailableGroup[] {
  const chats = getAllChats();
  const registeredJids = new Set(Object.keys(registeredGroups));

  return chats
    .filter(
      (c) =>
        c.jid !== '__group_sync__' &&
        (c.jid.endsWith('@g.us') || isTelegramJid(c.jid)),
    )
    .map((c) => ({
      jid: c.jid,
      name: c.name,
      lastActivity: c.last_message_time,
      isRegistered: registeredJids.has(c.jid),
    }));
}

function maybeRegisterTelegramChat(chatJid: string, chatName: string): boolean {
  if (!TELEGRAM_AUTO_REGISTER) return false;
  if (registeredGroups[chatJid]) return false;

  const chatId = parseTelegramChatId(chatJid);
  if (!chatId) return false;

  const isMain = TELEGRAM_MAIN_CHAT_ID && chatId === TELEGRAM_MAIN_CHAT_ID;
  const folder = isMain ? MAIN_GROUP_FOLDER : `telegram-${chatId}`;

  registerGroup(chatJid, {
    name: chatName,
    folder,
    trigger: `@${ASSISTANT_NAME}`,
    added_at: new Date().toISOString(),
  });
  return true;
}

function hasMainGroup(): boolean {
  return Object.values(registeredGroups).some(
    (g) => g.folder === MAIN_GROUP_FOLDER,
  );
}

function promoteChatToMain(chatJid: string, chatName: string): void {
  const prev = registeredGroups[chatJid];
  if (prev?.folder === MAIN_GROUP_FOLDER) return;

  if (hasMainGroup()) {
    logger.warn(
      { chatJid },
      'Cannot promote to main: another main group already exists',
    );
    return;
  }

  if (prev && prev.folder !== MAIN_GROUP_FOLDER) {
    // Best-effort folder migration so memory/logs aren't orphaned.
    const oldDir = path.join(DATA_DIR, '..', 'groups', prev.folder);
    const newDir = path.join(DATA_DIR, '..', 'groups', MAIN_GROUP_FOLDER);
    try {
      if (fs.existsSync(oldDir) && !fs.existsSync(newDir)) {
        fs.renameSync(oldDir, newDir);
      }
    } catch (err) {
      logger.warn(
        { err, oldDir, newDir },
        'Failed to migrate group folder to main',
      );
    }
  }

  registerGroup(chatJid, {
    name: chatName || `${ASSISTANT_NAME} (main)`,
    folder: MAIN_GROUP_FOLDER,
    trigger: `@${ASSISTANT_NAME}`,
    added_at: new Date().toISOString(),
    containerConfig: prev?.containerConfig,
  });
}

function maybePromoteConfiguredTelegramMain(): void {
  // If a Telegram main chat is configured via env var, promote/migrate the
  // corresponding registered chat to main on startup.
  if (!TELEGRAM_MAIN_CHAT_ID) return;
  const chatJid = `telegram:${TELEGRAM_MAIN_CHAT_ID}`;
  const prev = registeredGroups[chatJid];
  if (!prev) return;
  if (prev.folder === MAIN_GROUP_FOLDER) return;

  promoteChatToMain(chatJid, prev.name || `${ASSISTANT_NAME} (main)`);
}

function isMainChat(chatJid: string): boolean {
  return registeredGroups[chatJid]?.folder === MAIN_GROUP_FOLDER;
}

function parseTelegramTargetJid(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (isTelegramJid(value)) {
    return parseTelegramChatId(value) ? value : null;
  }
  if (/^-?\d+$/.test(value)) {
    return `telegram:${value}`;
  }
  return null;
}

function findMainTelegramChatJid(): string | null {
  for (const [jid, group] of Object.entries(registeredGroups)) {
    if (group.folder === MAIN_GROUP_FOLDER && isTelegramJid(jid)) {
      return jid;
    }
  }
  return null;
}

function findMainChatJid(): string | null {
  for (const [jid, group] of Object.entries(registeredGroups)) {
    if (group.folder === MAIN_GROUP_FOLDER) return jid;
  }
  return null;
}

function normalizeThinkLevel(raw: string): ThinkLevel | undefined {
  const key = raw.trim().toLowerCase();
  if (!key) return undefined;
  if (key === 'off') return 'off';
  if (['on', 'enable', 'enabled'].includes(key)) return 'low';
  if (['min', 'minimal'].includes(key)) return 'minimal';
  if (['low'].includes(key)) return 'low';
  if (['mid', 'med', 'medium'].includes(key)) return 'medium';
  if (['high', 'max', 'ultra'].includes(key)) return 'high';
  if (['xhigh', 'x-high', 'x_high'].includes(key)) return 'xhigh';
  return undefined;
}

function normalizeReasoningLevel(raw: string): ReasoningLevel | undefined {
  const key = raw.trim().toLowerCase();
  if (!key) return undefined;
  if (['off', 'false', 'no', '0'].includes(key)) return 'off';
  if (['on', 'true', 'yes', '1'].includes(key)) return 'on';
  if (['stream', 'streaming', 'live'].includes(key)) return 'stream';
  return undefined;
}

function normalizeQueueMode(raw: string): QueueMode | undefined {
  const key = raw.trim().toLowerCase();
  if (
    key === 'collect' ||
    key === 'interrupt' ||
    key === 'followup' ||
    key === 'steer' ||
    key === 'steer-backlog'
  ) {
    return key;
  }
  return undefined;
}

function normalizeQueueDrop(raw: string): QueueDropPolicy | undefined {
  const key = raw.trim().toLowerCase();
  if (key === 'old' || key === 'new' || key === 'summarize') return key;
  return undefined;
}

function parseDurationMs(raw: string): number | undefined {
  const value = raw.trim().toLowerCase();
  if (!value) return undefined;
  if (/^\d+$/.test(value)) {
    const ms = Number.parseInt(value, 10);
    return Number.isFinite(ms) && ms >= 0 ? ms : undefined;
  }
  const match = value.match(/^(\d+)(ms|s|m|h)$/);
  if (!match) return undefined;
  const amount = Number.parseInt(match[1] || '0', 10);
  const unit = match[2];
  if (!Number.isFinite(amount) || amount < 0) return undefined;
  if (unit === 'ms') return amount;
  if (unit === 's') return amount * 1000;
  if (unit === 'm') return amount * 60_000;
  if (unit === 'h') return amount * 60 * 60_000;
  return undefined;
}

function parseQueueArgs(argText: string): {
  mode?: QueueMode;
  debounceMs?: number;
  cap?: number;
  drop?: QueueDropPolicy;
  reset?: boolean;
} {
  const trimmed = argText.trim();
  if (!trimmed) return {};

  const tokens = trimmed.split(/\s+/).filter(Boolean);
  let mode: QueueMode | undefined;
  let debounceMs: number | undefined;
  let cap: number | undefined;
  let drop: QueueDropPolicy | undefined;
  let reset = false;

  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (['reset', 'default', 'clear'].includes(lower)) {
      reset = true;
      continue;
    }
    const modeValue = normalizeQueueMode(lower);
    if (modeValue) {
      mode = modeValue;
      continue;
    }
    if (lower.startsWith('mode=')) {
      const value = normalizeQueueMode(lower.slice('mode='.length));
      if (value) mode = value;
      continue;
    }
    if (lower.startsWith('debounce=')) {
      const parsed = parseDurationMs(lower.slice('debounce='.length));
      if (typeof parsed === 'number') debounceMs = parsed;
      continue;
    }
    if (lower.startsWith('cap=')) {
      const parsed = Number.parseInt(lower.slice('cap='.length), 10);
      if (Number.isFinite(parsed) && parsed > 0) cap = parsed;
      continue;
    }
    if (lower.startsWith('drop=')) {
      const parsed = normalizeQueueDrop(lower.slice('drop='.length));
      if (parsed) drop = parsed;
      continue;
    }
  }

  return { mode, debounceMs, cap, drop, reset };
}

function compactChatRunPreferences(prefs: ChatRunPreferences): ChatRunPreferences | null {
  const next: ChatRunPreferences = {};
  if (prefs.provider?.trim()) next.provider = prefs.provider.trim();
  if (prefs.model?.trim()) next.model = prefs.model.trim();
  if (prefs.thinkLevel && prefs.thinkLevel !== 'off') next.thinkLevel = prefs.thinkLevel;
  if (prefs.reasoningLevel && prefs.reasoningLevel !== 'off') {
    next.reasoningLevel = prefs.reasoningLevel;
  }
  if (prefs.queueMode && prefs.queueMode !== 'collect') next.queueMode = prefs.queueMode;
  if (
    typeof prefs.queueDebounceMs === 'number' &&
    Number.isFinite(prefs.queueDebounceMs) &&
    prefs.queueDebounceMs > 0
  ) {
    next.queueDebounceMs = Math.floor(prefs.queueDebounceMs);
  }
  if (
    typeof prefs.queueCap === 'number' &&
    Number.isFinite(prefs.queueCap) &&
    prefs.queueCap > 0
  ) {
    next.queueCap = Math.floor(prefs.queueCap);
  }
  if (prefs.queueDrop && prefs.queueDrop !== 'old') next.queueDrop = prefs.queueDrop;
  if (prefs.freeChat === true) next.freeChat = true;
  if (prefs.nextRunNoContinue) next.nextRunNoContinue = true;
  return Object.keys(next).length > 0 ? next : null;
}

function updateChatRunPreferences(
  chatJid: string,
  updater: (current: ChatRunPreferences) => ChatRunPreferences,
): ChatRunPreferences {
  const current = chatRunPreferences[chatJid] || {};
  const updated = updater({ ...current });
  const compacted = compactChatRunPreferences(updated);
  if (compacted) {
    chatRunPreferences[chatJid] = compacted;
  } else {
    delete chatRunPreferences[chatJid];
  }
  saveState();
  return chatRunPreferences[chatJid] || {};
}

function consumeNextRunNoContinue(chatJid: string): boolean {
  const current = chatRunPreferences[chatJid];
  if (!current?.nextRunNoContinue) return false;
  updateChatRunPreferences(chatJid, (prefs) => {
    delete prefs.nextRunNoContinue;
    return prefs;
  });
  return true;
}

function getEffectiveModelLabel(chatJid: string): string {
  const prefs = chatRunPreferences[chatJid] || {};
  const provider = prefs.provider || process.env.PI_API || '(default-provider)';
  const model = prefs.model || process.env.PI_MODEL || '(default-model)';
  return `${provider}/${model}`;
}

function formatChatRuntimePreferences(chatJid: string): string[] {
  const prefs = chatRunPreferences[chatJid] || {};
  const think = prefs.thinkLevel || 'off';
  const reasoning = prefs.reasoningLevel || 'off';
  const freeChat = prefs.freeChat ? 'yes' : 'no';
  const newPending = prefs.nextRunNoContinue ? 'yes' : 'no';
  const queueMode = prefs.queueMode || 'collect';
  const queueDebounce = prefs.queueDebounceMs || 0;
  const queueCap = prefs.queueCap || 0;
  const queueDrop = prefs.queueDrop || 'old';
  return [
    `- chat_model: ${getEffectiveModelLabel(chatJid)}`,
    `- chat_think: ${think}`,
    `- chat_reasoning: ${reasoning}`,
    `- chat_free_chat: ${freeChat}`,
    `- chat_queue: mode=${queueMode} debounce_ms=${queueDebounce} cap=${queueCap} drop=${queueDrop}`,
    `- chat_new_pending: ${newPending}`,
  ];
}

function updateChatUsage(chatJid: string, usage?: {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  provider?: string;
  model?: string;
}): void {
  const current = chatUsageStats[chatJid] || {
    runs: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    tokenReports: 0,
    updatedAt: 0,
  };

  current.runs += 1;
  if (usage) {
    const inTokens =
      typeof usage.inputTokens === 'number' && Number.isFinite(usage.inputTokens)
        ? Math.max(0, Math.floor(usage.inputTokens))
        : 0;
    const outTokens =
      typeof usage.outputTokens === 'number' && Number.isFinite(usage.outputTokens)
        ? Math.max(0, Math.floor(usage.outputTokens))
        : 0;
    const totalTokens =
      typeof usage.totalTokens === 'number' && Number.isFinite(usage.totalTokens)
        ? Math.max(0, Math.floor(usage.totalTokens))
        : inTokens + outTokens;

    if (inTokens > 0 || outTokens > 0 || totalTokens > 0) {
      current.tokenReports += 1;
      current.inputTokens += inTokens;
      current.outputTokens += outTokens;
      current.totalTokens += totalTokens;
    }
    if (usage.provider) current.lastProvider = usage.provider;
    if (usage.model) current.lastModel = usage.model;
  }
  current.updatedAt = Date.now();
  chatUsageStats[chatJid] = current;
  saveState();
}

function formatUsageText(chatJid: string, scope: 'chat' | 'all' = 'chat'): string {
  if (scope === 'all') {
    const rows = Object.entries(chatUsageStats);
    if (rows.length === 0) return 'No usage data collected yet.';
    let runs = 0;
    let reports = 0;
    let input = 0;
    let output = 0;
    let total = 0;
    for (const [, stats] of rows) {
      runs += stats.runs;
      reports += stats.tokenReports;
      input += stats.inputTokens;
      output += stats.outputTokens;
      total += stats.totalTokens;
    }
    return [
      'Usage (all chats):',
      `- chats: ${rows.length}`,
      `- runs: ${runs}`,
      `- token_reports: ${reports}`,
      `- input_tokens: ${input}`,
      `- output_tokens: ${output}`,
      `- total_tokens: ${total}`,
    ].join('\n');
  }

  const stats = chatUsageStats[chatJid];
  if (!stats) {
    return [
      'Usage (this chat):',
      '- runs: 0',
      '- token_reports: 0',
      '- input_tokens: 0',
      '- output_tokens: 0',
      '- total_tokens: 0',
      '',
      'Token usage appears after provider returns usage fields.',
    ].join('\n');
  }

  const lastModel =
    stats.lastProvider && stats.lastModel
      ? `${stats.lastProvider}/${stats.lastModel}`
      : stats.lastModel || getEffectiveModelLabel(chatJid);
  const updated = new Date(stats.updatedAt || Date.now()).toISOString();
  return [
    'Usage (this chat):',
    `- runs: ${stats.runs}`,
    `- token_reports: ${stats.tokenReports}`,
    `- input_tokens: ${stats.inputTokens}`,
    `- output_tokens: ${stats.outputTokens}`,
    `- total_tokens: ${stats.totalTokens}`,
    `- last_model: ${lastModel}`,
    `- updated_at: ${updated}`,
  ].join('\n');
}

function runPiListModels(searchText: string): { ok: boolean; text: string } {
  const args = ['--list-models'];
  const trimmed = searchText.trim();
  if (trimmed) args.push(trimmed);
  const result = spawnSync('pi', args, {
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 4 * 1024 * 1024,
  });

  if (result.error) {
    return {
      ok: false,
      text: `Failed to run pi --list-models: ${result.error.message}`,
    };
  }

  if (result.status !== 0) {
    const details = (result.stderr || result.stdout || '').trim();
    return {
      ok: false,
      text: details
        ? `pi --list-models failed:\n${details}`
        : `pi --list-models exited with code ${result.status ?? 'unknown'}`,
    };
  }

  const out = (result.stdout || '').trim();
  if (!out) {
    return {
      ok: true,
      text: trimmed
        ? `No models matched "${trimmed}".`
        : 'No models were returned by pi.',
    };
  }

  const bounded = out.length > 12000 ? `${out.slice(0, 12000)}\n\n...output truncated...` : out;
  return {
    ok: true,
    text: trimmed ? `Models matching "${trimmed}":\n${bounded}` : `Available models:\n${bounded}`,
  };
}

function normalizeTelegramCommandToken(token: string): TelegramCommandName | null {
  if (!token.startsWith('/')) return null;
  const normalized = token.split('@')[0]?.toLowerCase();
  if (!normalized) return null;
  const commandToken = normalized.split(':')[0] || normalized;
  const command = commandToken as TelegramCommandName;
  const known: Set<TelegramCommandName> = new Set([
    '/help',
    '/status',
    '/id',
    '/models',
    '/model',
    '/think',
    '/thinking',
    '/t',
    '/reasoning',
    '/reason',
    '/new',
    '/reset',
    '/stop',
    '/usage',
    '/queue',
    '/compact',
    '/subagents',
    '/main',
    '/tasks',
    '/task_pause',
    '/task_resume',
    '/task_cancel',
    '/groups',
    '/reload',
    '/panel',
    '/coder',
    '/coder-plan',
    '/coder_plan',
    '/freechat',
  ]);
  return known.has(command) ? command : null;
}

function formatHelpText(isMainGroup: boolean): string {
  const common = [
    '/help - show this help',
    '/status - runtime and queue status',
    '/id - show current Telegram chat id',
    '/models [query] - list/search available models',
    '/model [provider/model|reset] - show/set chat model',
    '/think [off|minimal|low|medium|high|xhigh] - set thinking level',
    '/reasoning [off|on|stream] - set reasoning visibility mode',
    '/new - start fresh session on next run',
    '/reset - alias for /new',
    '/stop - stop the current in-flight run',
    '/usage [all|reset] - usage counters',
    '/queue [mode/debounce/cap/drop] - queue policy for this chat',
    '/compact [instructions] - summarize + roll session',
  ];
  if (!isMainGroup) {
    return [
      'Telegram commands:',
      ...common,
      '',
      `Admin commands are only available in the main chat for safety.`,
    ].join('\n');
  }

  return [
    'Telegram commands (main/admin):',
    ...common,
    '/main <secret> - claim chat as main/admin',
    '/tasks - list scheduled tasks',
    '/task_pause <id> - pause task',
    '/task_resume <id> - resume task',
    '/task_cancel <id> - cancel task',
    '/groups - list registered groups',
    '/freechat add <chatId> - enable free chat in a non-main Telegram chat',
    '/freechat remove <chatId> - disable free chat in a non-main Telegram chat',
    '/freechat list - list chats with free chat enabled',
    '/reload - refresh command menus and group metadata',
    '/panel - open admin quick actions',
    '/coder <task> - explicit delegated coding run',
    '/coder-plan <task> - explicit delegated planning run',
    '/subagents list|stop|spawn - manage delegated subagent runs',
  ].join('\n');
}

function formatStatusText(chatJid?: string): string {
  const runtime = getContainerRuntime();
  const mainGroup = Object.values(registeredGroups).find(
    (group) => group.folder === MAIN_GROUP_FOLDER,
  );
  const tasks = getAllTasks();
  const active = tasks.filter((task) => task.status === 'active').length;
  const paused = tasks.filter((task) => task.status === 'paused').length;
  const completed = tasks.filter((task) => task.status === 'completed').length;
  const coderRuns = Array.from(activeCoderRuns.values()).sort(
    (a, b) => a.startedAt - b.startedAt,
  );
  const now = Date.now();

  const lines = [
    'FarmFriend status:',
    `- container_runtime: ${runtime}`,
    `- telegram_enabled: ${TELEGRAM_BOT_TOKEN ? 'yes' : 'no'}`,
    `- whatsapp_enabled: ${WHATSAPP_ENABLED ? 'yes' : 'no'}`,
    `- whatsapp_connected: ${sock?.user ? 'yes' : 'no'}`,
    `- registered_groups: ${Object.keys(registeredGroups).length}`,
    `- main_group: ${mainGroup ? mainGroup.name : 'none'}`,
    `- tasks_active: ${active}`,
    `- tasks_paused: ${paused}`,
    `- tasks_completed: ${completed}`,
    `- coder_runs_active: ${coderRuns.length}`,
  ];

  if (chatJid) {
    lines.push(...formatChatRuntimePreferences(chatJid));
    const usage = chatUsageStats[chatJid];
    if (usage) {
      lines.push(
        `- usage_runs: ${usage.runs}`,
        `- usage_total_tokens: ${usage.totalTokens}`,
      );
    }
    const activeRun = activeChatRuns.get(chatJid);
    if (activeRun) {
      const ageSeconds = Math.max(0, Math.floor((now - activeRun.startedAt) / 1000));
      lines.push(`- chat_run_active: yes (${ageSeconds}s)`);
    } else {
      lines.push('- chat_run_active: no');
    }
  }

  for (const run of coderRuns) {
    const ageSeconds = Math.max(0, Math.floor((now - run.startedAt) / 1000));
    lines.push(
      `- coder_run: ${run.requestId} mode=${run.mode} age=${ageSeconds}s chat=${run.chatJid} group=${run.groupName}`,
    );
  }

  return lines.join('\n');
}

function formatTasksText(): string {
  const tasks = getAllTasks();
  if (tasks.length === 0) {
    return 'No scheduled tasks found.';
  }
  const lines = tasks.slice(0, 30).map((task) => {
    const nextRun = task.next_run || 'n/a';
    return `- ${task.id} [${task.status}] group=${task.group_folder} next=${nextRun}`;
  });
  if (tasks.length > 30) {
    lines.push(`- ... ${tasks.length - 30} more`);
  }
  return ['Scheduled tasks:', ...lines].join('\n');
}

function formatGroupsText(): string {
  const groups = Object.entries(registeredGroups);
  if (groups.length === 0) {
    return 'No groups are registered.';
  }
  const lines = groups.map(([jid, group]) => {
    const mainTag = group.folder === MAIN_GROUP_FOLDER ? ' (main)' : '';
    return `- ${group.name}${mainTag} -> ${jid} [folder=${group.folder}]`;
  });
  return ['Registered groups:', ...lines].join('\n');
}

function buildAdminPanelKeyboard(): TelegramInlineKeyboard {
  return [
    [
      { text: 'Tasks', callbackData: 'panel:tasks' },
      { text: 'Coder', callbackData: 'panel:coder' },
    ],
    [
      { text: 'Groups', callbackData: 'panel:groups' },
      { text: 'Health', callbackData: 'panel:health' },
    ],
  ];
}

function formatActiveSubagentsText(): string {
  const runs: string[] = [];
  const now = Date.now();
  for (const [chatJid, run] of activeChatRuns.entries()) {
    const age = Math.max(0, Math.floor((now - run.startedAt) / 1000));
    runs.push(
      `- chat=${chatJid} request=${run.requestId || 'none'} age=${age}s`,
    );
  }
  if (runs.length === 0) return 'No active subagent runs.';
  return ['Active subagent runs:', ...runs].join('\n');
}

async function runCompactionForChat(
  chatJid: string,
  instructions: string,
): Promise<string> {
  const group = registeredGroups[chatJid];
  if (!group) return 'Cannot compact: chat is not registered.';
  if (activeChatRuns.has(chatJid)) {
    return 'Cannot compact while a run is active. Use /stop first, then retry /compact.';
  }

  const compactRequestId = `compact-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const compactPrompt = [
    '[SESSION COMPACTION REQUEST]',
    'Summarize this session for long-term memory.',
    'Output concise markdown with sections:',
    '- Summary',
    '- Decisions',
    '- Open Tasks',
    '- Important Paths/Files',
    instructions ? `Additional instructions: ${instructions}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const prefs: ChatRunPreferences = { ...(chatRunPreferences[chatJid] || {}) };
  delete prefs.nextRunNoContinue;
  const abortController = new AbortController();
  const activeRun: ActiveChatRun = {
    chatJid,
    startedAt: Date.now(),
    requestId: compactRequestId,
    abortController,
  };
  activeChatRuns.set(chatJid, activeRun);

  await setTyping(chatJid, true);
  try {
    const run = await runAgent(
      group,
      compactPrompt,
      chatJid,
      'none',
      compactRequestId,
      prefs,
      abortController.signal,
    );

    if (!run.ok) {
      return 'Compaction failed before completion.';
    }
    updateChatUsage(chatJid, run.usage);
    const summary = (run.result || '').trim();
    if (!summary) {
      return 'Compaction returned no summary text.';
    }

    const ts = new Date().toISOString();
    appendCompactionSummaryToMemory(group.folder, summary, ts);

    updateChatRunPreferences(chatJid, (current) => {
      current.nextRunNoContinue = true;
      return current;
    });

    const preview = summary.length > 1200 ? `${summary.slice(0, 1200)}\n\n...truncated...` : summary;
    return [
      `Compaction complete (${compactRequestId}).`,
      'Saved summary to /workspace/group/MEMORY.md and scheduled fresh next session.',
      '',
      preview,
    ].join('\n');
  } finally {
    await setTyping(chatJid, false);
    if (activeChatRuns.get(chatJid) === activeRun) {
      activeChatRuns.delete(chatJid);
    }
  }
}

function sanitizeFileName(value: string): string {
  const base = value.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_');
  return base.slice(0, 80) || 'file';
}

function defaultExtensionForMedia(message: TelegramInboundMessage): string {
  switch (message.media?.type) {
    case 'photo':
      return '.jpg';
    case 'video':
      return '.mp4';
    case 'voice':
      return '.ogg';
    case 'audio':
      return '.mp3';
    case 'document':
      return '.bin';
    case 'sticker':
      return '.webp';
    default:
      return '.bin';
  }
}

async function persistTelegramMedia(
  message: TelegramInboundMessage,
): Promise<string> {
  if (!message.media || !telegramBot) {
    return message.content;
  }

  const group = registeredGroups[message.chatJid];
  if (!group) {
    return message.content;
  }

  const hintedSize = message.media.fileSize;
  if (hintedSize && hintedSize > TELEGRAM_MEDIA_MAX_BYTES) {
    const mb = (hintedSize / (1024 * 1024)).toFixed(1);
    const maxMb = TELEGRAM_MEDIA_MAX_MB.toFixed(0);
    await sendMessage(
      message.chatJid,
      `Attachment rejected (${mb} MB). Max allowed is ${maxMb} MB.`,
    );
    logger.warn(
      { chatJid: message.chatJid, type: message.media.type, hintedSize },
      'Telegram media rejected by size hint',
    );
    return `${message.content}\n[Attachment rejected: size exceeds limit]`;
  }

  try {
    const downloaded = await telegramBot.downloadFile(message.media.fileId);
    if (downloaded.data.length > TELEGRAM_MEDIA_MAX_BYTES) {
      const mb = (downloaded.data.length / (1024 * 1024)).toFixed(1);
      const maxMb = TELEGRAM_MEDIA_MAX_MB.toFixed(0);
      await sendMessage(
        message.chatJid,
        `Attachment rejected (${mb} MB). Max allowed is ${maxMb} MB.`,
      );
      logger.warn(
        { chatJid: message.chatJid, type: message.media.type, size: downloaded.data.length },
        'Telegram media rejected by downloaded size',
      );
      return `${message.content}\n[Attachment rejected: size exceeds limit]`;
    }

    const inboxDir = path.join(
      DATA_DIR,
      '..',
      'groups',
      group.folder,
      'inbox',
      'telegram',
    );
    fs.mkdirSync(inboxDir, { recursive: true });

    const suggestedName =
      message.media.fileName ||
      path.basename(downloaded.filePath) ||
      `telegram_${message.media.type}`;
    const parsedName = path.parse(suggestedName);
    const stem = sanitizeFileName(parsedName.name || suggestedName);
    const ext =
      parsedName.ext ||
      path.extname(downloaded.filePath) ||
      defaultExtensionForMedia(message);
    const ts = message.timestamp.replace(/[:.]/g, '-');
    const fileName = `${ts}_${message.messageId}_${stem}${ext}`;
    const hostPath = path.join(inboxDir, fileName);
    fs.writeFileSync(hostPath, downloaded.data);

    const workspacePath = `/workspace/group/inbox/telegram/${fileName}`;
    logger.info(
      {
        chatJid: message.chatJid,
        type: message.media.type,
        size: downloaded.data.length,
        workspacePath,
      },
      'Telegram media stored',
    );

    return [
      message.content,
      `[Attachment type=${message.media.type} path=${workspacePath} size=${downloaded.data.length}]`,
    ].join('\n');
  } catch (err) {
    logger.error(
      { err, chatJid: message.chatJid, mediaType: message.media.type },
      'Failed to persist Telegram media',
    );
    return `${message.content}\n[Attachment download failed]`;
  }
}

async function refreshTelegramCommandMenus(): Promise<void> {
  if (!telegramBot) return;

  try {
    const common = TELEGRAM_COMMON_COMMANDS.map((command) => ({
      command: command.command,
      description: command.description,
    }));
    const admin = [...common, ...TELEGRAM_ADMIN_COMMANDS].map((command) => ({
      command: command.command,
      description: command.description,
    }));

    const mainTelegramJid = findMainTelegramChatJid();
    const mainChatId = mainTelegramJid ? parseTelegramChatId(mainTelegramJid) : null;

    try {
      await telegramBot.deleteCommands({ type: 'default' });
    } catch (err) {
      logger.debug({ err }, 'Failed deleting default Telegram commands');
    }

    try {
      await telegramBot.setCommands(common, { type: 'default' });
    } catch (err) {
      logger.warn(
        { err },
        'Failed setting default Telegram commands; continuing without command menu refresh',
      );
    }

    if (lastTelegramMenuMainChatId && lastTelegramMenuMainChatId !== mainChatId) {
      try {
        await telegramBot.setCommands(common, {
          type: 'chat',
          chatId: lastTelegramMenuMainChatId,
        });
      } catch (err) {
        logger.debug({ err }, 'Failed resetting previous main Telegram command scope');
      }
    }

    if (mainChatId) {
      try {
        await telegramBot.setCommands(admin, { type: 'chat', chatId: mainChatId });
      } catch (err) {
        logger.warn(
          { err, mainChatId },
          'Failed setting admin Telegram commands for main chat; continuing',
        );
      }
    }

    lastTelegramMenuMainChatId = mainChatId;

    try {
      await telegramBot.setDescription(
        `${ASSISTANT_NAME}: secure containerized assistant`,
        'Use /help for commands',
      );
    } catch (err) {
      logger.debug({ err }, 'Failed setting Telegram bot descriptions');
    }
  } catch (err) {
    logger.warn(
      { err },
      'Telegram command menu refresh failed; startup and polling will continue',
    );
  }
}

function logTelegramCommandAudit(
  chatJid: string,
  command: string,
  allowed: boolean,
  reason: string,
): void {
  logger.info(
    { chatJid, command, allowed, reason },
    'Telegram command audit',
  );
}

async function handleTelegramCallbackQuery(
  q: TelegramInboundCallbackQuery,
): Promise<void> {
  if (!telegramBot) return;

  try {
    await telegramBot.answerCallbackQuery(q.id);
  } catch (err) {
    logger.debug({ err, callbackId: q.id }, 'Failed answering callback query');
  }

  if (!q.data.startsWith('panel:')) {
    return;
  }

  if (!isMainChat(q.chatJid)) {
    logTelegramCommandAudit(q.chatJid, q.data, false, 'non-main chat');
    await sendMessage(
      q.chatJid,
      `${ASSISTANT_NAME}: admin panel actions are only available in the main/admin chat.`,
    );
    return;
  }

  switch (q.data) {
    case 'panel:tasks':
      logTelegramCommandAudit(q.chatJid, q.data, true, 'ok');
      await sendMessage(q.chatJid, formatTasksText());
      return;
    case 'panel:coder':
      logTelegramCommandAudit(q.chatJid, q.data, true, 'ok');
      await sendMessage(
        q.chatJid,
        [
          'Coder delegation:',
          '- /coder <task> to execute',
          '- /coder-plan <task> for read-only plan',
          '- use coding agent',
        ].join('\n'),
      );
      return;
    case 'panel:groups':
      logTelegramCommandAudit(q.chatJid, q.data, true, 'ok');
      await sendMessage(q.chatJid, formatGroupsText());
      return;
    case 'panel:health':
      logTelegramCommandAudit(q.chatJid, q.data, true, 'ok');
      await sendMessage(q.chatJid, formatStatusText(q.chatJid));
      return;
    default:
      return;
  }
}

async function handleTelegramCommand(m: {
  chatJid: string;
  chatName: string;
  content: string;
}): Promise<boolean> {
  const content = m.content.trim();
  if (!content.startsWith('/')) return false;

  const [rawCmd, ...restTokens] = content.split(/\s+/);
  const cmd = normalizeTelegramCommandToken(rawCmd);
  if (!cmd) return false;
  const colonArg = (() => {
    const atSplit = rawCmd.split('@')[0] || rawCmd;
    const colonIndex = atSplit.indexOf(':');
    if (colonIndex === -1) return null;
    const value = atSplit.slice(colonIndex + 1).trim();
    return value || null;
  })();
  const rest = colonArg ? [colonArg, ...restTokens] : restTokens;
  const isMainGroup = isMainChat(m.chatJid);

  if (cmd === '/id') {
    logTelegramCommandAudit(m.chatJid, cmd, true, 'ok');
    const chatId = parseTelegramChatId(m.chatJid);
    await sendMessage(
      m.chatJid,
      chatId
        ? `Chat id: ${chatId}`
        : 'Could not parse chat id for this chat.',
    );
    return true;
  }

  if (cmd === '/help') {
    logTelegramCommandAudit(m.chatJid, cmd, true, 'ok');
    await sendMessage(m.chatJid, formatHelpText(isMainGroup));
    return true;
  }

  if (cmd === '/status') {
    logTelegramCommandAudit(m.chatJid, cmd, true, 'ok');
    await sendMessage(m.chatJid, formatStatusText(m.chatJid));
    return true;
  }

  if (cmd === '/models') {
    logTelegramCommandAudit(m.chatJid, cmd, true, 'ok');
    const searchText = rest.join(' ');
    const listed = runPiListModels(searchText);
    await sendMessage(m.chatJid, listed.text);
    return true;
  }

  if (cmd === '/model') {
    const argText = rest.join(' ').trim();
    if (!argText) {
      logTelegramCommandAudit(m.chatJid, cmd, true, 'show');
      const prefs = chatRunPreferences[m.chatJid] || {};
      const override = prefs.provider || prefs.model;
      await sendMessage(
        m.chatJid,
        override
          ? `Current model override: ${getEffectiveModelLabel(m.chatJid)}`
          : `Current model: ${getEffectiveModelLabel(m.chatJid)}\n(no override set; using env defaults)`,
      );
      return true;
    }

    const lowered = argText.toLowerCase();
    if (['reset', 'default', 'clear', 'off'].includes(lowered)) {
      updateChatRunPreferences(m.chatJid, (prefs) => {
        delete prefs.provider;
        delete prefs.model;
        return prefs;
      });
      logTelegramCommandAudit(m.chatJid, cmd, true, 'reset');
      await sendMessage(
        m.chatJid,
        `Model override cleared. Active model: ${getEffectiveModelLabel(m.chatJid)}`,
      );
      return true;
    }

    let nextProvider: string | undefined;
    let nextModel: string | undefined;
    if (argText.includes('/')) {
      const slash = argText.indexOf('/');
      const provider = argText.slice(0, slash).trim();
      const model = argText.slice(slash + 1).trim();
      if (!provider || !model) {
        logTelegramCommandAudit(m.chatJid, cmd, false, 'invalid model ref');
        await sendMessage(m.chatJid, 'Usage: /model <provider/model> or /model reset');
        return true;
      }
      nextProvider = provider;
      nextModel = model;
    } else {
      nextModel = argText;
    }

    updateChatRunPreferences(m.chatJid, (prefs) => {
      if (nextProvider) {
        prefs.provider = nextProvider;
      } else {
        delete prefs.provider;
      }
      if (nextModel) {
        prefs.model = nextModel;
      }
      return prefs;
    });

    logTelegramCommandAudit(m.chatJid, cmd, true, 'set');
    await sendMessage(
      m.chatJid,
      `Model set for this chat: ${getEffectiveModelLabel(m.chatJid)}`,
    );
    return true;
  }

  if (cmd === '/think' || cmd === '/thinking' || cmd === '/t') {
    const argText = rest.join(' ').trim();
    if (!argText) {
      const current = chatRunPreferences[m.chatJid]?.thinkLevel || 'off';
      logTelegramCommandAudit(m.chatJid, cmd, true, 'show');
      await sendMessage(m.chatJid, `Current thinking level: ${current}`);
      return true;
    }

    const normalized = normalizeThinkLevel(argText);
    if (!normalized) {
      logTelegramCommandAudit(m.chatJid, cmd, false, 'invalid think level');
      await sendMessage(
        m.chatJid,
        'Unrecognized thinking level. Valid: off, minimal, low, medium, high, xhigh',
      );
      return true;
    }

    updateChatRunPreferences(m.chatJid, (prefs) => {
      if (normalized === 'off') delete prefs.thinkLevel;
      else prefs.thinkLevel = normalized;
      return prefs;
    });
    logTelegramCommandAudit(m.chatJid, cmd, true, 'set');
    await sendMessage(
      m.chatJid,
      normalized === 'off'
        ? 'Thinking disabled for this chat.'
        : `Thinking level set to ${normalized}.`,
    );
    return true;
  }

  if (cmd === '/reasoning' || cmd === '/reason') {
    const argText = rest.join(' ').trim();
    if (!argText) {
      const current = chatRunPreferences[m.chatJid]?.reasoningLevel || 'off';
      logTelegramCommandAudit(m.chatJid, cmd, true, 'show');
      await sendMessage(m.chatJid, `Current reasoning level: ${current}`);
      return true;
    }

    const normalized = normalizeReasoningLevel(argText);
    if (!normalized) {
      logTelegramCommandAudit(m.chatJid, cmd, false, 'invalid reasoning level');
      await sendMessage(
        m.chatJid,
        'Unrecognized reasoning level. Valid: off, on, stream',
      );
      return true;
    }

    updateChatRunPreferences(m.chatJid, (prefs) => {
      if (normalized === 'off') delete prefs.reasoningLevel;
      else prefs.reasoningLevel = normalized;
      return prefs;
    });
    logTelegramCommandAudit(m.chatJid, cmd, true, 'set');
    await sendMessage(
      m.chatJid,
      normalized === 'off'
        ? 'Reasoning visibility disabled.'
        : normalized === 'stream'
          ? 'Reasoning stream enabled for this chat.'
          : 'Reasoning visibility enabled for this chat.',
    );
    return true;
  }

  if (cmd === '/new' || cmd === '/reset') {
    updateChatRunPreferences(m.chatJid, (prefs) => {
      prefs.nextRunNoContinue = true;
      return prefs;
    });
    logTelegramCommandAudit(m.chatJid, cmd, true, 'ok');
    await sendMessage(
      m.chatJid,
      'New session requested. The next model run will start fresh (no /continue).',
    );
    return true;
  }

  if (cmd === '/stop') {
    const activeRun = activeChatRuns.get(m.chatJid);
    if (!activeRun) {
      logTelegramCommandAudit(m.chatJid, cmd, true, 'no active run');
      await sendMessage(m.chatJid, 'No active run to stop.');
      return true;
    }

    activeRun.abortController.abort(
      new Error('Stopped by user via /stop'),
    );
    logTelegramCommandAudit(m.chatJid, cmd, true, 'aborted');
    await sendMessage(m.chatJid, 'Stopping current run...');
    return true;
  }

  if (cmd === '/usage') {
    const arg = rest.join(' ').trim().toLowerCase();
    if (arg === 'reset' || arg === 'clear') {
      delete chatUsageStats[m.chatJid];
      saveState();
      logTelegramCommandAudit(m.chatJid, cmd, true, 'reset');
      await sendMessage(m.chatJid, 'Usage counters reset for this chat.');
      return true;
    }
    if (arg === 'all') {
      logTelegramCommandAudit(m.chatJid, cmd, true, 'all');
      await sendMessage(m.chatJid, formatUsageText(m.chatJid, 'all'));
      return true;
    }
    logTelegramCommandAudit(m.chatJid, cmd, true, 'show');
    await sendMessage(m.chatJid, formatUsageText(m.chatJid, 'chat'));
    return true;
  }

  if (cmd === '/queue') {
    const argText = rest.join(' ').trim();
    if (!argText) {
      const prefs = chatRunPreferences[m.chatJid] || {};
      const mode = prefs.queueMode || 'collect';
      const debounce = prefs.queueDebounceMs || 0;
      const cap = prefs.queueCap || 0;
      const drop = prefs.queueDrop || 'old';
      logTelegramCommandAudit(m.chatJid, cmd, true, 'show');
      await sendMessage(
        m.chatJid,
        [
          'Queue settings (this chat):',
          `- mode: ${mode}`,
          `- debounce_ms: ${debounce}`,
          `- cap: ${cap}`,
          `- drop: ${drop}`,
          '',
          'Usage: /queue mode=<collect|interrupt|followup|steer|steer-backlog> debounce=<500ms|2s|1m> cap=<n> drop=<old|new|summarize>',
        ].join('\n'),
      );
      return true;
    }

    const parsed = parseQueueArgs(argText);
    if (parsed.reset) {
      updateChatRunPreferences(m.chatJid, (prefs) => {
        delete prefs.queueMode;
        delete prefs.queueDebounceMs;
        delete prefs.queueCap;
        delete prefs.queueDrop;
        return prefs;
      });
      logTelegramCommandAudit(m.chatJid, cmd, true, 'reset');
      await sendMessage(m.chatJid, 'Queue settings reset to defaults.');
      return true;
    }

    if (
      parsed.mode === undefined &&
      parsed.debounceMs === undefined &&
      parsed.cap === undefined &&
      parsed.drop === undefined
    ) {
      logTelegramCommandAudit(m.chatJid, cmd, false, 'invalid args');
      await sendMessage(
        m.chatJid,
        'Invalid /queue args. Example: /queue mode=followup debounce=2s cap=20 drop=old',
      );
      return true;
    }

    updateChatRunPreferences(m.chatJid, (prefs) => {
      if (parsed.mode) prefs.queueMode = parsed.mode;
      if (typeof parsed.debounceMs === 'number') prefs.queueDebounceMs = parsed.debounceMs;
      if (typeof parsed.cap === 'number') prefs.queueCap = parsed.cap;
      if (parsed.drop) prefs.queueDrop = parsed.drop;
      return prefs;
    });
    const prefs = chatRunPreferences[m.chatJid] || {};
    logTelegramCommandAudit(m.chatJid, cmd, true, 'set');
    await sendMessage(
      m.chatJid,
      [
        'Queue settings updated:',
        `- mode: ${prefs.queueMode || 'collect'}`,
        `- debounce_ms: ${prefs.queueDebounceMs || 0}`,
        `- cap: ${prefs.queueCap || 0}`,
        `- drop: ${prefs.queueDrop || 'old'}`,
      ].join('\n'),
    );
    return true;
  }

  if (cmd === '/compact') {
    const instructions = rest.join(' ').trim();
    logTelegramCommandAudit(m.chatJid, cmd, true, 'run');
    const response = await runCompactionForChat(m.chatJid, instructions);
    await sendMessage(m.chatJid, response);
    return true;
  }

  if (cmd === '/coder' || cmd === '/coder-plan' || cmd === '/coder_plan') {
    if (!isMainGroup) {
      logTelegramCommandAudit(m.chatJid, cmd, false, 'non-main chat');
      await sendMessage(
        m.chatJid,
        `${ASSISTANT_NAME}: coder delegation is only available in the main/admin chat for safety.`,
      );
      return true;
    }
    logTelegramCommandAudit(m.chatJid, cmd, true, 'pass-through');
    // Let the normal agent path process /coder and /coder-plan.
    return false;
  }

  if (cmd === '/main') {
    const chatId = parseTelegramChatId(m.chatJid);
    if (!chatId) {
      logTelegramCommandAudit(m.chatJid, cmd, false, 'invalid chat id');
      await sendMessage(m.chatJid, 'Could not parse chat id for this chat.');
      return true;
    }

    // If main is already configured, don't let random chats steal it.
    const existingMain = hasMainGroup();
    const alreadyMain =
      registeredGroups[m.chatJid]?.folder === MAIN_GROUP_FOLDER;
    if (existingMain && !alreadyMain) {
      logTelegramCommandAudit(m.chatJid, cmd, false, 'main already configured');
      await sendMessage(
        m.chatJid,
        'Main chat is already set. If you want to change it, edit data/registered_groups.json (or delete it to re-bootstrap).',
      );
      return true;
    }

    if (!TELEGRAM_ADMIN_SECRET) {
      logTelegramCommandAudit(m.chatJid, cmd, false, 'missing TELEGRAM_ADMIN_SECRET');
      await sendMessage(
        m.chatJid,
        'TELEGRAM_ADMIN_SECRET is not set on the host. Set it, restart, then run: /main <secret>',
      );
      return true;
    }

    const provided = rest.join(' ');
    if (!provided || provided !== TELEGRAM_ADMIN_SECRET) {
      logTelegramCommandAudit(m.chatJid, cmd, false, 'invalid admin secret');
      await sendMessage(
        m.chatJid,
        'Unauthorized. Usage: /main <secret>',
      );
      return true;
    }

    promoteChatToMain(m.chatJid, m.chatName || `${ASSISTANT_NAME} (main)`);
    await refreshTelegramCommandMenus();
    logTelegramCommandAudit(m.chatJid, cmd, true, 'ok');

    await sendMessage(
      m.chatJid,
      'This chat is now the main/admin channel.',
    );
    return true;
  }

  if (!isMainGroup) {
    logTelegramCommandAudit(m.chatJid, cmd, false, 'non-main chat');
    await sendMessage(
      m.chatJid,
      `${ASSISTANT_NAME}: this command is only available in the main/admin chat.`,
    );
    return true;
  }

  if (cmd === '/freechat') {
    const action = (rest[0] || '').toLowerCase();
    if (!action || action === 'help') {
      logTelegramCommandAudit(m.chatJid, cmd, true, 'help');
      await sendMessage(
        m.chatJid,
        [
          'Free chat admin (main only):',
          '- /freechat list',
          '- /freechat add <chatId|telegram:<chatId>>',
          '- /freechat remove <chatId|telegram:<chatId>>',
        ].join('\n'),
      );
      return true;
    }

    if (action === 'list') {
      const entries = Object.entries(chatRunPreferences)
        .filter(([, prefs]) => prefs.freeChat === true)
        .map(([jid]) => {
          const group = registeredGroups[jid];
          const name = group?.name || '(unregistered)';
          const mainTag = group?.folder === MAIN_GROUP_FOLDER ? ' (main)' : '';
          return `- ${jid} -> ${name}${mainTag}`;
        })
        .sort();

      logTelegramCommandAudit(m.chatJid, cmd, true, 'list');
      await sendMessage(
        m.chatJid,
        entries.length > 0
          ? ['Free chat enabled for:', ...entries].join('\n')
          : 'No chats currently have free chat enabled.',
      );
      return true;
    }

    if (action !== 'add' && action !== 'remove') {
      logTelegramCommandAudit(m.chatJid, cmd, false, 'invalid action');
      await sendMessage(
        m.chatJid,
        'Usage: /freechat add <chatId> | /freechat remove <chatId> | /freechat list',
      );
      return true;
    }

    const targetRaw = rest[1] || '';
    const targetJid = parseTelegramTargetJid(targetRaw);
    if (!targetJid) {
      logTelegramCommandAudit(m.chatJid, cmd, false, 'invalid chat id');
      await sendMessage(
        m.chatJid,
        'Invalid chat id. Use /id in that chat, then pass the numeric id (or telegram:<id>).',
      );
      return true;
    }

    const targetGroup = registeredGroups[targetJid];
    if (targetGroup?.folder === MAIN_GROUP_FOLDER) {
      logTelegramCommandAudit(m.chatJid, cmd, false, 'target is main');
      await sendMessage(
        m.chatJid,
        'Main chat already runs without trigger prefix; free chat setting is unnecessary there.',
      );
      return true;
    }

    if (action === 'add') {
      updateChatRunPreferences(targetJid, (prefs) => {
        prefs.freeChat = true;
        return prefs;
      });
      logTelegramCommandAudit(m.chatJid, cmd, true, 'add');
      await sendMessage(
        m.chatJid,
        `Free chat enabled for ${targetJid}${targetGroup ? ` (${targetGroup.name})` : ''}.`,
      );
      return true;
    }

    updateChatRunPreferences(targetJid, (prefs) => {
      delete prefs.freeChat;
      return prefs;
    });
    logTelegramCommandAudit(m.chatJid, cmd, true, 'remove');
    await sendMessage(
      m.chatJid,
      `Free chat disabled for ${targetJid}${targetGroup ? ` (${targetGroup.name})` : ''}.`,
    );
    return true;
  }

  if (cmd === '/tasks') {
    logTelegramCommandAudit(m.chatJid, cmd, true, 'ok');
    await sendMessage(m.chatJid, formatTasksText());
    return true;
  }

  if (cmd === '/task_pause' || cmd === '/task_resume' || cmd === '/task_cancel') {
    const taskId = rest[0];
    if (!taskId) {
      logTelegramCommandAudit(m.chatJid, cmd, false, 'missing task id');
      await sendMessage(m.chatJid, `Usage: ${cmd} <taskId>`);
      return true;
    }

    const task = getTaskById(taskId);
    if (!task) {
      logTelegramCommandAudit(m.chatJid, cmd, false, 'task not found');
      await sendMessage(m.chatJid, `Task not found: ${taskId}`);
      return true;
    }

    if (cmd === '/task_pause') {
      updateTask(taskId, { status: 'paused' });
      logTelegramCommandAudit(m.chatJid, cmd, true, 'ok');
      await sendMessage(m.chatJid, `Paused task: ${taskId}`);
      return true;
    }
    if (cmd === '/task_resume') {
      updateTask(taskId, { status: 'active' });
      logTelegramCommandAudit(m.chatJid, cmd, true, 'ok');
      await sendMessage(m.chatJid, `Resumed task: ${taskId}`);
      return true;
    }

    deleteTask(taskId);
    logTelegramCommandAudit(m.chatJid, cmd, true, 'ok');
    await sendMessage(m.chatJid, `Canceled task: ${taskId}`);
    return true;
  }

  if (cmd === '/groups') {
    logTelegramCommandAudit(m.chatJid, cmd, true, 'ok');
    await sendMessage(m.chatJid, formatGroupsText());
    return true;
  }

  if (cmd === '/reload') {
    logTelegramCommandAudit(m.chatJid, cmd, true, 'ok');
    if (WHATSAPP_ENABLED && sock) {
      await syncGroupMetadata(true);
    }
    await refreshTelegramCommandMenus();
    await sendMessage(m.chatJid, 'Command menus and metadata refreshed.');
    return true;
  }

  if (cmd === '/panel') {
    logTelegramCommandAudit(m.chatJid, cmd, true, 'ok');
    if (!telegramBot) return true;
    await telegramBot.sendMessageWithKeyboard(
      m.chatJid,
      'Admin panel:',
      buildAdminPanelKeyboard(),
    );
    return true;
  }

  if (cmd === '/subagents') {
    const action = (rest[0] || 'list').toLowerCase();
    if (action === 'list') {
      logTelegramCommandAudit(m.chatJid, cmd, true, 'list');
      await sendMessage(m.chatJid, formatActiveSubagentsText());
      return true;
    }
    if (action === 'stop') {
      const target = (rest[1] || 'current').toLowerCase();
      if (target === 'all') {
        for (const run of activeChatRuns.values()) {
          run.abortController.abort(new Error('Stopped via /subagents stop all'));
        }
        logTelegramCommandAudit(m.chatJid, cmd, true, 'stop all');
        await sendMessage(m.chatJid, 'Stopping all active subagent runs...');
        return true;
      }
      if (target === 'current') {
        const run = activeChatRuns.get(m.chatJid);
        if (!run) {
          await sendMessage(m.chatJid, 'No active run in this chat.');
          return true;
        }
        run.abortController.abort(new Error('Stopped via /subagents stop current'));
        logTelegramCommandAudit(m.chatJid, cmd, true, 'stop current');
        await sendMessage(m.chatJid, 'Stopping current chat run...');
        return true;
      }

      const matched = Array.from(activeChatRuns.values()).find(
        (run) => run.requestId === target,
      );
      if (!matched) {
        await sendMessage(m.chatJid, `No active subagent run found for: ${target}`);
        return true;
      }
      matched.abortController.abort(new Error('Stopped via /subagents stop <id>'));
      logTelegramCommandAudit(m.chatJid, cmd, true, 'stop id');
      await sendMessage(m.chatJid, `Stopping run ${target}...`);
      return true;
    }
    if (action === 'spawn' || action === 'run' || action === 'start') {
      const task = rest.slice(1).join(' ').trim();
      if (!task) {
        await sendMessage(
          m.chatJid,
          'Usage: /subagents spawn <task>',
        );
        return true;
      }

      const group = registeredGroups[m.chatJid];
      if (!group) {
        await sendMessage(m.chatJid, 'Chat is not registered.');
        return true;
      }
      const existingRun = activeChatRuns.get(m.chatJid);
      if (existingRun) {
        logTelegramCommandAudit(m.chatJid, cmd, false, 'spawn blocked: active run');
        await sendMessage(
          m.chatJid,
          `Cannot spawn while another run is active (${existingRun.requestId || 'unknown'}). Use /stop first.`,
        );
        return true;
      }

      const requestId = `subagent-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      activeCoderRuns.set(requestId, {
        requestId,
        mode: 'execute',
        chatJid: m.chatJid,
        groupName: group.name,
        startedAt: Date.now(),
      });
      const abortController = new AbortController();
      const activeRun: ActiveChatRun = {
        chatJid: m.chatJid,
        startedAt: Date.now(),
        requestId,
        abortController,
      };
      activeChatRuns.set(m.chatJid, activeRun);
      await sendMessage(m.chatJid, `Starting subagent run (${requestId})...`);
      await setTyping(m.chatJid, true);
      try {
        const run = await runAgent(
          group,
          `[SUBAGENT EXECUTE REQUEST]\n${task}`,
          m.chatJid,
          'force_delegate_execute',
          requestId,
          chatRunPreferences[m.chatJid] || {},
          abortController.signal,
        );
        updateChatUsage(m.chatJid, run.usage);
        if (run.ok && !run.streamed && run.result) {
          await sendMessage(m.chatJid, run.result);
        }
      } finally {
        if (activeChatRuns.get(m.chatJid) === activeRun) {
          activeChatRuns.delete(m.chatJid);
        }
        activeCoderRuns.delete(requestId);
        await setTyping(m.chatJid, false);
      }
      return true;
    }

    await sendMessage(
      m.chatJid,
      'Usage: /subagents list | /subagents stop <current|all|requestId> | /subagents spawn <task>',
    );
    return true;
  }

  return false;
}

async function startTelegram(): Promise<void> {
  if (!TELEGRAM_BOT_TOKEN) return;
  if (telegramBot) return;

  telegramBot = createTelegramBot({
    token: TELEGRAM_BOT_TOKEN,
    apiBaseUrl: TELEGRAM_API_BASE_URL,
    assistantName: ASSISTANT_NAME,
    triggerPattern: TRIGGER_PATTERN,
  });
  await refreshTelegramCommandMenus();

  telegramBot.startPolling(async (event) => {
    if (event.kind === 'callback_query') {
      await handleTelegramCallbackQuery(event);
      return;
    }

    const m = event;
    storeChatMetadata(m.chatJid, m.timestamp, m.chatName);
    const didRegister = maybeRegisterTelegramChat(m.chatJid, m.chatName);
    if (didRegister && isMainChat(m.chatJid)) {
      await refreshTelegramCommandMenus();
    }

    // Handle lightweight admin commands without invoking the agent.
    if (await handleTelegramCommand(m)) return;

    if (registeredGroups[m.chatJid]) {
      const finalContent = m.media
        ? await persistTelegramMedia(m)
        : m.content;
      storeTextMessage({
        id: m.id,
        chatJid: m.chatJid,
        sender: m.sender,
        senderName: m.senderName,
        content: finalContent,
        timestamp: m.timestamp,
        isFromMe: false,
      });
    }
  });

  logger.info('Telegram polling started');
}

async function processMessage(msg: NewMessage): Promise<boolean> {
  const group = registeredGroups[msg.chat_jid];
  if (!group) return true;

  const content = msg.content.trim();
  const isMainGroup = group.folder === MAIN_GROUP_FOLDER;
  const queuePrefs = chatRunPreferences[msg.chat_jid] || {};
  const queueMode: QueueMode = queuePrefs.queueMode || 'collect';
  const queueDrop: QueueDropPolicy = queuePrefs.queueDrop || 'old';
  const queueCap =
    typeof queuePrefs.queueCap === 'number' && queuePrefs.queueCap > 0
      ? Math.floor(queuePrefs.queueCap)
      : undefined;
  const queueDebounceMs =
    typeof queuePrefs.queueDebounceMs === 'number' && queuePrefs.queueDebounceMs > 0
      ? Math.floor(queuePrefs.queueDebounceMs)
      : 0;
  const freeChatEnabled = queuePrefs.freeChat === true;

  // Main group responds to all messages; other groups require trigger prefix
  if (!isMainGroup && !freeChatEnabled && !TRIGGER_PATTERN.test(content)) return true;

  if (queueDebounceMs > 0) {
    logger.debug(
      { chatJid: msg.chat_jid, queueDebounceMs },
      'Queue debounce configured; applied as prompt-steering hint in this runtime',
    );
  }

  // Deterministic two-lane model:
  // - default: orchestrator handles message directly
  // - explicit triggers (/coder, /coder-plan, alias phrases) force delegation
  let codingHint: CodingHint = isMainGroup ? 'auto' : 'none';
  let requestId: string | undefined;
  let delegationInstruction: string | null = null;
  let delegationMarker: string | null = null;

  // In main, allow "/coder...", "/coder-plan...", or explicit alias phrases.
  // In non-main, trigger prefix is required (checked above) and delegation is blocked.
  const stripped = content.replace(TRIGGER_PATTERN, '').trimStart();
  const parsedTrigger = parseDelegationTrigger(stripped);
  const wantsDelegation = parsedTrigger.hint !== 'none';

  if (wantsDelegation && !isMainGroup) {
    await sendMessage(
      msg.chat_jid,
      `${ASSISTANT_NAME}: coder delegation is only available in the main/admin chat for safety.`,
    );
    return true;
  }

  if (wantsDelegation) {
    codingHint = parsedTrigger.hint;
    delegationInstruction = parsedTrigger.instruction;
    delegationMarker =
      codingHint === 'force_delegate_plan'
        ? '[CODER PLAN REQUEST]'
        : '[CODER EXECUTE REQUEST]';
    requestId = `coder-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const startMessageBody =
      codingHint === 'force_delegate_plan'
        ? `Starting coder plan run (${requestId})...`
        : `Starting coder run (${requestId})...`;
    const startMessage = isTelegramJid(msg.chat_jid)
      ? startMessageBody
      : `${ASSISTANT_NAME}: ${startMessageBody}`;
    await sendMessage(msg.chat_jid, startMessage);
  }

  // Get all messages since last agent interaction so the session has full context
  const sinceTimestamp = lastAgentTimestamp[msg.chat_jid] || '';
  const missedMessages = getMessagesSince(
    msg.chat_jid,
    sinceTimestamp,
    ASSISTANT_NAME,
  );

  let selectedMessages = [...missedMessages];
  let droppedCount = 0;
  if (queueCap && selectedMessages.length > queueCap) {
    droppedCount = selectedMessages.length - queueCap;
    if (queueDrop === 'new') {
      selectedMessages = selectedMessages.slice(0, queueCap);
    } else {
      // 'old' and 'summarize' keep newest messages in-window.
      selectedMessages = selectedMessages.slice(-queueCap);
    }
  }

  if (queueMode === 'followup' || queueMode === 'interrupt') {
    selectedMessages = selectedMessages.length
      ? [selectedMessages[selectedMessages.length - 1] as NewMessage]
      : [];
  }

  const lines = selectedMessages.map((m) => {
    return `[${m.timestamp}] ${m.sender_name}: ${m.content}`;
  });
  const prompt = lines.join('\n');

  if (!prompt) return true;

  let finalPrompt =
    codingHint !== 'none' && delegationMarker
      ? delegationInstruction
        ? `${prompt}\n\n${delegationMarker}\n${delegationInstruction}`
        : `${prompt}\n\n${delegationMarker}`
      : prompt;

  if (queueMode === 'interrupt') {
    finalPrompt =
      `${finalPrompt}\n\n[QUEUE MODE: interrupt]\n` +
      'Prioritize the latest message and ignore stale unresolved asks unless explicitly requested.';
  } else if (queueMode === 'steer') {
    finalPrompt =
      `${finalPrompt}\n\n[QUEUE MODE: steer]\n` +
      'Respect full context, but prioritize the user’s newest intent and provide concise steering updates.';
  } else if (queueMode === 'steer-backlog') {
    finalPrompt =
      `${finalPrompt}\n\n[QUEUE MODE: steer-backlog]\n` +
      'Process backlog context and prioritize the newest request first.';
  }
  if (queueDrop === 'summarize' && droppedCount > 0) {
    finalPrompt =
      `${finalPrompt}\n\n[QUEUE NOTE]\n` +
      `Older backlog truncated by queue cap (${droppedCount} message(s) dropped); summarize assumptions before acting.`;
  }
  if (queueDebounceMs > 0) {
    finalPrompt =
      `${finalPrompt}\n\n[QUEUE NOTE]\n` +
      `Debounce preference is ${queueDebounceMs}ms; keep responses concise and account for rapid bursts.`;
  }

  logger.info(
    {
      group: group.name,
      messageCount: missedMessages.length,
      selectedMessageCount: selectedMessages.length,
      queueMode,
      queueCap: queueCap || 0,
      queueDrop,
    },
    'Processing message',
  );

  if (
    (codingHint === 'force_delegate_execute' || codingHint === 'force_delegate_plan') &&
    requestId
  ) {
    activeCoderRuns.set(requestId, {
      requestId,
      mode: codingHint === 'force_delegate_plan' ? 'plan' : 'execute',
      chatJid: msg.chat_jid,
      groupName: group.name,
      startedAt: Date.now(),
    });
  }

  const runPreferences: ChatRunPreferences = {
    ...(chatRunPreferences[msg.chat_jid] || {}),
  };
  if (consumeNextRunNoContinue(msg.chat_jid)) {
    runPreferences.nextRunNoContinue = true;
  }

  let result: string | null = null;
  let streamed = false;
  let ok = false;
  let usage:
    | {
        inputTokens?: number;
        outputTokens?: number;
        totalTokens?: number;
        provider?: string;
        model?: string;
      }
    | undefined;
  const abortController = new AbortController();
  const activeRun: ActiveChatRun = {
    chatJid: msg.chat_jid,
    startedAt: Date.now(),
    requestId,
    abortController,
  };
  activeChatRuns.set(msg.chat_jid, activeRun);
  await setTyping(msg.chat_jid, true);
  try {
    const run = await runAgent(
      group,
      finalPrompt,
      msg.chat_jid,
      codingHint,
      requestId,
      runPreferences,
      abortController.signal,
    );
    result = run.result;
    streamed = run.streamed;
    ok = run.ok;
    usage = run.usage;
  } finally {
    await setTyping(msg.chat_jid, false);
    if (activeChatRuns.get(msg.chat_jid) === activeRun) {
      activeChatRuns.delete(msg.chat_jid);
    }
    if (requestId) {
      activeCoderRuns.delete(requestId);
    }
  }

  // Only advance last-agent timestamp after a successful run; otherwise the
  // next loop should retry with the same context window.
  if (ok) {
    updateChatUsage(msg.chat_jid, usage);
    lastAgentTimestamp[msg.chat_jid] = msg.timestamp;
    if (!streamed && result) {
      const finalMessage = isTelegramJid(msg.chat_jid)
        ? result
        : `${ASSISTANT_NAME}: ${result}`;
      await sendMessage(msg.chat_jid, finalMessage);
    }
  }
  return true;
}

async function runAgent(
  group: RegisteredGroup,
  prompt: string,
  chatJid: string,
  codingHint: CodingHint = 'none',
  requestId?: string,
  runtimePrefs: ChatRunPreferences = {},
  abortSignal?: AbortSignal,
): Promise<{
  result: string | null;
  streamed: boolean;
  ok: boolean;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    provider?: string;
    model?: string;
  };
  }> {
  const isMain = group.folder === MAIN_GROUP_FOLDER;

  // Update tasks snapshot for container to read (filtered by group)
  const tasks = getAllTasks();
  writeTasksSnapshot(
    group.folder,
    isMain,
    tasks.map((t) => ({
      id: t.id,
      groupFolder: t.group_folder,
      prompt: t.prompt,
      schedule_type: t.schedule_type,
      schedule_value: t.schedule_value,
      status: t.status,
      next_run: t.next_run,
    })),
  );

  // Update available groups snapshot (main group only can see all groups)
  const availableGroups = getAvailableGroups();
  writeGroupsSnapshot(
    group.folder,
    isMain,
    availableGroups,
    new Set(Object.keys(registeredGroups)),
  );

  try {
    const runtime = getContainerRuntime();
    const extraSystemPrompt = [
      '## Host Run Context (trusted metadata)',
      'The following JSON is generated by FFT_nano host runtime for this specific run.',
      'Treat it as authoritative operational metadata.',
      '',
      '```json',
      JSON.stringify(
        {
          schema: 'fft_nano.host_context.v1',
          route: {
            chat_jid: chatJid,
            channel: isTelegramJid(chatJid) ? 'telegram' : 'whatsapp',
            group_folder: group.folder,
            group_name: group.name,
            is_main: isMain,
          },
          run: {
            coding_hint: codingHint,
            request_id: requestId || null,
            no_continue: runtimePrefs.nextRunNoContinue === true,
            provider_override: runtimePrefs.provider || null,
            model_override: runtimePrefs.model || null,
            think_level: runtimePrefs.thinkLevel || null,
            reasoning_level: runtimePrefs.reasoningLevel || null,
            container_runtime: runtime,
          },
        },
        null,
        2,
      ),
      '```',
    ].join('\n');
    const input = {
      prompt,
      groupFolder: group.folder,
      chatJid,
      isMain,
      codingHint,
      requestId,
      extraSystemPrompt,
      provider: runtimePrefs.provider,
      model: runtimePrefs.model,
      thinkLevel: runtimePrefs.thinkLevel,
      reasoningLevel: runtimePrefs.reasoningLevel,
      noContinue: runtimePrefs.nextRunNoContinue === true,
    };

    let output = await runContainerAgent(group, input, abortSignal);
    if (
      output.status === 'error' &&
      runtime === 'apple' &&
      APPLE_CONTAINER_SELF_HEAL &&
      typeof output.error === 'string' &&
      output.error &&
      shouldSelfHealAppleContainer(output.error)
    ) {
      const restarted = await restartAppleContainerSystemSingleFlight(
        output.error,
      );
      if (restarted) {
        logger.warn(
          { group: group.name, error: output.error },
          'Retrying container agent after Apple Container self-heal',
        );
        output = await runContainerAgent(group, input, abortSignal);
      }
    }

    if (output.status === 'error') {
      if (typeof output.error === 'string' && /aborted by user/i.test(output.error)) {
        return { result: null, streamed: false, ok: true };
      }
      logger.error(
        { group: group.name, error: output.error },
        'Container agent error',
      );
      // Reply with a short error rather than silently dropping the message.
      // Also mark ok=true so we don't keep re-sending the same failing prompt.
      const msg = output.error
        ? `LLM error: ${output.error}${
            runtime === 'apple'
              ? '\n\nIf this persists on macOS Apple Container, run:\ncontainer system stop && container system start'
              : ''
          }`
        : 'LLM error: agent runner failed (no details).';
      return { result: msg, streamed: false, ok: true };
    }

    return {
      result: output.result,
      streamed: !!output.streamed,
      ok: true,
      usage: output.usage,
    };
  } catch (err) {
    logger.error({ group: group.name, err }, 'Agent error');
    return { result: null, streamed: false, ok: false };
  }
}

async function sendMessage(jid: string, text: string): Promise<void> {
  if (isTelegramJid(jid)) {
    if (!telegramBot) {
      logger.error({ jid }, 'Telegram message send requested but Telegram is not configured');
      return;
    }
    try {
      await telegramBot.sendMessage(jid, text);
      logger.info({ jid, length: text.length }, 'Telegram message sent');
    } catch (err) {
      logger.error({ jid, err }, 'Failed to send Telegram message');
    }
    return;
  }

  if (!sock) {
    logger.error({ jid }, 'WhatsApp message send requested but WhatsApp is not connected');
    return;
  }
  try {
    await sock.sendMessage(jid, { text });
    logger.info({ jid, length: text.length }, 'Message sent');
  } catch (err) {
    logger.error({ jid, err }, 'Failed to send message');
  }
}

function startIpcWatcher(): void {
  if (ipcWatcherRunning) {
    logger.debug('IPC watcher already running, skipping duplicate start');
    return;
  }
  ipcWatcherRunning = true;

  const ipcBaseDir = path.join(DATA_DIR, 'ipc');
  fs.mkdirSync(ipcBaseDir, { recursive: true });

  const processIpcFiles = async () => {
    // Scan all group IPC directories (identity determined by directory)
    let groupFolders: string[];
    try {
      groupFolders = fs.readdirSync(ipcBaseDir).filter((f) => {
        const stat = fs.statSync(path.join(ipcBaseDir, f));
        return stat.isDirectory() && f !== 'errors';
      });
    } catch (err) {
      logger.error({ err }, 'Error reading IPC base directory');
      setTimeout(processIpcFiles, IPC_POLL_INTERVAL);
      return;
    }

    for (const sourceGroup of groupFolders) {
      const isMain = sourceGroup === MAIN_GROUP_FOLDER;
      const messagesDir = path.join(ipcBaseDir, sourceGroup, 'messages');
      const tasksDir = path.join(ipcBaseDir, sourceGroup, 'tasks');

      // Process messages from this group's IPC directory
      try {
        if (fs.existsSync(messagesDir)) {
          const messageFiles = fs
            .readdirSync(messagesDir)
            .filter((f) => f.endsWith('.json'));
          for (const file of messageFiles) {
            const filePath = path.join(messagesDir, file);
            try {
              const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
              if (data.type === 'message' && data.chatJid && data.text) {
                // Authorization: verify this group can send to this chatJid
                const targetGroup = registeredGroups[data.chatJid];
                if (
                  isMain ||
                  (targetGroup && targetGroup.folder === sourceGroup)
                ) {
                  await sendMessage(
                    data.chatJid,
                    `${ASSISTANT_NAME}: ${data.text}`,
                  );
                  logger.info(
                    { chatJid: data.chatJid, sourceGroup },
                    'IPC message sent',
                  );
                } else {
                  logger.warn(
                    { chatJid: data.chatJid, sourceGroup },
                    'Unauthorized IPC message attempt blocked',
                  );
                }
              }
              fs.unlinkSync(filePath);
            } catch (err) {
              logger.error(
                { file, sourceGroup, err },
                'Error processing IPC message',
              );
              const errorDir = path.join(ipcBaseDir, 'errors');
              fs.mkdirSync(errorDir, { recursive: true });
              fs.renameSync(
                filePath,
                path.join(errorDir, `${sourceGroup}-${file}`),
              );
            }
          }
        }
      } catch (err) {
        logger.error(
          { err, sourceGroup },
          'Error reading IPC messages directory',
        );
      }

      // Process tasks from this group's IPC directory
      try {
        if (fs.existsSync(tasksDir)) {
          const taskFiles = fs
            .readdirSync(tasksDir)
            .filter((f) => f.endsWith('.json'));
          for (const file of taskFiles) {
            const filePath = path.join(tasksDir, file);
            try {
              const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
              // Pass source group identity to processTaskIpc for authorization
              await processTaskIpc(data, sourceGroup, isMain);
              fs.unlinkSync(filePath);
            } catch (err) {
              logger.error(
                { file, sourceGroup, err },
                'Error processing IPC task',
              );
              const errorDir = path.join(ipcBaseDir, 'errors');
              fs.mkdirSync(errorDir, { recursive: true });
              fs.renameSync(
                filePath,
                path.join(errorDir, `${sourceGroup}-${file}`),
              );
            }
          }
        }
      } catch (err) {
        logger.error({ err, sourceGroup }, 'Error reading IPC tasks directory');
      }

      // Process farm actions from this group's IPC directory
      try {
        const actionsDir = path.join(ipcBaseDir, sourceGroup, 'actions');
        if (fs.existsSync(actionsDir)) {
          const actionFiles = fs
            .readdirSync(actionsDir)
            .filter((f) => f.endsWith('.json'));

          for (const file of actionFiles) {
            const filePath = path.join(actionsDir, file);
            try {
              const request = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as
                | FarmActionRequest
                | MemoryActionRequest;

              const resultDir = path.join(
                ipcBaseDir,
                sourceGroup,
                'action_results',
              );
              fs.mkdirSync(resultDir, { recursive: true });

              if (request.type === 'farm_action') {
                const result = await executeFarmAction(request, isMain);
                const resultPath = path.join(
                  resultDir,
                  `${request.requestId}.json`,
                );
                fs.writeFileSync(resultPath, JSON.stringify(result, null, 2));
              } else if (request.type === 'memory_action') {
                const result = await executeMemoryAction(request, {
                  sourceGroup,
                  isMain,
                  registeredGroups,
                });
                const resultPath = path.join(
                  resultDir,
                  `${request.requestId}.json`,
                );
                fs.writeFileSync(resultPath, JSON.stringify(result, null, 2));
              } else {
                logger.warn(
                  { sourceGroup, file },
                  'Ignoring IPC action file with unsupported type',
                );
              }

              fs.unlinkSync(filePath);
            } catch (err) {
              logger.error(
                { file, sourceGroup, err },
                'Error processing IPC farm action',
              );
              const errorDir = path.join(ipcBaseDir, 'errors');
              fs.mkdirSync(errorDir, { recursive: true });
              fs.renameSync(
                filePath,
                path.join(errorDir, `${sourceGroup}-${file}`),
              );
            }
          }
        }
      } catch (err) {
        logger.error(
          { err, sourceGroup },
          'Error reading IPC actions directory',
        );
      }
    }

    setTimeout(processIpcFiles, IPC_POLL_INTERVAL);
  };

  processIpcFiles();
  logger.info('IPC watcher started (per-group namespaces)');
}

async function processTaskIpc(
  data: {
    type: string;
    taskId?: string;
    prompt?: string;
    schedule_type?: string;
    schedule_value?: string;
    context_mode?: string;
    groupFolder?: string;
    chatJid?: string;
    // For register_group
    jid?: string;
    name?: string;
    folder?: string;
    trigger?: string;
    containerConfig?: RegisteredGroup['containerConfig'];
  },
  sourceGroup: string, // Verified identity from IPC directory
  isMain: boolean, // Verified from directory path
): Promise<void> {
  // Import db functions dynamically to avoid circular deps
  const {
    createTask,
    updateTask,
    deleteTask,
    getTaskById: getTask,
  } = await import('./db.js');
  const { CronExpressionParser } = await import('cron-parser');

  switch (data.type) {
    case 'schedule_task':
      if (
        data.prompt &&
        data.schedule_type &&
        data.schedule_value &&
        data.groupFolder
      ) {
        // Authorization: non-main groups can only schedule for themselves
        const targetGroup = data.groupFolder;
        if (!isMain && targetGroup !== sourceGroup) {
          logger.warn(
            { sourceGroup, targetGroup },
            'Unauthorized schedule_task attempt blocked',
          );
          break;
        }

        // Resolve the correct JID for the target group (don't trust IPC payload)
        const targetJid = Object.entries(registeredGroups).find(
          ([, group]) => group.folder === targetGroup,
        )?.[0];

        if (!targetJid) {
          logger.warn(
            { targetGroup },
            'Cannot schedule task: target group not registered',
          );
          break;
        }

        const scheduleType = data.schedule_type as 'cron' | 'interval' | 'once';

        let nextRun: string | null = null;
        if (scheduleType === 'cron') {
          try {
            const interval = CronExpressionParser.parse(data.schedule_value, {
              tz: TIMEZONE,
            });
            nextRun = interval.next().toISOString();
          } catch {
            logger.warn(
              { scheduleValue: data.schedule_value },
              'Invalid cron expression',
            );
            break;
          }
        } else if (scheduleType === 'interval') {
          const ms = parseInt(data.schedule_value, 10);
          if (isNaN(ms) || ms <= 0) {
            logger.warn(
              { scheduleValue: data.schedule_value },
              'Invalid interval',
            );
            break;
          }
          nextRun = new Date(Date.now() + ms).toISOString();
        } else if (scheduleType === 'once') {
          const scheduled = new Date(data.schedule_value);
          if (isNaN(scheduled.getTime())) {
            logger.warn(
              { scheduleValue: data.schedule_value },
              'Invalid timestamp',
            );
            break;
          }
          nextRun = scheduled.toISOString();
        }

        const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const contextMode =
          data.context_mode === 'group' || data.context_mode === 'isolated'
            ? data.context_mode
            : 'isolated';
        createTask({
          id: taskId,
          group_folder: targetGroup,
          chat_jid: targetJid,
          prompt: data.prompt,
          schedule_type: scheduleType,
          schedule_value: data.schedule_value,
          context_mode: contextMode,
          next_run: nextRun,
          status: 'active',
          created_at: new Date().toISOString(),
        });
        logger.info(
          { taskId, sourceGroup, targetGroup, contextMode },
          'Task created via IPC',
        );
      }
      break;

    case 'pause_task':
      if (data.taskId) {
        const task = getTask(data.taskId);
        if (task && (isMain || task.group_folder === sourceGroup)) {
          updateTask(data.taskId, { status: 'paused' });
          logger.info(
            { taskId: data.taskId, sourceGroup },
            'Task paused via IPC',
          );
        } else {
          logger.warn(
            { taskId: data.taskId, sourceGroup },
            'Unauthorized task pause attempt',
          );
        }
      }
      break;

    case 'resume_task':
      if (data.taskId) {
        const task = getTask(data.taskId);
        if (task && (isMain || task.group_folder === sourceGroup)) {
          updateTask(data.taskId, { status: 'active' });
          logger.info(
            { taskId: data.taskId, sourceGroup },
            'Task resumed via IPC',
          );
        } else {
          logger.warn(
            { taskId: data.taskId, sourceGroup },
            'Unauthorized task resume attempt',
          );
        }
      }
      break;

    case 'cancel_task':
      if (data.taskId) {
        const task = getTask(data.taskId);
        if (task && (isMain || task.group_folder === sourceGroup)) {
          deleteTask(data.taskId);
          logger.info(
            { taskId: data.taskId, sourceGroup },
            'Task cancelled via IPC',
          );
        } else {
          logger.warn(
            { taskId: data.taskId, sourceGroup },
            'Unauthorized task cancel attempt',
          );
        }
      }
      break;

    case 'refresh_groups':
      // Only main group can request a refresh
      if (isMain) {
        logger.info(
          { sourceGroup },
          'Group metadata refresh requested via IPC',
        );
        await syncGroupMetadata(true);
        // Write updated snapshot immediately
        const availableGroups = getAvailableGroups();
        const { writeGroupsSnapshot: writeGroups } =
          await import('./container-runner.js');
        writeGroups(
          sourceGroup,
          true,
          availableGroups,
          new Set(Object.keys(registeredGroups)),
        );
      } else {
        logger.warn(
          { sourceGroup },
          'Unauthorized refresh_groups attempt blocked',
        );
      }
      break;

    case 'register_group':
      // Only main group can register new groups
      if (!isMain) {
        logger.warn(
          { sourceGroup },
          'Unauthorized register_group attempt blocked',
        );
        break;
      }
      if (data.jid && data.name && data.folder && data.trigger) {
        registerGroup(data.jid, {
          name: data.name,
          folder: data.folder,
          trigger: data.trigger,
          added_at: new Date().toISOString(),
          containerConfig: data.containerConfig,
        });
      } else {
        logger.warn(
          { data },
          'Invalid register_group request - missing required fields',
        );
      }
      break;

    default:
      logger.warn({ type: data.type }, 'Unknown IPC task type');
  }
}

async function connectWhatsApp(): Promise<void> {
  const authDir = path.join(STORE_DIR, 'auth');
  fs.mkdirSync(authDir, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(authDir);

  sock = makeWASocket({
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    printQRInTerminal: false,
    logger,
    browser: ['FFT_nano', 'Chrome', '1.0.0'],
  });

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      const msg =
        'WhatsApp authentication required. Run: npm run auth';
      logger.error(msg);
      if (process.platform === 'darwin') {
        exec(
          `osascript -e 'display notification "${msg}" with title "FFT_nano" sound name "Basso"'`,
        );
      }
      setTimeout(() => process.exit(1), 1000);
    }

    if (connection === 'close') {
      const reason = (lastDisconnect?.error as any)?.output?.statusCode;
      const shouldReconnect = reason !== DisconnectReason.loggedOut;
      logger.info({ reason, shouldReconnect }, 'Connection closed');

      if (shouldReconnect) {
        logger.info('Reconnecting...');
        connectWhatsApp();
      } else {
        logger.info('Logged out. Run /setup to re-authenticate.');
        process.exit(0);
      }
    } else if (connection === 'open') {
      logger.info('Connected to WhatsApp');
      
      // Build LID to phone mapping from auth state for self-chat translation
      if (sock.user) {
        const phoneUser = sock.user.id.split(':')[0];
        const lidUser = sock.user.lid?.split(':')[0];
        if (lidUser && phoneUser) {
          lidToPhoneMap[lidUser] = `${phoneUser}@s.whatsapp.net`;
          logger.debug({ lidUser, phoneUser }, 'LID to phone mapping set');
        }
      }

      maybeRegisterWhatsAppMainChat();
      
      // Sync group metadata on startup (respects 24h cache)
      syncGroupMetadata().catch((err) =>
        logger.error({ err }, 'Initial group sync failed'),
      );
      // Set up daily sync timer (only once)
      if (!groupSyncTimerStarted) {
        groupSyncTimerStarted = true;
        setInterval(() => {
          syncGroupMetadata().catch((err) =>
            logger.error({ err }, 'Periodic group sync failed'),
          );
        }, GROUP_SYNC_INTERVAL_MS);
      }
      startSchedulerLoop({
        sendMessage,
        registeredGroups: () => registeredGroups,
      });
      startIpcWatcher();
      startMessageLoop();
    }
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messages.upsert', ({ messages }) => {
    for (const msg of messages) {
      if (!msg.message) continue;
      const rawJid = msg.key.remoteJid;
      if (!rawJid || rawJid === 'status@broadcast') continue;

      // Translate LID JID to phone JID if applicable
      const chatJid = translateJid(rawJid);
      
      const timestamp = new Date(
        Number(msg.messageTimestamp) * 1000,
      ).toISOString();

      // Always store chat metadata for group discovery
      storeChatMetadata(chatJid, timestamp);

      // Only store full message content for registered groups
      if (registeredGroups[chatJid]) {
        storeMessage(
          msg,
          chatJid,
          msg.key.fromMe || false,
          msg.pushName || undefined,
        );
      }
    }
  });
}

async function startMessageLoop(): Promise<void> {
  if (messageLoopRunning) {
    logger.debug('Message loop already running, skipping duplicate start');
    return;
  }
  messageLoopRunning = true;
  logger.info(`FFT_nano running (trigger: @${ASSISTANT_NAME})`);

  while (true) {
    try {
      const jids = Object.keys(registeredGroups);
      const { messages } = getNewMessages(jids, lastTimestamp, ASSISTANT_NAME);

      if (messages.length > 0)
        logger.info({ count: messages.length }, 'New messages');
      for (const msg of messages) {
        try {
          const processed = await processMessage(msg);
          if (!processed) {
            logger.debug(
              { msgId: msg.id, chatJid: msg.chat_jid },
              'Message processing deferred; retrying on next poll loop',
            );
            break;
          }
          // Only advance timestamp after successful processing for at-least-once delivery
          lastTimestamp = msg.timestamp;
          saveState();
        } catch (err) {
          logger.error(
            { err, msg: msg.id },
            'Error processing message, will retry',
          );
          // Stop processing this batch - failed message will be retried next loop
          break;
        }
      }
    } catch (err) {
      logger.error({ err }, 'Error in message loop');
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
  }
}

function isHeartbeatAckOnly(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (trimmed === 'HEARTBEAT_OK') return true;
  const withoutPrefix = trimmed.replace(/^HEARTBEAT_OK\s*/i, '').trim();
  return withoutPrefix.length === 0;
}

async function runHeartbeatTurn(): Promise<void> {
  if (!HEARTBEAT_ENABLED) return;
  const mainChatJid = findMainChatJid();
  if (!mainChatJid) return;
  if (activeChatRuns.has(mainChatJid)) {
    logger.debug({ chatJid: mainChatJid }, 'Skipping heartbeat: active run in main chat');
    return;
  }

  const group = registeredGroups[mainChatJid];
  if (!group || group.folder !== MAIN_GROUP_FOLDER) return;

  const requestId = `heartbeat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const abortController = new AbortController();
  const activeRun: ActiveChatRun = {
    chatJid: mainChatJid,
    startedAt: Date.now(),
    requestId,
    abortController,
  };
  activeChatRuns.set(mainChatJid, activeRun);
  await setTyping(mainChatJid, true);
  try {
    const run = await runAgent(
      group,
      `${HEARTBEAT_PROMPT}\n\n[SYSTEM NOTE]\nHeartbeat run.`,
      mainChatJid,
      'auto',
      requestId,
      chatRunPreferences[mainChatJid] || {},
      abortController.signal,
    );
    updateChatUsage(mainChatJid, run.usage);
    if (run.ok && !run.streamed && run.result && !isHeartbeatAckOnly(run.result)) {
      await sendMessage(mainChatJid, run.result);
    }
  } catch (err) {
    logger.warn({ err, chatJid: mainChatJid }, 'Heartbeat run failed');
  } finally {
    if (activeChatRuns.get(mainChatJid) === activeRun) {
      activeChatRuns.delete(mainChatJid);
    }
    await setTyping(mainChatJid, false);
  }
}

function startHeartbeatLoop(): void {
  if (!HEARTBEAT_ENABLED || heartbeatLoopStarted) return;
  heartbeatLoopStarted = true;
  setInterval(() => {
    if (shuttingDown) return;
    void runHeartbeatTurn();
  }, HEARTBEAT_INTERVAL_MS);
  logger.info({ everyMs: HEARTBEAT_INTERVAL_MS }, 'Heartbeat loop started');
}

function ensureContainerSystemRunning(): void {
  const runtime = getContainerRuntime();
  if (runtime === 'docker') {
    try {
      // Verifies Docker is installed and the daemon is reachable.
      execSync('docker info', { stdio: 'pipe' });
      logger.debug('Docker runtime available');
      return;
    } catch (err) {
      logger.error({ err }, 'Docker runtime not available');
      console.error(
        '\n╔════════════════════════════════════════════════════════════════╗',
      );
      console.error(
        '║  FATAL: Docker is required but is not available               ║',
      );
      console.error(
        '║                                                                ║',
      );
      console.error(
        '║  To fix:                                                       ║',
      );
      console.error(
        '║  1. Install Docker (Desktop on macOS, engine on Linux/RPi)     ║',
      );
      console.error(
        '║  2. Start the Docker daemon                                    ║',
      );
      console.error(
        '║  3. Restart FFT_nano                                          ║',
      );
      console.error(
        '╚════════════════════════════════════════════════════════════════╝\n',
      );
      throw new Error('Docker is required but not available');
    }
  }

  try {
    execSync('container system status', { stdio: 'pipe' });
    logger.debug('Apple Container system already running');
  } catch {
    logger.info('Starting Apple Container system...');
    try {
      execSync('container system start', { stdio: 'pipe', timeout: 30000 });
      logger.info('Apple Container system started');
    } catch (err) {
      logger.error({ err }, 'Failed to start Apple Container system');
      console.error(
        '\n╔════════════════════════════════════════════════════════════════╗',
      );
      console.error(
        '║  FATAL: Apple Container system failed to start                 ║',
      );
      console.error(
        '║                                                                ║',
      );
      console.error(
        '║  Agents cannot run without Apple Container. To fix:           ║',
      );
      console.error(
        '║  1. Install from: https://github.com/apple/container/releases ║',
      );
      console.error(
        '║  2. Run: container system start                               ║',
      );
      console.error(
        '║  3. Restart FFT_nano                                          ║',
      );
      console.error(
        '╚════════════════════════════════════════════════════════════════╝\n',
      );
      throw new Error('Apple Container system is required but failed to start');
    }
  }
}

function stopFarmServicesForShutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down FFT_nano services');

  if (FARM_STATE_ENABLED) {
    stopFarmStateCollector();
  }
}

function registerShutdownHandlers(): void {
  process.on('SIGINT', () => {
    stopFarmServicesForShutdown('SIGINT');
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    stopFarmServicesForShutdown('SIGTERM');
    process.exit(0);
  });
}

async function main(): Promise<void> {
  registerShutdownHandlers();
  acquireSingletonLock(path.join(DATA_DIR, 'fft_nano.lock'));
  ensureContainerSystemRunning();
  initDatabase();
  logger.info('Database initialized');
  loadState();
  migrateLegacyClaudeMemoryFiles();
  migrateCompactionSummariesFromSoul();
  maybePromoteConfiguredTelegramMain();

  if (FARM_STATE_ENABLED) {
    startFarmStateCollector();
  }

  const telegramEnabled = !!TELEGRAM_BOT_TOKEN;
  const farmOnlyMode = FARM_STATE_ENABLED && !WHATSAPP_ENABLED && !telegramEnabled;
  
  if (!WHATSAPP_ENABLED && !telegramEnabled && !FARM_STATE_ENABLED) {
    throw new Error(
      'No channels enabled. Set WHATSAPP_ENABLED=1 and/or TELEGRAM_BOT_TOKEN.',
    );
  }

  if (telegramEnabled) {
    await startTelegram();
  }

  // If Telegram is enabled we start the loops immediately so Telegram messages
  // can be processed even before WhatsApp connects.
  // Also start in farm-state-only mode for integration testing.
  if (telegramEnabled || !WHATSAPP_ENABLED) {
    startSchedulerLoop({
      sendMessage,
      registeredGroups: () => registeredGroups,
    });
    startIpcWatcher();
    startHeartbeatLoop();
    void startMessageLoop();
  }

  if (farmOnlyMode) {
    logger.info('Running in farm-state-only mode (no channels enabled)');
  } else if (WHATSAPP_ENABLED) {
    await connectWhatsApp();
    startHeartbeatLoop();
  } else {
    logger.info('WhatsApp disabled (WHATSAPP_ENABLED=0)');
  }
}

main().catch((err) => {
  stopFarmServicesForShutdown('startup_error');
  logger.error({ err }, 'Failed to start FFT_nano');
  process.exit(1);
});
