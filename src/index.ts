import { exec, execSync } from 'child_process';
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
import { NewMessage, RegisteredGroup } from './types.js';
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

const GROUP_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const TELEGRAM_MEDIA_MAX_BYTES = TELEGRAM_MEDIA_MAX_MB * 1024 * 1024;

const TELEGRAM_COMMON_COMMANDS = [
  { command: 'help', description: 'Show command help' },
  { command: 'status', description: 'Show runtime status' },
  { command: 'id', description: 'Show this chat id' },
] as const;

const TELEGRAM_ADMIN_COMMANDS = [
  { command: 'main', description: 'Claim this chat as main/admin' },
  { command: 'coder', description: 'Delegate coding execution' },
  { command: 'coder-plan', description: 'Delegate coding plan-only' },
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
  | '/main'
  | '/tasks'
  | '/task_pause'
  | '/task_resume'
  | '/task_cancel'
  | '/groups'
  | '/reload'
  | '/panel'
  | '/coder'
  | '/coder-plan';

let sock: WASocket;
let telegramBot: TelegramBot | null = null;
let lastTimestamp = '';
let registeredGroups: Record<string, RegisteredGroup> = {};
let lastAgentTimestamp: Record<string, string> = {};
let lastTelegramMenuMainChatId: string | null = null;
// LID to phone number mapping (WhatsApp now sends LID JIDs for self-chats)
let lidToPhoneMap: Record<string, string> = {};
// Guards to prevent duplicate loops on WhatsApp reconnect
let messageLoopRunning = false;
let ipcWatcherRunning = false;
let groupSyncTimerStarted = false;

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
  }>(statePath, {});
  lastTimestamp = state.last_timestamp || '';
  lastAgentTimestamp = state.last_agent_timestamp || {};
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

  logger.info(
    { jid, name: group.name, folder: group.folder },
    'Group registered',
  );
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

function findMainTelegramChatJid(): string | null {
  for (const [jid, group] of Object.entries(registeredGroups)) {
    if (group.folder === MAIN_GROUP_FOLDER && isTelegramJid(jid)) {
      return jid;
    }
  }
  return null;
}

function normalizeTelegramCommandToken(token: string): TelegramCommandName | null {
  if (!token.startsWith('/')) return null;
  const normalized = token.split('@')[0]?.toLowerCase();
  if (!normalized) return null;
  const command = normalized as TelegramCommandName;
  const known: Set<TelegramCommandName> = new Set([
    '/help',
    '/status',
    '/id',
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
  ]);
  return known.has(command) ? command : null;
}

function formatHelpText(isMainGroup: boolean): string {
  const common = [
    '/help - show this help',
    '/status - runtime and queue status',
    '/id - show current Telegram chat id',
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
    '/reload - refresh command menus and group metadata',
    '/panel - open admin quick actions',
    '/coder <task> - explicit delegated coding run',
    '/coder-plan <task> - explicit delegated planning run',
  ].join('\n');
}

function formatStatusText(): string {
  const runtime = getContainerRuntime();
  const mainGroup = Object.values(registeredGroups).find(
    (group) => group.folder === MAIN_GROUP_FOLDER,
  );
  const tasks = getAllTasks();
  const active = tasks.filter((task) => task.status === 'active').length;
  const paused = tasks.filter((task) => task.status === 'paused').length;
  const completed = tasks.filter((task) => task.status === 'completed').length;

  return [
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
  ].join('\n');
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
  await telegramBot.setCommands(common, { type: 'default' });

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
    await telegramBot.setCommands(admin, { type: 'chat', chatId: mainChatId });
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
      await sendMessage(q.chatJid, formatStatusText());
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

  const [rawCmd, ...rest] = content.split(/\s+/);
  const cmd = normalizeTelegramCommandToken(rawCmd);
  if (!cmd) return false;
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
    await sendMessage(m.chatJid, formatStatusText());
    return true;
  }

  if (cmd === '/coder' || cmd === '/coder-plan') {
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

async function processMessage(msg: NewMessage): Promise<void> {
  const group = registeredGroups[msg.chat_jid];
  if (!group) return;

  const content = msg.content.trim();
  const isMainGroup = group.folder === MAIN_GROUP_FOLDER;

  // Main group responds to all messages; other groups require trigger prefix
  if (!isMainGroup && !TRIGGER_PATTERN.test(content)) return;

  // Deterministic two-lane model:
  // - default: orchestrator handles message directly
  // - explicit triggers (/coder, /coder-plan, alias phrases) force delegation
  let codingHint: CodingHint = 'none';
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
    return;
  }

  if (wantsDelegation) {
    codingHint = parsedTrigger.hint;
    delegationInstruction = parsedTrigger.instruction;
    delegationMarker =
      codingHint === 'force_delegate_plan'
        ? '[CODER PLAN REQUEST]'
        : '[CODER EXECUTE REQUEST]';
    requestId = `coder-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const startMessage =
      codingHint === 'force_delegate_plan'
        ? `${ASSISTANT_NAME}: Starting coder plan run (${requestId})...`
        : `${ASSISTANT_NAME}: Starting coder run (${requestId})...`;
    await sendMessage(msg.chat_jid, startMessage);
  }

  // Get all messages since last agent interaction so the session has full context
  const sinceTimestamp = lastAgentTimestamp[msg.chat_jid] || '';
  const missedMessages = getMessagesSince(
    msg.chat_jid,
    sinceTimestamp,
    ASSISTANT_NAME,
  );

  const lines = missedMessages.map((m) => {
    return `[${m.timestamp}] ${m.sender_name}: ${m.content}`;
  });
  const prompt = lines.join('\n');

  if (!prompt) return;

  const finalPrompt =
    codingHint !== 'none' && delegationMarker
      ? delegationInstruction
        ? `${prompt}\n\n${delegationMarker}\n${delegationInstruction}`
        : `${prompt}\n\n${delegationMarker}`
      : prompt;

  logger.info(
    { group: group.name, messageCount: missedMessages.length },
    'Processing message',
  );

  await setTyping(msg.chat_jid, true);
  const { result, streamed, ok } = await runAgent(
    group,
    finalPrompt,
    msg.chat_jid,
    codingHint,
    requestId,
  );
  await setTyping(msg.chat_jid, false);

  // Only advance last-agent timestamp after a successful run; otherwise the
  // next loop should retry with the same context window.
  if (ok) {
    lastAgentTimestamp[msg.chat_jid] = msg.timestamp;
    if (!streamed && result) {
      await sendMessage(msg.chat_jid, `${ASSISTANT_NAME}: ${result}`);
    }
  }
}

async function runAgent(
  group: RegisteredGroup,
  prompt: string,
  chatJid: string,
  codingHint: CodingHint = 'none',
  requestId?: string,
): Promise<{ result: string | null; streamed: boolean; ok: boolean }> {
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
    const input = {
      prompt,
      groupFolder: group.folder,
      chatJid,
      isMain,
      codingHint,
      requestId,
    } as const;

    let output = await runContainerAgent(group, input);
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
        output = await runContainerAgent(group, input);
      }
    }

    if (output.status === 'error') {
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

    return { result: output.result, streamed: !!output.streamed, ok: true };
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
          await processMessage(msg);
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

async function main(): Promise<void> {
  acquireSingletonLock(path.join(DATA_DIR, 'fft_nano.lock'));
  ensureContainerSystemRunning();
  initDatabase();
  logger.info('Database initialized');
  loadState();
  migrateLegacyClaudeMemoryFiles();
  maybePromoteConfiguredTelegramMain();

  const telegramEnabled = !!TELEGRAM_BOT_TOKEN;
  if (!WHATSAPP_ENABLED && !telegramEnabled) {
    throw new Error(
      'No channels enabled. Set WHATSAPP_ENABLED=1 and/or TELEGRAM_BOT_TOKEN.',
    );
  }

  if (telegramEnabled) {
    await startTelegram();
  }

  // If Telegram is enabled we start the loops immediately so Telegram messages
  // can be processed even before WhatsApp connects.
  if (telegramEnabled || !WHATSAPP_ENABLED) {
    startSchedulerLoop({
      sendMessage,
      registeredGroups: () => registeredGroups,
    });
    startIpcWatcher();
    void startMessageLoop();
  }

  if (WHATSAPP_ENABLED) {
    await connectWhatsApp();
  } else {
    logger.info('WhatsApp disabled (WHATSAPP_ENABLED=0)');
  }
}

main().catch((err) => {
  logger.error({ err }, 'Failed to start FFT_nano');
  process.exit(1);
});
