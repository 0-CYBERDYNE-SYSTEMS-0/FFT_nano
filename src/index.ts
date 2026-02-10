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
  getLastGroupSync,
  getMessagesSince,
  getNewMessages,
  getTaskById,
  initDatabase,
  setLastGroupSync,
  storeChatMetadata,
  storeMessage,
  storeTextMessage,
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
import type { TelegramBot } from './telegram.js';

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

let sock: WASocket;
let telegramBot: TelegramBot | null = null;
let lastTimestamp = '';
let registeredGroups: Record<string, RegisteredGroup> = {};
let lastAgentTimestamp: Record<string, string> = {};
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
    .filter((c) => c.jid !== '__group_sync__' && c.jid.endsWith('@g.us'))
    .map((c) => ({
      jid: c.jid,
      name: c.name,
      lastActivity: c.last_message_time,
      isRegistered: registeredJids.has(c.jid),
    }));
}

function maybeRegisterTelegramChat(chatJid: string, chatName: string): void {
  if (!TELEGRAM_AUTO_REGISTER) return;
  if (registeredGroups[chatJid]) return;

  const chatId = parseTelegramChatId(chatJid);
  if (!chatId) return;

  const isMain = TELEGRAM_MAIN_CHAT_ID && chatId === TELEGRAM_MAIN_CHAT_ID;
  const folder = isMain ? MAIN_GROUP_FOLDER : `telegram-${chatId}`;

  registerGroup(chatJid, {
    name: chatName,
    folder,
    trigger: `@${ASSISTANT_NAME}`,
    added_at: new Date().toISOString(),
  });
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

async function handleTelegramCommand(m: {
  chatJid: string;
  chatName: string;
  content: string;
}): Promise<boolean> {
  const content = m.content.trim();
  if (!content.startsWith('/')) return false;

  const [cmd, ...rest] = content.split(/\s+/);

  if (cmd === '/id') {
    const chatId = parseTelegramChatId(m.chatJid);
    await sendMessage(
      m.chatJid,
      chatId
        ? `Chat id: ${chatId}`
        : 'Could not parse chat id for this chat.',
    );
    return true;
  }

  if (cmd === '/main') {
    const chatId = parseTelegramChatId(m.chatJid);
    if (!chatId) {
      await sendMessage(m.chatJid, 'Could not parse chat id for this chat.');
      return true;
    }

    // If main is already configured, don't let random chats steal it.
    const existingMain = hasMainGroup();
    const alreadyMain =
      registeredGroups[m.chatJid]?.folder === MAIN_GROUP_FOLDER;
    if (existingMain && !alreadyMain) {
      await sendMessage(
        m.chatJid,
        'Main chat is already set. If you want to change it, edit data/registered_groups.json (or delete it to re-bootstrap).',
      );
      return true;
    }

    if (!TELEGRAM_ADMIN_SECRET) {
      await sendMessage(
        m.chatJid,
        'TELEGRAM_ADMIN_SECRET is not set on the host. Set it, restart, then run: /main <secret>',
      );
      return true;
    }

    const provided = rest.join(' ');
    if (!provided || provided !== TELEGRAM_ADMIN_SECRET) {
      await sendMessage(
        m.chatJid,
        'Unauthorized. Usage: /main <secret>',
      );
      return true;
    }

    promoteChatToMain(m.chatJid, m.chatName || `${ASSISTANT_NAME} (main)`);

    await sendMessage(
      m.chatJid,
      'This chat is now the main/admin channel.',
    );
    return true;
  }

  return false;
}

function startTelegram(): void {
  if (!TELEGRAM_BOT_TOKEN) return;
  if (telegramBot) return;

  telegramBot = createTelegramBot({
    token: TELEGRAM_BOT_TOKEN,
    apiBaseUrl: TELEGRAM_API_BASE_URL,
  });

  telegramBot.startPolling(async (m) => {
    storeChatMetadata(m.chatJid, m.timestamp, m.chatName);
    maybeRegisterTelegramChat(m.chatJid, m.chatName);

    // Handle lightweight admin commands without invoking the agent.
    if (await handleTelegramCommand(m)) return;

    if (registeredGroups[m.chatJid]) {
      storeTextMessage({
        id: m.id,
        chatJid: m.chatJid,
        sender: m.sender,
        senderName: m.senderName,
        content: m.content,
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

  // Explicit coder command (OpenClaw-style): /coder ...
  // Security: only allow coder runs from main/admin chat.
  let profile: 'farmfriend' | 'coder' = 'farmfriend';
  let requestId: string | undefined;
  let coderInstruction: string | null = null;
  // In main, allow either "/coder ..." or "@FarmFriend /coder ...".
  // In non-main, the trigger prefix is required (checked above).
  const stripped = content.replace(TRIGGER_PATTERN, '').trimStart();
  if (/^\/coder\b/i.test(stripped)) {
    if (!isMainGroup) {
      await sendMessage(
        msg.chat_jid,
        `${ASSISTANT_NAME}: /coder is only available in the main/admin chat for safety.`,
      );
      return;
    }
    profile = 'coder';
    coderInstruction = stripped.replace(/^\/coder\b/i, '').trim();
    requestId = `coder-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await sendMessage(
      msg.chat_jid,
      `${ASSISTANT_NAME}: Starting coder run (${requestId})...`,
    );
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
    profile === 'coder' && coderInstruction
      ? `${prompt}\n\n[CODER REQUEST]\n${coderInstruction}`
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
    profile,
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
  profile: 'farmfriend' | 'coder' = 'farmfriend',
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
      profile,
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
    startTelegram();
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
