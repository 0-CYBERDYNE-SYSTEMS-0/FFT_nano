import { exec, execSync, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

import makeWASocket, {
  Browsers,
  DisconnectReason,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';

import {
  ASSISTANT_NAME,
  DATA_DIR,
  FEATURE_FARM,
  FARM_STATE_ENABLED,
  FFT_NANO_TUI_AUTH_TOKEN,
  FFT_NANO_TUI_ENABLED,
  FFT_NANO_TUI_HOST,
  FFT_NANO_TUI_PORT,
  FFT_NANO_WEB_ACCESS_MODE,
  FFT_NANO_WEB_AUTH_TOKEN,
  FFT_NANO_WEB_ENABLED,
  FFT_NANO_WEB_HOST,
  FFT_NANO_WEB_PORT,
  FFT_NANO_WEB_STATIC_DIR,
  FFT_PROFILE,
  GROUPS_DIR,
  IPC_POLL_INTERVAL,
  MAIN_WORKSPACE_DIR,
  MAIN_GROUP_FOLDER,
  PARITY_CONFIG,
  POLL_INTERVAL,
  PROFILE_DETECTION,
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
} from './pi-runner.js';
import {
  getAllChats,
  getAllTasks,
  deleteTask,
  getDueTasks,
  getChatHistory,
  getLastGroupSync,
  getMessagesSince,
  getNewMessages,
  getTaskById,
  getTaskRunLogs,
  initDatabase,
  setLastGroupSync,
  storeChatMetadata,
  storeHostMessage,
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
import { acquireSingletonLock } from './singleton-lock.js';
import {
  createTelegramBot,
  isTelegramJid,
  parseTelegramChatId,
  splitTelegramText,
} from './telegram.js';
import {
  formatHelpText,
  normalizeTelegramCommandToken,
  TELEGRAM_ADMIN_COMMANDS,
  TELEGRAM_COMMON_COMMANDS,
} from './telegram-command-spec.js';
import { resolvePiExecutable } from './pi-executable.js';
import {
  applyProcessEnvUpdates,
  buildRuntimeProviderPresetUpdates,
  getDefaultDotEnvPath,
  getRuntimeProviderDefinitionByPreset,
  loadDotEnvMap,
  resolveRuntimeConfigSnapshot,
  RUNTIME_PROVIDER_PRESET_ENV,
  RUNTIME_PROVIDER_DEFINITIONS,
  type RuntimeProviderPreset,
  upsertDotEnv,
} from './runtime-config.js';
import type {
  TelegramBot,
  TelegramInboundCallbackQuery,
  TelegramInboundMessage,
  TelegramInlineKeyboard,
} from './telegram.js';
import type { TelegramCommandName } from './telegram-command-spec.js';
import {
  parseTelegramDraftIpcMessage,
  resolveTelegramStreamCompletionState,
  sendTelegramDraftWithFallback,
} from './telegram-draft-ipc.js';
import { parseDelegationTrigger, type CodingHint } from './coding-delegation.js';
import { executeFarmAction } from './farm-action-gateway.js';
import { startFarmStateCollector, stopFarmStateCollector } from './farm-state-collector.js';
import { executeMemoryAction } from './memory-action-gateway.js';
import { isValidGroupFolder, resolveGroupFolderPath } from './group-folder.js';
import { applyNonHeartbeatEmptyOutputPolicy } from './agent-empty-output.js';
import {
  appendCompactionSummaryToMemory,
  migrateCompactionsForGroup,
} from './memory-maintenance.js';
import { ensureMemoryScaffold } from './memory-paths.js';
import {
  cycleVerboseMode,
  describeVerboseMode,
  getEffectiveVerboseMode,
  normalizeVerboseMode,
  parseVerboseDirective,
  type VerboseMode,
} from './verbose-mode.js';
import { resolveCronExecutionPlan, resolveCronPolicy } from './cron/adapters.js';
import type { CronV2Schedule } from './cron/types.js';
import {
  isHeartbeatFileEffectivelyEmpty,
  isWithinHeartbeatActiveHours,
  parseHeartbeatActiveHours,
  shouldSuppressDuplicateHeartbeat,
  stripHeartbeatToken,
} from './heartbeat-policy.js';
import {
  completeMainWorkspaceOnboarding,
  computeBootFileHash,
  ensureMainWorkspaceBootstrap,
  getMainWorkspaceOnboardingStatus,
  markMainWorkspaceBootExecuted,
  readMainWorkspaceState,
} from './workspace-bootstrap.js';
import {
  extractOnboardingCompletion,
  MAIN_ONBOARDING_COMPLETION_TOKEN,
} from './onboarding-completion.js';
import {
  startTuiGatewayServer,
  type SessionHistoryMessage,
  type SessionPrefs as TuiSessionPrefs,
  type TuiGatewayAdapters,
  type TuiGatewayServer,
} from './tui/gateway-server.js';
import type { TuiSessionSummary } from './tui/protocol.js';
import {
  startWebControlCenterServer,
  type WebControlCenterAdapters,
  type WebControlCenterServer,
} from './web/control-center-server.js';
import {
  state,
  activeCoderRuns,
  activeChatRuns,
  activeChatRunsById,
  tuiMessageQueue,
  telegramDraftDisabledRuns,
  telegramHostStreamedRuns,
  telegramHostCompletedRuns,
  heartbeatLastSent,
  heartbeatLastTargetByChannel,
  compactionMemoryFlushMarkers,
  telegramSettingsPanelActions,
  telegramSetupInputStates,
  tuiRuntimeEvents,
  telegramToolProgressRuns,
  TUI_SENDER_ID,
  TUI_SENDER_NAME,
  SERVICE_STARTED_AT,
  APP_VERSION,
  TELEGRAM_SETTINGS_PANEL_PREFIX,
  TELEGRAM_SETTINGS_PANEL_TTL_MS,
  TELEGRAM_SETUP_INPUT_TTL_MS,
  TELEGRAM_MODEL_PANEL_PAGE_SIZE,
  type ActiveCoderRun,
  type ThinkLevel,
  type ReasoningLevel,
  type QueueMode,
  type QueueDropPolicy,
  type PanelScope,
  type ChatRunPreferences,
  type ChatUsageStats,
  type PiModelEntry,
  type TelegramSetupInputKind,
  type TelegramSetupInputState,
  type TelegramSettingsPanelAction,
  type ActiveChatRun,
  type TelegramAttachmentHint,
  type TelegramResolvedAttachment,
  type TelegramToolProgressState,
} from './app-state.js';

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
const HEARTBEAT_PROMPT = PARITY_CONFIG.heartbeat.prompt;
const HEARTBEAT_INTERVAL_MS =
  parseDurationMs(PARITY_CONFIG.heartbeat.every || '30m') || 30 * 60 * 1000;
const HEARTBEAT_ENABLED = PARITY_CONFIG.heartbeat.enabled && HEARTBEAT_INTERVAL_MS > 0;
const HEARTBEAT_ACTIVE_HOURS_RAW = resolveHeartbeatActiveHoursRaw();
const HEARTBEAT_ACK_MAX_CHARS = Math.max(0, PARITY_CONFIG.heartbeat.ackMaxChars || 300);
const HEARTBEAT_ACTIVE_HOURS = parseHeartbeatActiveHours(HEARTBEAT_ACTIVE_HOURS_RAW);
const HEARTBEAT_TARGET = PARITY_CONFIG.heartbeat.target;
const HEARTBEAT_TARGET_TO = PARITY_CONFIG.heartbeat.to;
const HEARTBEAT_TARGET_ACCOUNT_ID = PARITY_CONFIG.heartbeat.accountId;
const HEARTBEAT_SHOW_OK = PARITY_CONFIG.heartbeat.visibility.showOk;
const HEARTBEAT_SHOW_ALERTS = PARITY_CONFIG.heartbeat.visibility.showAlerts;
const HEARTBEAT_INCLUDE_REASONING = PARITY_CONFIG.heartbeat.includeReasoning;

const GROUP_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const TELEGRAM_MEDIA_MAX_BYTES = TELEGRAM_MEDIA_MAX_MB * 1024 * 1024;
const TELEGRAM_CAPTION_MAX_CHARS = 1024;
const TELEGRAM_ATTACHMENT_HINT_RE = /\[Attachment\b([^\]]*)\]/gi;
const TELEGRAM_MARKDOWN_IMAGE_RE = /!\[([^\]]*)\]\(([^)\n]+)\)/g;
const TELEGRAM_MARKDOWN_LINK_RE = /\[[^\]]+\]\(([^)\n]+)\)/g;
const TELEGRAM_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
interface GitInfo {
  branch?: string;
  commit?: string;
}

function resolveGitInfo(): GitInfo {
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf-8',
    }).trim();
    const commit = execSync('git rev-parse --short HEAD', {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf-8',
    }).trim();
    return {
      branch: branch || undefined,
      commit: commit || undefined,
    };
  } catch {
    return {};
  }
}

const GIT_INFO = resolveGitInfo();

/**
 * Translate a JID from LID format to phone format if we have a mapping.
 * Returns the original JID if no mapping exists.
 */
function translateJid(jid: string): string {
  if (!jid.endsWith('@lid')) return jid;
  const lidUser = jid.split('@')[0].split(':')[0];
  const phoneJid = state.lidToPhoneMap[lidUser];
  if (phoneJid) {
    logger.debug({ lidJid: jid, phoneJid }, 'Translated LID to phone JID');
    return phoneJid;
  }
  return jid;
}

async function setTyping(jid: string, isTyping: boolean): Promise<void> {
  if (isTelegramJid(jid)) {
    if (!state.telegramBot) return;
    try {
      await state.telegramBot.setTyping(jid, isTyping);
    } catch (err) {
      logger.debug({ jid, err }, 'Failed to update Telegram typing status');
    }
    return;
  }

  if (!state.sock) return;
  try {
    await state.sock.sendPresenceUpdate(isTyping ? 'composing' : 'paused', jid);
  } catch (err) {
    logger.debug({ jid, err }, 'Failed to update typing status');
  }
}

function loadState(): void {
  const statePath = path.join(DATA_DIR, 'router_state.json');
  const loaded = loadJson<{
    last_timestamp?: string;
    last_agent_timestamp?: Record<string, string>;
    chat_run_preferences?: Record<string, ChatRunPreferences>;
    chat_usage_stats?: Record<string, ChatUsageStats>;
  }>(statePath, {});
  state.lastTimestamp = loaded.last_timestamp || '';
  state.lastAgentTimestamp = loaded.last_agent_timestamp || {};
  state.chatRunPreferences = loaded.chat_run_preferences || {};
  state.chatUsageStats = loaded.chat_usage_stats || {};
  const rawRegisteredGroups = loadJson<Record<string, RegisteredGroup>>(
    path.join(DATA_DIR, 'registered_groups.json'),
    {},
  );
  state.registeredGroups = {};
  for (const [jid, group] of Object.entries(rawRegisteredGroups)) {
    if (!isValidGroupFolder(group.folder)) {
      logger.warn(
        { jid, folder: group.folder },
        'Skipping registered group with invalid folder from state',
      );
      continue;
    }
    state.registeredGroups[jid] = group;
  }
  logger.info(
    { groupCount: Object.keys(state.registeredGroups).length },
    'State loaded',
  );
}

function saveState(): void {
  saveJson(path.join(DATA_DIR, 'router_state.json'), {
    last_timestamp: state.lastTimestamp,
    last_agent_timestamp: state.lastAgentTimestamp,
    chat_run_preferences: state.chatRunPreferences,
    chat_usage_stats: state.chatUsageStats,
  });
}

function registerGroup(jid: string, group: RegisteredGroup): void {
  let groupDir: string;
  try {
    groupDir = resolveGroupFolderPath(group.folder);
  } catch (err) {
    logger.warn(
      { jid, folder: group.folder, err },
      'Rejecting group registration with invalid folder',
    );
    return;
  }

  state.registeredGroups[jid] = group;
  saveJson(path.join(DATA_DIR, 'registered_groups.json'), state.registeredGroups);

  // Create group folder
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
      `# ${ASSISTANT_NAME}\n\nThis is the memory and working directory for: ${group.name}.\n`,
    );
  }

  ensureMemoryScaffold(group.folder);

  logger.info(
    { jid, name: group.name, folder: group.folder },
    'Group registered',
  );
  if (group.folder === MAIN_GROUP_FOLDER) {
    void maybeRunBootMdOnce();
  }
}

function migrateCompactionSummariesFromSoul(): void {
  const groupFolders = new Set<string>();
  for (const group of Object.values(state.registeredGroups)) {
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
  if (!state.sock?.user?.id) return;
  if (hasMainGroup()) return;

  const phoneUser = state.sock.user.id.split(':')[0];
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
    const groups = await state.sock!.groupFetchAllParticipating();

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
  const registeredJids = new Set(Object.keys(state.registeredGroups));

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
  if (state.registeredGroups[chatJid]) return false;

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
  return Object.values(state.registeredGroups).some(
    (g) => g.folder === MAIN_GROUP_FOLDER,
  );
}

function promoteChatToMain(chatJid: string, chatName: string): void {
  const prev = state.registeredGroups[chatJid];
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
  const prev = state.registeredGroups[chatJid];
  if (!prev) return;
  if (prev.folder === MAIN_GROUP_FOLDER) return;

  promoteChatToMain(chatJid, prev.name || `${ASSISTANT_NAME} (main)`);
}

function isMainChat(chatJid: string): boolean {
  return state.registeredGroups[chatJid]?.folder === MAIN_GROUP_FOLDER;
}

function resolveMainOnboardingGate(chatJid: string): {
  active: boolean;
  pending: boolean;
} {
  if (!isMainChat(chatJid)) return { active: false, pending: false };
  if (PARITY_CONFIG.workspace.skipBootstrap) return { active: false, pending: false };
  if (!PARITY_CONFIG.workspace.enforceBootstrapGate) return { active: false, pending: false };

  // Ensure first-message gate checks observe freshly seeded bootstrap state.
  ensureMainWorkspaceBootstrap({ workspaceDir: MAIN_WORKSPACE_DIR });
  const status = getMainWorkspaceOnboardingStatus(MAIN_WORKSPACE_DIR);
  if (!status.pending) return { active: false, pending: false };

  const enforceForWorkspace =
    status.gateEligible || PARITY_CONFIG.workspace.enforceBootstrapGateForExisting;
  return {
    active: enforceForWorkspace,
    pending: true,
  };
}

function isCoderDelegationCommand(content: string): boolean {
  return /^\/(?:coder|coder-plan|coder_plan)(?:@[A-Za-z0-9_]+)?(?:\s|$)/i.test(content.trim());
}

function onboardingCommandBlockedText(): string {
  return `${ASSISTANT_NAME}: onboarding is in progress. Finish the bootstrap interview before using coder delegation commands.`;
}

function buildOnboardingInterviewPrompt(params: {
  prompt: string;
  latestUserText: string;
}): string {
  return [
    '[ONBOARDING INTERVIEW MODE]',
    'Main workspace onboarding is pending. Continue first-run interview flow now.',
    'Use BOOTSTRAP.md instructions. Ask one concise question at a time and keep the exchange practical.',
    'Update USER.md, IDENTITY.md, SOUL.md, PRINCIPLES.md, and TOOLS.md as needed based on user responses.',
    `When onboarding is complete, remove BOOTSTRAP.md and include the token ${MAIN_ONBOARDING_COMPLETION_TOKEN} exactly once on its own line in your final reply.`,
    '',
    '[LATEST USER MESSAGE]',
    params.latestUserText,
    '',
    '[RECENT CHAT CONTEXT]',
    params.prompt,
  ].join('\n');
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
  for (const [jid, group] of Object.entries(state.registeredGroups)) {
    if (group.folder === MAIN_GROUP_FOLDER && isTelegramJid(jid)) {
      return jid;
    }
  }
  return null;
}

function findMainChatJid(): string | null {
  for (const [jid, group] of Object.entries(state.registeredGroups)) {
    if (group.folder === MAIN_GROUP_FOLDER) return jid;
  }
  return null;
}

function getChannelForJid(jid: string): 'telegram' | 'whatsapp' {
  return isTelegramJid(jid) ? 'telegram' : 'whatsapp';
}

function rememberHeartbeatTarget(jid: string): void {
  const channel = getChannelForJid(jid);
  heartbeatLastTargetByChannel.set(channel, jid);
  state.heartbeatLastTargetAny = jid;
}

function resolveHeartbeatTargetJid(mainChatJid: string): string | null {
  const explicitTarget = HEARTBEAT_TARGET;
  if (explicitTarget === 'none') return null;
  if (explicitTarget === 'main') {
    if (HEARTBEAT_TARGET_TO?.trim()) {
      if (isTelegramJid(mainChatJid)) {
        const parsed = parseTelegramTargetJid(HEARTBEAT_TARGET_TO);
        return parsed || mainChatJid;
      }
      return HEARTBEAT_TARGET_TO.includes('@')
        ? HEARTBEAT_TARGET_TO
        : `${HEARTBEAT_TARGET_TO}@s.whatsapp.net`;
    }
    return mainChatJid;
  }
  if (explicitTarget === 'last') {
    return state.heartbeatLastTargetAny || mainChatJid;
  }
  if (explicitTarget === 'telegram') {
    if (HEARTBEAT_TARGET_TO?.trim()) {
      return parseTelegramTargetJid(HEARTBEAT_TARGET_TO) || findMainTelegramChatJid();
    }
    return heartbeatLastTargetByChannel.get('telegram') || findMainTelegramChatJid();
  }
  if (explicitTarget === 'whatsapp') {
    if (HEARTBEAT_TARGET_TO?.trim()) {
      return HEARTBEAT_TARGET_TO.includes('@')
        ? HEARTBEAT_TARGET_TO
        : `${HEARTBEAT_TARGET_TO}@s.whatsapp.net`;
    }
    return heartbeatLastTargetByChannel.get('whatsapp') || mainChatJid;
  }
  if (explicitTarget === 'chat') {
    if (!HEARTBEAT_TARGET_TO?.trim()) return mainChatJid;
    const raw = HEARTBEAT_TARGET_TO.trim();
    if (raw.startsWith('telegram:')) return parseTelegramTargetJid(raw) || mainChatJid;
    if (raw.includes('@')) return raw;
    const asTelegram = parseTelegramTargetJid(raw);
    if (asTelegram) return asTelegram;
    return `${raw}@s.whatsapp.net`;
  }
  return mainChatJid;
}

async function maybeRunBootMdOnce(): Promise<void> {
  if (!PARITY_CONFIG.workspace.enableBootMd || state.bootRunInFlight) return;
  const bootPath = path.join(MAIN_WORKSPACE_DIR, 'BOOT.md');
  let bootBody = '';
  try {
    if (!fs.existsSync(bootPath)) return;
    bootBody = fs.readFileSync(bootPath, 'utf-8').trim();
  } catch (err) {
    logger.debug({ err }, 'Failed to read BOOT.md');
    return;
  }
  if (!bootBody) return;

  const bootHash = computeBootFileHash(bootBody);
  const wsState = readMainWorkspaceState(MAIN_WORKSPACE_DIR);
  if (wsState.bootHash === bootHash && wsState.bootExecutedAt) {
    return;
  }

  const mainChatJid = findMainChatJid();
  if (!mainChatJid) {
    logger.debug('Skipping BOOT.md run: main chat not registered yet');
    return;
  }
  const group = state.registeredGroups[mainChatJid];
  if (!group || group.folder !== MAIN_GROUP_FOLDER) {
    return;
  }

  state.bootRunInFlight = true;
  const requestId = `boot-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  try {
    const run = await runAgent(
      group,
      '[BOOT STARTUP RUN]\nRead BOOT.md and execute safe startup checklist items. Reply BOOT_OK if nothing needs to be reported.',
      mainChatJid,
      'none',
      requestId,
      {},
      { suppressErrorReply: true },
    );
    updateChatUsage(mainChatJid, run.usage);
    markMainWorkspaceBootExecuted({
      workspaceDir: MAIN_WORKSPACE_DIR,
      bootHash,
    });
    if (run.ok && run.result?.trim() && !/^BOOT_OK\b/i.test(run.result.trim())) {
      await sendMessage(mainChatJid, `[BOOT]\n${run.result.trim()}`);
      rememberHeartbeatTarget(mainChatJid);
    }
    logger.info({ requestId }, 'BOOT.md startup run completed');
  } catch (err) {
    logger.warn({ err, requestId }, 'BOOT.md startup run failed');
  } finally {
    state.bootRunInFlight = false;
  }
}

function getSessionKeyForChat(chatJid: string): string {
  return isMainChat(chatJid) ? 'main' : chatJid;
}

function resolveChatJidForSessionKey(sessionKey: string): string | null {
  const trimmed = sessionKey.trim();
  if (!trimmed) return null;
  if (trimmed === 'main') return findMainChatJid();
  return state.registeredGroups[trimmed] ? trimmed : null;
}

function buildTuiSessionList(): TuiSessionSummary[] {
  const chatByJid = new Map(getAllChats().map((chat) => [chat.jid, chat] as const));
  const sessions: TuiSessionSummary[] = [];

  for (const [jid, group] of Object.entries(state.registeredGroups)) {
    const chat = chatByJid.get(jid);
    sessions.push({
      sessionKey: getSessionKeyForChat(jid),
      chatJid: jid,
      name: chat?.name || group.name || jid,
      isMain: group.folder === MAIN_GROUP_FOLDER,
      lastActivity: chat?.last_message_time,
    });
  }

  sessions.sort((a, b) => {
    const aMain = a.isMain ? 1 : 0;
    const bMain = b.isMain ? 1 : 0;
    if (aMain !== bMain) return bMain - aMain;
    return (b.lastActivity || '').localeCompare(a.lastActivity || '');
  });
  return sessions;
}

function normalizeAssistantHistoryContent(content: string): string {
  const prefix = `${ASSISTANT_NAME}:`;
  if (content.startsWith(prefix)) {
    return content.slice(prefix.length).trimStart();
  }
  return content;
}

function getTuiSessionHistory(chatJid: string, limit: number): SessionHistoryMessage[] {
  const rows = getChatHistory(chatJid, limit);
  return rows.map((row) => {
    const role = row.is_from_me ? 'assistant' : 'user';
    return {
      role,
      text:
        role === 'assistant'
          ? normalizeAssistantHistoryContent(row.content)
          : row.content,
      timestamp: row.timestamp,
    };
  });
}

function emitTuiChatEvent(payload: {
  runId: string;
  sessionKey: string;
  state: 'message' | 'final' | 'aborted' | 'error';
  message?: { role: 'user' | 'assistant' | 'system'; content: string };
  errorMessage?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    provider?: string;
    model?: string;
  };
}): void {
  tuiRuntimeEvents.emit({
    kind: 'chat',
    payload: {
      ...payload,
      timestamp: new Date().toISOString(),
    },
  });
}

function emitTuiAgentEvent(payload: {
  runId: string;
  sessionKey: string;
  phase: 'start' | 'end' | 'error';
  detail?: string;
}): void {
  tuiRuntimeEvents.emit({
    kind: 'agent',
    payload: {
      runId: payload.runId,
      stream: 'lifecycle',
      sessionKey: payload.sessionKey,
      data: {
        phase: payload.phase,
        detail: payload.detail,
      },
    },
  });
}

function emitTuiToolEvent(payload: {
  runId: string;
  sessionKey: string;
  index: number;
  toolName: string;
  status: 'start' | 'ok' | 'error';
  args?: string;
  output?: string;
  error?: string;
}): void {
  tuiRuntimeEvents.emit({
    kind: 'agent',
    payload: {
      runId: payload.runId,
      stream: 'tool',
      sessionKey: payload.sessionKey,
      data: {
        index: payload.index,
        toolName: payload.toolName,
        status: payload.status,
        ...(payload.args ? { args: payload.args } : {}),
        ...(payload.output ? { output: payload.output } : {}),
        ...(payload.error ? { error: payload.error } : {}),
      },
    },
  });
}

function makeRunId(prefix = 'run'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function persistAssistantHistory(chatJid: string, text: string, runId?: string): string {
  if (!state.registeredGroups[chatJid]) return '';
  const timestamp = new Date().toISOString();
  const content = text.startsWith(`${ASSISTANT_NAME}:`)
    ? text
    : `${ASSISTANT_NAME}: ${text}`;
  const messageId = runId ? `${runId}:assistant` : `assistant-${Date.now()}`;
  storeHostMessage({
    id: messageId,
    chatJid,
    sender: ASSISTANT_NAME,
    senderName: ASSISTANT_NAME,
    content,
    timestamp,
    isFromMe: true,
  });
  return timestamp;
}

function persistTuiUserHistory(chatJid: string, text: string, runId: string): string {
  const timestamp = new Date().toISOString();
  if (state.registeredGroups[chatJid]) {
    storeHostMessage({
      id: `${runId}:user`,
      chatJid,
      sender: TUI_SENDER_ID,
      senderName: TUI_SENDER_NAME,
      content: text,
      timestamp,
      isFromMe: false,
    });
  }
  return timestamp;
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

function resolveHeartbeatTimezoneLabel(raw: string | undefined): string {
  const value = (raw || '').trim();
  if (!value) return TIMEZONE;
  if (value === 'user' || value === 'local') {
    return process.env.FFT_NANO_USER_TIMEZONE || TIMEZONE;
  }
  return value;
}

function resolveHeartbeatActiveHoursRaw(): string | undefined {
  const cfg = PARITY_CONFIG.heartbeat;
  if (cfg.activeHoursRaw && cfg.activeHoursRaw.trim()) {
    const normalized = cfg.activeHoursRaw.trim();
    if (normalized.includes('@user') || normalized.includes('@local')) {
      return normalized
        .replace(/@user\b/g, `@${resolveHeartbeatTimezoneLabel('user')}`)
        .replace(/@local\b/g, `@${resolveHeartbeatTimezoneLabel('local')}`);
    }
    return normalized;
  }
  if (!cfg.activeHours) return undefined;
  const timezone = resolveHeartbeatTimezoneLabel(cfg.activeHours.timezone);
  return `${cfg.activeHours.start}-${cfg.activeHours.end}@${timezone}`;
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
  if (prefs.verboseMode && prefs.verboseMode !== 'off') {
    next.verboseMode = prefs.verboseMode;
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
  const current = state.chatRunPreferences[chatJid] || {};
  const updated = updater({ ...current });
  const compacted = compactChatRunPreferences(updated);
  if (compacted) {
    state.chatRunPreferences[chatJid] = compacted;
  } else {
    delete state.chatRunPreferences[chatJid];
  }
  saveState();
  return state.chatRunPreferences[chatJid] || {};
}

function getTuiSessionPrefs(chatJid: string): TuiSessionPrefs {
  const prefs = state.chatRunPreferences[chatJid] || {};
  return {
    provider: prefs.provider,
    model: prefs.model,
    thinkLevel: prefs.thinkLevel,
    reasoningLevel: prefs.reasoningLevel,
    verboseMode: prefs.verboseMode,
    noContinueNext: prefs.nextRunNoContinue === true,
  };
}

function patchTuiSessionPrefs(chatJid: string, patch: TuiSessionPrefs): TuiSessionPrefs {
  const next = updateChatRunPreferences(chatJid, (prefs) => {
    if (Object.prototype.hasOwnProperty.call(patch, 'provider')) {
      if (patch.provider?.trim()) prefs.provider = patch.provider.trim();
      else delete prefs.provider;
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'model')) {
      if (patch.model?.trim()) prefs.model = patch.model.trim();
      else delete prefs.model;
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'thinkLevel')) {
      if (patch.thinkLevel && patch.thinkLevel !== 'off') {
        prefs.thinkLevel = patch.thinkLevel;
      } else {
        delete prefs.thinkLevel;
      }
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'reasoningLevel')) {
      if (patch.reasoningLevel && patch.reasoningLevel !== 'off') {
        prefs.reasoningLevel = patch.reasoningLevel;
      } else {
        delete prefs.reasoningLevel;
      }
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'verboseMode')) {
      if (patch.verboseMode && patch.verboseMode !== 'off') {
        prefs.verboseMode = patch.verboseMode;
      } else {
        delete prefs.verboseMode;
      }
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'noContinueNext')) {
      if (patch.noContinueNext) prefs.nextRunNoContinue = true;
      else delete prefs.nextRunNoContinue;
    }
    return prefs;
  });
  return {
    provider: next.provider,
    model: next.model,
    thinkLevel: next.thinkLevel,
    reasoningLevel: next.reasoningLevel,
    verboseMode: next.verboseMode,
    noContinueNext: next.nextRunNoContinue === true,
  };
}

function resetTuiSession(chatJid: string, reason: string): { ok: boolean; reason: string } {
  patchTuiSessionPrefs(chatJid, { noContinueNext: true });
  return { ok: true, reason };
}

function consumeNextRunNoContinue(chatJid: string): boolean {
  const current = state.chatRunPreferences[chatJid];
  if (!current?.nextRunNoContinue) return false;
  updateChatRunPreferences(chatJid, (prefs) => {
    delete prefs.nextRunNoContinue;
    return prefs;
  });
  return true;
}

function getEffectiveModelLabel(chatJid: string): string {
  const prefs = state.chatRunPreferences[chatJid] || {};
  const provider = prefs.provider || process.env.PI_API || '(default-provider)';
  const model = prefs.model || process.env.PI_MODEL || '(default-model)';
  return `${provider}/${model}`;
}

function formatChatRuntimePreferences(chatJid: string): string[] {
  const prefs = state.chatRunPreferences[chatJid] || {};
  const think = prefs.thinkLevel || 'off';
  const reasoning = prefs.reasoningLevel || 'off';
  const verbose = getEffectiveVerboseMode(prefs.verboseMode);
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
    `- chat_tool_progress: ${verbose}`,
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
  const current = state.chatUsageStats[chatJid] || {
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
  state.chatUsageStats[chatJid] = current;
  saveState();
}

function formatUsageText(chatJid: string, scope: 'chat' | 'all' = 'chat'): string {
  if (scope === 'all') {
    const rows = Object.entries(state.chatUsageStats);
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

  const stats = state.chatUsageStats[chatJid];
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
  const piExecutable = resolvePiExecutable();
  if (!piExecutable) {
    return {
      ok: false,
      text:
        'Model listing is unavailable: `pi` was not found on PATH and no repo-local fallback exists at node_modules/.bin/pi. Run setup or install dependencies.',
    };
  }

  const args = ['--list-models'];
  const trimmed = searchText.trim();
  if (trimmed) args.push(trimmed);
  const result = spawnSync(piExecutable, args, {
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 4 * 1024 * 1024,
  });

  if (result.error) {
    return {
      ok: false,
      text: `Failed to run ${piExecutable} --list-models: ${result.error.message}`,
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

function parsePiModelListOutput(output: string): PiModelEntry[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .filter((line) => !/^provider\s{2,}model\b/i.test(line))
    .map((line) => line.trim().split(/\s{2,}/))
    .filter((parts) => parts.length >= 2)
    .map((parts) => ({
      provider: (parts[0] || '').trim(),
      model: (parts[1] || '').trim(),
    }))
    .filter((entry) => entry.provider.length > 0 && entry.model.length > 0);
}

function loadPiModels(forceRefresh = false): { ok: true; entries: PiModelEntry[] } | { ok: false; text: string } {
  if (
    !forceRefresh &&
    state.piModelsCache &&
    Date.now() - state.piModelsCache.loadedAt < 60_000 &&
    state.piModelsCache.entries.length > 0
  ) {
    return { ok: true, entries: state.piModelsCache.entries };
  }

  const piExecutable = resolvePiExecutable();
  if (!piExecutable) {
    return {
      ok: false,
      text:
        'Model picker is unavailable because `pi` is not installed for the running service.',
    };
  }

  const result = spawnSync(piExecutable, ['--list-models'], {
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 4 * 1024 * 1024,
  });
  const entries =
    !result.error && result.status === 0 ? parsePiModelListOutput(result.stdout || '') : [];
  const piFailureText = result.error
    ? `Failed to load models from ${piExecutable}: ${result.error.message}`
    : result.status !== 0
      ? ((result.stderr || result.stdout || '').trim() ||
          `pi --list-models exited with code ${result.status ?? 'unknown'}`)
      : 'Model picker is unavailable because pi returned no models.';

  // Append locally available Ollama models
  const ollamaResult = spawnSync('ollama', ['list'], { encoding: 'utf8' });
  if (!ollamaResult.error && ollamaResult.status === 0) {
    const ollamaModels = (ollamaResult.stdout || '')
      .split(/\r?\n/)
      .slice(1) // skip header row
      .map((line) => line.trim().split(/\s+/)[0])
      .filter((name): name is string => !!name && name.length > 0);
    for (const model of ollamaModels) {
      entries.push({ provider: 'ollama', model });
    }
  }

  if (entries.length === 0) {
    return {
      ok: false,
      text: piFailureText,
    };
  }

  state.piModelsCache = { entries, loadedAt: Date.now() };
  return { ok: true, entries };
}

function getRuntimeConfigEnv(): Record<string, string | undefined> {
  const saved = loadDotEnvMap(getDefaultDotEnvPath(process.cwd()));
  return { ...saved, ...process.env };
}

function getRuntimeConfigSummaryLines(): string[] {
  const snapshot = resolveRuntimeConfigSnapshot(getRuntimeConfigEnv());
  const label =
    snapshot.providerPreset === 'manual'
      ? `manual (${snapshot.provider})`
      : getRuntimeProviderDefinitionByPreset(snapshot.providerPreset).label;
  return [
    `Provider: ${label}`,
    `Model: ${snapshot.model}`,
    `API key (${snapshot.apiKeyEnv}): ${snapshot.apiKeyConfigured ? 'set' : 'missing'}`,
    snapshot.endpointEnv
      ? `Endpoint (${snapshot.endpointEnv}): ${snapshot.endpointValue || '(default)'}`
      : 'Endpoint: provider default',
  ];
}

function persistRuntimeConfigUpdates(updates: Record<string, string | undefined>): void {
  const envPath = getDefaultDotEnvPath(process.cwd());
  upsertDotEnv(envPath, updates);
  applyProcessEnvUpdates(updates);
  state.piModelsCache = null;
}

function setTelegramSetupInputState(chatJid: string, kind: TelegramSetupInputKind): void {
  telegramSetupInputStates.set(chatJid, {
    kind,
    expiresAt: Date.now() + TELEGRAM_SETUP_INPUT_TTL_MS,
  });
}

function clearTelegramSetupInputState(chatJid: string): void {
  telegramSetupInputStates.delete(chatJid);
}

function getTelegramSetupInputState(chatJid: string): TelegramSetupInputState | null {
  const current = telegramSetupInputStates.get(chatJid);
  if (!current) return null;
  if (current.expiresAt <= Date.now()) {
    telegramSetupInputStates.delete(chatJid);
    return null;
  }
  return current;
}

function buildTelegramSetupHomePanel(chatJid: string): {
  text: string;
  keyboard: TelegramInlineKeyboard;
} {
  return {
    text: [
      'Runtime setup wizard (.env + live runtime defaults):',
      ...getRuntimeConfigSummaryLines(),
      '',
      'Provider/model/key changes apply to new runs immediately. Endpoint override writes OPENAI_BASE_URL + PI_BASE_URL for openai-compatible endpoints.',
    ].join('\n'),
    keyboard: [
      [
        {
          text: 'Provider',
          callbackData: registerTelegramSettingsPanelAction(chatJid, {
            kind: 'show-setup-providers',
          }),
        },
        {
          text: 'Model',
          callbackData: registerTelegramSettingsPanelAction(chatJid, {
            kind: 'prompt-setup-model',
          }),
        },
      ],
      [
        {
          text: 'API Key',
          callbackData: registerTelegramSettingsPanelAction(chatJid, {
            kind: 'show-setup-api-key',
          }),
        },
        {
          text: 'Endpoint',
          callbackData: registerTelegramSettingsPanelAction(chatJid, {
            kind: 'show-setup-endpoint',
          }),
        },
      ],
      [
        {
          text: 'Restart Gateway',
          callbackData: registerTelegramSettingsPanelAction(chatJid, {
            kind: 'restart-gateway',
          }),
        },
        {
          text: 'Refresh',
          callbackData: registerTelegramSettingsPanelAction(chatJid, {
            kind: 'show-setup-home',
          }),
        },
      ],
    ],
  };
}

function buildTelegramSetupProviderPanel(chatJid: string): {
  text: string;
  keyboard: TelegramInlineKeyboard;
} {
  const rows: TelegramInlineKeyboard = [];
  for (let i = 0; i < RUNTIME_PROVIDER_DEFINITIONS.length; i += 2) {
    rows.push(
      RUNTIME_PROVIDER_DEFINITIONS.slice(i, i + 2).map((provider) => ({
        text: provider.label,
        callbackData: registerTelegramSettingsPanelAction(chatJid, {
          kind: 'set-setup-provider',
          preset: provider.id,
        }),
      })),
    );
  }
  rows.push([
    {
      text: 'Manual Provider',
      callbackData: registerTelegramSettingsPanelAction(chatJid, {
        kind: 'prompt-setup-provider',
      }),
    },
  ]);
  rows.push([
    {
      text: 'Home',
      callbackData: registerTelegramSettingsPanelAction(chatJid, { kind: 'show-setup-home' }),
    },
  ]);
  return {
    text: [
      'Choose a default provider preset:',
      ...getRuntimeConfigSummaryLines(),
      '',
      'Manual provider writes raw PI_API and uses PI_API_KEY.',
    ].join('\n'),
    keyboard: rows,
  };
}

function buildTelegramSetupModelPanel(
  chatJid: string,
  preset: RuntimeProviderPreset,
  page = 0,
): { text: string; keyboard: TelegramInlineKeyboard } {
  const provider = getRuntimeProviderDefinitionByPreset(preset);
  if (provider.modelInputMode === 'typed') {
    const snapshot = resolveRuntimeConfigSnapshot(getRuntimeConfigEnv());
    return {
      text: [
        `${provider.label} uses typed model entry.`,
        `Current: ${snapshot.model}`,
        '',
        'Set the raw model id exposed by your local server.',
      ].join('\n'),
      keyboard: [
        [
          {
            text: 'Type Model',
            callbackData: registerTelegramSettingsPanelAction(chatJid, {
              kind: 'prompt-setup-model-typed',
            }),
          },
        ],
        [
          {
            text: 'Providers',
            callbackData: registerTelegramSettingsPanelAction(chatJid, {
              kind: 'show-setup-providers',
            }),
          },
        ],
        [
          {
            text: 'Home',
            callbackData: registerTelegramSettingsPanelAction(chatJid, {
              kind: 'show-setup-home',
            }),
          },
        ],
      ],
    };
  }
  const loaded = loadPiModels();
  if (!loaded.ok) {
    return {
      text: `Model picker error:\n${loaded.text}`,
      keyboard: [
        [
          {
            text: 'Type Model',
            callbackData: registerTelegramSettingsPanelAction(chatJid, {
              kind: 'prompt-setup-model-typed',
            }),
          },
        ],
        [
          {
            text: 'Home',
            callbackData: registerTelegramSettingsPanelAction(chatJid, {
              kind: 'show-setup-home',
            }),
          },
        ],
      ],
    };
  }

  const models = loaded.entries
    .filter((entry) => entry.provider === provider.piApi)
    .map((entry) => entry.model)
    .sort((a, b) => a.localeCompare(b));
  if (models.length === 0) {
    return {
      text: [
        `No picker models were returned for ${provider.label}.`,
        '',
        'Use typed model entry instead.',
      ].join('\n'),
      keyboard: [
        [
          {
            text: 'Type Model',
            callbackData: registerTelegramSettingsPanelAction(chatJid, {
              kind: 'prompt-setup-model-typed',
            }),
          },
        ],
        [
          {
            text: 'Home',
            callbackData: registerTelegramSettingsPanelAction(chatJid, {
              kind: 'show-setup-home',
            }),
          },
        ],
      ],
    };
  }

  const snapshot = resolveRuntimeConfigSnapshot(getRuntimeConfigEnv());
  const totalPages = Math.max(1, Math.ceil(models.length / TELEGRAM_MODEL_PANEL_PAGE_SIZE));
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const start = safePage * TELEGRAM_MODEL_PANEL_PAGE_SIZE;
  const pageModels = models.slice(start, start + TELEGRAM_MODEL_PANEL_PAGE_SIZE);
  const rows: TelegramInlineKeyboard = [];
  for (let i = 0; i < pageModels.length; i += 2) {
    rows.push(
      pageModels.slice(i, i + 2).map((model) => ({
        text: snapshot.model === model ? `* ${truncateButtonLabel(model)}` : truncateButtonLabel(model),
        callbackData: registerTelegramSettingsPanelAction(chatJid, {
          kind: 'set-setup-model',
          preset,
          model,
        }),
      })),
    );
  }
  if (totalPages > 1) {
    const nav: TelegramInlineKeyboard[number] = [];
    if (safePage > 0) {
      nav.push({
        text: 'Prev',
        callbackData: registerTelegramSettingsPanelAction(chatJid, {
          kind: 'show-setup-models',
          preset,
          page: safePage - 1,
        }),
      });
    }
    if (safePage < totalPages - 1) {
      nav.push({
        text: 'Next',
        callbackData: registerTelegramSettingsPanelAction(chatJid, {
          kind: 'show-setup-models',
          preset,
          page: safePage + 1,
        }),
      });
    }
    if (nav.length > 0) rows.push(nav);
  }
  rows.push([
    {
      text: 'Type Model',
      callbackData: registerTelegramSettingsPanelAction(chatJid, {
        kind: 'prompt-setup-model-typed',
      }),
    },
    {
      text: 'Providers',
      callbackData: registerTelegramSettingsPanelAction(chatJid, {
        kind: 'show-setup-providers',
      }),
    },
  ]);
  rows.push([
    {
      text: 'Home',
      callbackData: registerTelegramSettingsPanelAction(chatJid, {
        kind: 'show-setup-home',
      }),
    },
  ]);
  return {
    text: [
      `Select a default ${provider.label} model:`,
      `Current: ${snapshot.model}`,
      `Page ${safePage + 1} of ${totalPages}`,
    ].join('\n'),
    keyboard: rows,
  };
}

function buildTelegramSetupEndpointPanel(chatJid: string): {
  text: string;
  keyboard: TelegramInlineKeyboard;
} {
  const snapshot = resolveRuntimeConfigSnapshot(getRuntimeConfigEnv());
  return {
    text: [
      'Endpoint override:',
      `Current: ${snapshot.endpointValue || '(default)'}`,
      '',
      'This writes OPENAI_BASE_URL and PI_BASE_URL for openai-compatible/local endpoints.',
    ].join('\n'),
    keyboard: [
      [
        {
          text: 'Set Endpoint',
          callbackData: registerTelegramSettingsPanelAction(chatJid, {
            kind: 'prompt-setup-endpoint',
          }),
        },
        {
          text: 'Clear',
          callbackData: registerTelegramSettingsPanelAction(chatJid, {
            kind: 'clear-setup-endpoint',
          }),
        },
      ],
      [
        {
          text: 'Home',
          callbackData: registerTelegramSettingsPanelAction(chatJid, { kind: 'show-setup-home' }),
        },
      ],
    ],
  };
}

function buildTelegramSetupApiKeyPanel(chatJid: string): {
  text: string;
  keyboard: TelegramInlineKeyboard;
} {
  const snapshot = resolveRuntimeConfigSnapshot(getRuntimeConfigEnv());
  return {
    text: [
      'API key setup:',
      `Target env: ${snapshot.apiKeyEnv}`,
      `Current status: ${snapshot.apiKeyConfigured ? 'set' : 'missing'}`,
      '',
      'The next plain-text message you send can be captured as the new key.',
    ].join('\n'),
    keyboard: [
      [
        {
          text: 'Set Key',
          callbackData: registerTelegramSettingsPanelAction(chatJid, {
            kind: 'prompt-setup-api-key',
          }),
        },
        {
          text: 'Clear',
          callbackData: registerTelegramSettingsPanelAction(chatJid, {
            kind: 'clear-setup-api-key',
          }),
        },
      ],
      [
        {
          text: 'Home',
          callbackData: registerTelegramSettingsPanelAction(chatJid, { kind: 'show-setup-home' }),
        },
      ],
    ],
  };
}

function pruneTelegramSettingsPanelActions(): void {
  const now = Date.now();
  for (const [token, state] of telegramSettingsPanelActions.entries()) {
    if (state.expiresAt <= now) telegramSettingsPanelActions.delete(token);
  }
}

function registerTelegramSettingsPanelAction(
  chatJid: string,
  action: TelegramSettingsPanelAction,
): string {
  pruneTelegramSettingsPanelActions();
  let token = '';
  do {
    token = Math.random().toString(36).slice(2, 10);
  } while (telegramSettingsPanelActions.has(token));
  telegramSettingsPanelActions.set(token, {
    chatJid,
    action,
    expiresAt: Date.now() + TELEGRAM_SETTINGS_PANEL_TTL_MS,
  });
  return `${TELEGRAM_SETTINGS_PANEL_PREFIX}${token}`;
}

function getTelegramSettingsPanelAction(
  chatJid: string,
  callbackData: string,
): TelegramSettingsPanelAction | null {
  if (!callbackData.startsWith(TELEGRAM_SETTINGS_PANEL_PREFIX)) return null;
  pruneTelegramSettingsPanelActions();
  const token = callbackData.slice(TELEGRAM_SETTINGS_PANEL_PREFIX.length);
  if (!token) return null;
  const state = telegramSettingsPanelActions.get(token);
  if (!state || state.chatJid !== chatJid) return null;
  return state.action;
}

function truncateButtonLabel(text: string, max = 28): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function formatTelegramSettingsPanelSummary(chatJid: string): string[] {
  const prefs = state.chatRunPreferences[chatJid] || {};
  return [
    `Model: ${getEffectiveModelLabel(chatJid)}`,
    `Think: ${prefs.thinkLevel || 'off'}`,
    `Reasoning: ${prefs.reasoningLevel || 'off'}`,
    `Tool progress: ${getEffectiveVerboseMode(prefs.verboseMode)}`,
    `Next fresh run: ${prefs.nextRunNoContinue ? 'yes' : 'no'}`,
  ];
}

function buildTelegramSettingsHomePanel(chatJid: string): {
  text: string;
  keyboard: TelegramInlineKeyboard;
} {
  return {
    text: ['Runtime controls for this chat:', ...formatTelegramSettingsPanelSummary(chatJid)].join('\n'),
    keyboard: [
      [
        {
          text: 'Models',
          callbackData: registerTelegramSettingsPanelAction(chatJid, {
            kind: 'show-model-providers',
          }),
        },
        {
          text: 'Think',
          callbackData: registerTelegramSettingsPanelAction(chatJid, { kind: 'show-think' }),
        },
      ],
      [
        {
          text: 'Queue',
          callbackData: registerTelegramSettingsPanelAction(chatJid, { kind: 'show-queue' }),
        },
        {
          text: 'Fresh Next Run',
          callbackData: registerTelegramSettingsPanelAction(chatJid, { kind: 'trigger-new' }),
        },
      ],
      [
        {
          text: 'Reasoning',
          callbackData: registerTelegramSettingsPanelAction(chatJid, {
            kind: 'show-reasoning',
          }),
        },
        {
          text: 'Verbose',
          callbackData: registerTelegramSettingsPanelAction(chatJid, { kind: 'show-verbose' }),
        },
      ],
      [
        {
          text: 'Reset Model',
          callbackData: registerTelegramSettingsPanelAction(chatJid, {
            kind: 'reset-model',
            returnTo: 'home',
          }),
        },
      ],
    ],
  };
}

function buildTelegramModelProviderPanel(chatJid: string): {
  text: string;
  keyboard: TelegramInlineKeyboard;
} {
  const loaded = loadPiModels();
  if (!loaded.ok) {
    return {
      text: `Model picker error:\n${loaded.text}`,
      keyboard: [[{ text: 'Back', callbackData: registerTelegramSettingsPanelAction(chatJid, { kind: 'show-home' }) }]],
    };
  }

  const providerCounts = new Map<string, number>();
  for (const entry of loaded.entries) {
    providerCounts.set(entry.provider, (providerCounts.get(entry.provider) || 0) + 1);
  }
  const providers = Array.from(providerCounts.entries()).sort((a, b) =>
    a[0].localeCompare(b[0]),
  );
  const rows: TelegramInlineKeyboard = [];
  for (let i = 0; i < providers.length; i += 2) {
    const slice = providers.slice(i, i + 2);
    rows.push(
      slice.map(([provider, count]) => ({
        text: `${provider} (${count})`,
        callbackData: registerTelegramSettingsPanelAction(chatJid, {
          kind: 'show-models-for-provider',
          provider,
          page: 0,
        }),
      })),
    );
  }
  rows.push([{ text: 'Back', callbackData: registerTelegramSettingsPanelAction(chatJid, { kind: 'show-home' }) }]);
  return {
    text: ['Select a provider:', ...formatTelegramSettingsPanelSummary(chatJid)].join('\n'),
    keyboard: rows,
  };
}

function buildTelegramProviderModelPanel(
  chatJid: string,
  provider: string,
  page = 0,
): { text: string; keyboard: TelegramInlineKeyboard } {
  const loaded = loadPiModels();
  if (!loaded.ok) {
    return {
      text: `Model picker error:\n${loaded.text}`,
      keyboard: [[{ text: 'Back', callbackData: registerTelegramSettingsPanelAction(chatJid, { kind: 'show-home' }) }]],
    };
  }
  const models = loaded.entries
    .filter((entry) => entry.provider === provider)
    .map((entry) => entry.model)
    .sort((a, b) => a.localeCompare(b));

  const totalPages = Math.max(1, Math.ceil(models.length / TELEGRAM_MODEL_PANEL_PAGE_SIZE));
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const start = safePage * TELEGRAM_MODEL_PANEL_PAGE_SIZE;
  const pageModels = models.slice(start, start + TELEGRAM_MODEL_PANEL_PAGE_SIZE);
  const current = getEffectiveModelLabel(chatJid);

  const rows: TelegramInlineKeyboard = [];
  for (let i = 0; i < pageModels.length; i += 2) {
    rows.push(
      pageModels.slice(i, i + 2).map((model) => {
        const full = `${provider}/${model}`;
        const selected = current === full;
        return {
          text: selected ? `* ${truncateButtonLabel(model)}` : truncateButtonLabel(model),
          callbackData: registerTelegramSettingsPanelAction(chatJid, {
            kind: 'set-model',
            provider,
            model,
            returnTo: 'models',
          }),
        };
      }),
    );
  }

  if (totalPages > 1) {
    const navRow: TelegramInlineKeyboard[number] = [];
    if (safePage > 0) {
      navRow.push({
        text: 'Prev',
        callbackData: registerTelegramSettingsPanelAction(chatJid, {
          kind: 'show-models-for-provider',
          provider,
          page: safePage - 1,
        }),
      });
    }
    if (safePage < totalPages - 1) {
      navRow.push({
        text: 'Next',
        callbackData: registerTelegramSettingsPanelAction(chatJid, {
          kind: 'show-models-for-provider',
          provider,
          page: safePage + 1,
        }),
      });
    }
    if (navRow.length > 0) rows.push(navRow);
  }

  rows.push([
    {
      text: 'Reset Model',
      callbackData: registerTelegramSettingsPanelAction(chatJid, {
        kind: 'reset-model',
        returnTo: 'models',
      }),
    },
    {
      text: 'Providers',
      callbackData: registerTelegramSettingsPanelAction(chatJid, {
        kind: 'show-model-providers',
      }),
    },
  ]);
  rows.push([{ text: 'Home', callbackData: registerTelegramSettingsPanelAction(chatJid, { kind: 'show-home' }) }]);

  return {
    text: [
      `Select a model from ${provider}:`,
      `Current: ${current}`,
      `Page ${safePage + 1} of ${totalPages}`,
    ].join('\n'),
    keyboard: rows,
  };
}

function buildThinkPanel(chatJid: string): { text: string; keyboard: TelegramInlineKeyboard } {
  const current = state.chatRunPreferences[chatJid]?.thinkLevel || 'off';
  const levels: ThinkLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];
  const rows: TelegramInlineKeyboard = [];
  for (let i = 0; i < levels.length; i += 2) {
    rows.push(
      levels.slice(i, i + 2).map((value) => ({
        text: value === current ? `* ${value}` : value,
        callbackData: registerTelegramSettingsPanelAction(chatJid, { kind: 'set-think', value }),
      })),
    );
  }
  rows.push([{ text: 'Home', callbackData: registerTelegramSettingsPanelAction(chatJid, { kind: 'show-home' }) }]);
  return {
    text: `Select thinking level:\nCurrent: ${current}`,
    keyboard: rows,
  };
}

function buildReasoningPanel(chatJid: string): {
  text: string;
  keyboard: TelegramInlineKeyboard;
} {
  const current = state.chatRunPreferences[chatJid]?.reasoningLevel || 'off';
  const levels: ReasoningLevel[] = ['off', 'on', 'stream'];
  return {
    text: `Select reasoning mode:\nCurrent: ${current}`,
    keyboard: [
      levels.map((value) => ({
        text: value === current ? `* ${value}` : value,
        callbackData: registerTelegramSettingsPanelAction(chatJid, {
          kind: 'set-reasoning',
          value,
        }),
      })),
      [{ text: 'Home', callbackData: registerTelegramSettingsPanelAction(chatJid, { kind: 'show-home' }) }],
    ],
  };
}

function buildVerbosePanel(chatJid: string): { text: string; keyboard: TelegramInlineKeyboard } {
  const current = getEffectiveVerboseMode(state.chatRunPreferences[chatJid]?.verboseMode);
  const levels: VerboseMode[] = ['off', 'new', 'all', 'verbose'];
  const rows: TelegramInlineKeyboard = [];
  for (let i = 0; i < levels.length; i += 2) {
    rows.push(
      levels.slice(i, i + 2).map((value) => ({
        text: value === current ? `* ${value}` : value,
        callbackData: registerTelegramSettingsPanelAction(chatJid, {
          kind: 'set-verbose',
          value,
        }),
      })),
    );
  }
  rows.push([
    {
      text: 'Home',
      callbackData: registerTelegramSettingsPanelAction(chatJid, { kind: 'show-home' }),
    },
  ]);
  return {
    text: [
      'Select tool progress mode:',
      `Current: ${current}`,
      'fft_nano tool progress modes: off -> new -> all -> verbose.',
    ].join('\n'),
    keyboard: rows,
  };
}

function buildQueuePanel(chatJid: string): { text: string; keyboard: TelegramInlineKeyboard } {
  const prefs = state.chatRunPreferences[chatJid] || {};
  const current = prefs.queueMode || 'collect';
  const modes: QueueMode[] = ['collect', 'followup', 'interrupt', 'steer', 'steer-backlog'];
  const rows: TelegramInlineKeyboard = [];
  for (let i = 0; i < modes.length; i += 2) {
    rows.push(
      modes.slice(i, i + 2).map((value) => ({
        text: value === current ? `* ${truncateButtonLabel(value, 24)}` : truncateButtonLabel(value, 24),
        callbackData: registerTelegramSettingsPanelAction(chatJid, {
          kind: 'set-queue-mode',
          value,
        }),
      })),
    );
  }
  rows.push([{ text: 'Home', callbackData: registerTelegramSettingsPanelAction(chatJid, { kind: 'show-home' }) }]);
  return {
    text: [
      'Select queue mode:',
      `Current mode: ${current}`,
      `Debounce: ${prefs.queueDebounceMs || 0}ms`,
      `Cap: ${prefs.queueCap || 0}`,
      `Drop policy: ${prefs.queueDrop || 'old'}`,
      '',
      'Buttons change only the mode. Use typed /queue args for debounce, cap, and drop.',
    ].join('\n'),
    keyboard: rows,
  };
}

function buildSubagentsPanel(chatJid: string): { text: string; keyboard: TelegramInlineKeyboard } {
  const text = [
    'Subagent controls:',
    formatActiveSubagentsText(),
    '',
    'Spawn still uses typed text: /subagents spawn <task>',
  ].join('\n');
  return {
    text,
    keyboard: [
      [
        {
          text: 'Refresh',
          callbackData: registerTelegramSettingsPanelAction(chatJid, { kind: 'show-subagents' }),
        },
        {
          text: 'Stop Current',
          callbackData: registerTelegramSettingsPanelAction(chatJid, {
            kind: 'stop-subagents',
            target: 'current',
          }),
        },
      ],
      [
        {
          text: 'Stop All',
          callbackData: registerTelegramSettingsPanelAction(chatJid, {
            kind: 'stop-subagents',
            target: 'all',
          }),
        },
        {
          text: 'Home',
          callbackData: registerTelegramSettingsPanelAction(chatJid, { kind: 'show-home' }),
        },
      ],
    ],
  };
}

function runGatewayServiceCommand(
  action: 'status' | 'restart' | 'doctor',
): { ok: boolean; text: string } {
  if (action === 'doctor') {
    const result = spawnSync('npm', ['run', 'doctor'], {
      encoding: 'utf8',
      env: process.env,
      maxBuffer: 8 * 1024 * 1024,
    });
    if (result.error) {
      return {
        ok: false,
        text: `Failed running doctor command: ${result.error.message}`,
      };
    }
    const output = [result.stdout || '', result.stderr || '']
      .filter((part) => part.trim().length > 0)
      .join('\n')
      .trim();
    const bounded =
      output.length > 12000 ? `${output.slice(0, 12000)}\n\n...output truncated...` : output;
    if (result.status !== 0 && result.status !== 1) {
      return {
        ok: false,
        text: bounded || `Doctor command failed with exit code ${result.status ?? 'unknown'}.`,
      };
    }
    const warn = result.status === 1;
    return {
      ok: true,
      text: bounded || (warn ? 'Doctor completed with warnings.' : 'Doctor command completed.'),
    };
  }

  const scriptPath = path.join(process.cwd(), 'scripts', 'service.sh');
  if (!fs.existsSync(scriptPath)) {
    return {
      ok: false,
      text: `Gateway service script not found: ${scriptPath}`,
    };
  }

  const result = spawnSync('bash', [scriptPath, action], {
    encoding: 'utf8',
    env: {
      ...process.env,
      FFT_NANO_GATEWAY_CALL: '1',
      FFT_NANO_NONINTERACTIVE: '1',
    },
    maxBuffer: 8 * 1024 * 1024,
  });

  if (result.error) {
    return {
      ok: false,
      text: `Failed running gateway service command: ${result.error.message}`,
    };
  }

  const combined = [result.stdout || '', result.stderr || '']
    .filter((part) => part.trim().length > 0)
    .join('\n')
    .trim();
  const bounded =
    combined.length > 12000
      ? `${combined.slice(0, 12000)}\n\n...output truncated...`
      : combined;

  if (
    action === 'restart' &&
    result.status === null &&
    (result.signal === 'SIGTERM' || result.signal === 'SIGKILL')
  ) {
    return {
      ok: true,
      text: bounded || 'Gateway restart handed off to the service manager.',
    };
  }

  if (result.status !== 0) {
    const needsPrivileges = /root privileges|sudo|permission denied|operation not permitted|bootstrap failed|input\/output error/i.test(
      bounded,
    );
    const guidance = needsPrivileges
      ? '\n\nThis action likely needs interactive host privileges. Run ./scripts/service.sh <action> (or fft service <action>) directly in a shell with required permissions.'
      : '';
    return {
      ok: false,
      text:
        (bounded
          ? `${bounded}${guidance}`
          : `Gateway service command failed with exit code ${result.status ?? 'unknown'}.${guidance}`),
    };
  }

  return {
    ok: true,
    text: bounded || `Gateway service command completed: ${action}`,
  };
}

function formatStatusText(chatJid?: string): string {
  const runtime = getContainerRuntime();
  const mainGroup = Object.values(state.registeredGroups).find(
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
    `${ASSISTANT_NAME} status:`,
    `- container_runtime: ${runtime}`,
    `- telegram_enabled: ${TELEGRAM_BOT_TOKEN ? 'yes' : 'no'}`,
    `- whatsapp_enabled: ${WHATSAPP_ENABLED ? 'yes' : 'no'}`,
    `- whatsapp_connected: ${state.sock?.user ? 'yes' : 'no'}`,
    `- registered_groups: ${Object.keys(state.registeredGroups).length}`,
    `- main_group: ${mainGroup ? mainGroup.name : 'none'}`,
    `- tasks_active: ${active}`,
    `- tasks_paused: ${paused}`,
    `- tasks_completed: ${completed}`,
    `- coder_runs_active: ${coderRuns.length}`,
  ];

  if (chatJid) {
    lines.push(...formatChatRuntimePreferences(chatJid));
    const usage = state.chatUsageStats[chatJid];
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

function summarizeTask(taskId: string): string {
  const task = getTaskById(taskId);
  if (!task) return `Task not found: ${taskId}`;
  const lines = [
    `Task ${task.id}:`,
    `- status: ${task.status}`,
    `- group: ${task.group_folder}`,
    `- chat: ${task.chat_jid}`,
    `- schedule: ${task.schedule_type} ${task.schedule_value}`,
    `- next_run: ${task.next_run || 'n/a'}`,
    `- last_run: ${task.last_run || 'n/a'}`,
    `- session_target: ${task.session_target || 'isolated'}`,
    `- wake_mode: ${task.wake_mode || 'next-heartbeat'}`,
    `- delivery: ${task.delivery_mode || 'none'}`,
    `- delivery_to: ${task.delivery_to || 'n/a'}`,
    `- timeout_seconds: ${task.timeout_seconds ?? 'n/a'}`,
    `- stagger_ms: ${task.stagger_ms ?? 'n/a'}`,
    `- consecutive_errors: ${task.consecutive_errors ?? 0}`,
    `- delete_after_run: ${task.delete_after_run ? 'true' : 'false'}`,
  ];
  if (task.last_result) {
    lines.push('', 'Last result:', task.last_result.slice(0, 600));
  }
  return lines.join('\n');
}

function formatTaskRunsText(taskId: string, limit = 10): string {
  const task = getTaskById(taskId);
  if (!task) return `Task not found: ${taskId}`;
  const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));
  const rows = getTaskRunLogs(taskId, safeLimit);
  if (rows.length === 0) {
    return `No run logs found for task ${taskId}.`;
  }
  const lines = rows.map((row) => {
    const err = row.error ? ` err=${row.error.slice(0, 120)}` : '';
    return `- ${row.run_at} [${row.status}] duration_ms=${row.duration_ms}${err}`;
  });
  return [`Task runs for ${taskId} (latest ${safeLimit}):`, ...lines].join('\n');
}

function formatTasksText(mode: 'list' | 'due' = 'list'): string {
  const tasks = mode === 'due' ? getDueTasks() : getAllTasks();
  if (tasks.length === 0) {
    return mode === 'due' ? 'No due tasks right now.' : 'No scheduled tasks found.';
  }
  const lines = tasks.slice(0, 30).map((task) => {
    const nextRun = task.next_run || 'n/a';
    const delivery = task.delivery_mode || 'none';
    const wake = task.wake_mode || 'next-heartbeat';
    const errors = task.consecutive_errors ?? 0;
    return `- ${task.id} [${task.status}] group=${task.group_folder} next=${nextRun} session=${task.session_target || 'isolated'} delivery=${delivery} wake=${wake} errors=${errors}`;
  });
  if (tasks.length > 30) {
    lines.push(`- ... ${tasks.length - 30} more`);
  }
  const prefix = mode === 'due' ? 'Due tasks:' : 'Scheduled tasks:';
  return [prefix, ...lines].join('\n');
}

function formatGroupsText(): string {
  const groups = Object.entries(state.registeredGroups);
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

function resolveTelegramSettingsPanel(
  chatJid: string,
  action: TelegramSettingsPanelAction,
): { text: string; keyboard: TelegramInlineKeyboard } {
  switch (action.kind) {
    case 'show-home':
      return buildTelegramSettingsHomePanel(chatJid);
    case 'show-model-providers':
      return buildTelegramModelProviderPanel(chatJid);
    case 'show-models-for-provider':
      return buildTelegramProviderModelPanel(chatJid, action.provider, action.page);
    case 'show-think':
      return buildThinkPanel(chatJid);
    case 'show-reasoning':
      return buildReasoningPanel(chatJid);
    case 'show-verbose':
      return buildVerbosePanel(chatJid);
    case 'show-queue':
      return buildQueuePanel(chatJid);
    case 'show-subagents':
      return buildSubagentsPanel(chatJid);
    case 'show-setup-home':
      return buildTelegramSetupHomePanel(chatJid);
    case 'show-setup-providers':
      return buildTelegramSetupProviderPanel(chatJid);
    case 'show-setup-models':
      return buildTelegramSetupModelPanel(chatJid, action.preset, action.page);
    case 'show-setup-endpoint':
      return buildTelegramSetupEndpointPanel(chatJid);
    case 'show-setup-api-key':
      return buildTelegramSetupApiKeyPanel(chatJid);
    default:
      return buildTelegramSettingsHomePanel(chatJid);
  }
}

async function sendTelegramSettingsPanel(
  chatJid: string,
  action: TelegramSettingsPanelAction = { kind: 'show-home' },
): Promise<void> {
  if (!state.telegramBot) return;
  const panel = resolveTelegramSettingsPanel(chatJid, action);
  await state.telegramBot.sendMessageWithKeyboard(chatJid, panel.text, panel.keyboard);
}

async function editTelegramSettingsPanel(
  chatJid: string,
  messageId: number,
  action: TelegramSettingsPanelAction,
): Promise<void> {
  if (!state.telegramBot) return;
  const panel = resolveTelegramSettingsPanel(chatJid, action);
  await state.telegramBot.editMessageWithKeyboard(chatJid, messageId, panel.text, panel.keyboard);
}

async function promptTelegramSetupInput(
  chatJid: string,
  kind: TelegramSetupInputKind,
  prompt: string,
): Promise<void> {
  clearTelegramSetupInputState(chatJid);
  setTelegramSetupInputState(chatJid, kind);
  await sendMessage(chatJid, `${prompt}\n\nNext plain-text message will be captured. Send /setup cancel to abort.`);
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

async function maybeRunCompactionMemoryFlush(
  chatJid: string,
  group: RegisteredGroup,
): Promise<void> {
  const flushCfg = PARITY_CONFIG.memory.flushBeforeCompaction;
  if (!flushCfg.enabled) return;

  const usage = state.chatUsageStats[chatJid];
  const currentTokens = usage?.totalTokens || 0;
  if (currentTokens <= 0 || currentTokens < flushCfg.softThresholdTokens) {
    logger.debug(
      { chatJid, currentTokens, threshold: flushCfg.softThresholdTokens },
      'Skipping compaction memory flush (below threshold)',
    );
    return;
  }

  const lastMarker = compactionMemoryFlushMarkers.get(chatJid) || 0;
  if (currentTokens <= lastMarker) {
    logger.debug(
      { chatJid, currentTokens, lastMarker },
      'Skipping compaction memory flush (already flushed this cycle)',
    );
    return;
  }

  const flushRequestId = `memory-flush-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const flushPrompt = [
    '[MEMORY FLUSH BEFORE COMPACTION]',
    flushCfg.systemPrompt,
    flushCfg.prompt,
  ].join('\n');
  const prefs: ChatRunPreferences = { ...(state.chatRunPreferences[chatJid] || {}) };
  delete prefs.nextRunNoContinue;

  const run = await runAgent(
    group,
    flushPrompt,
    chatJid,
    'none',
    flushRequestId,
    prefs,
    { suppressErrorReply: true },
  );
  if (!run.ok) {
    logger.warn(
      { chatJid, flushRequestId },
      'Compaction memory flush run failed',
    );
    return;
  }
  updateChatUsage(chatJid, run.usage);
  compactionMemoryFlushMarkers.set(chatJid, currentTokens);
  logger.info(
    { chatJid, flushRequestId, currentTokens },
    'Compaction memory flush completed',
  );
}

async function runCompactionForChat(
  chatJid: string,
  instructions: string,
): Promise<string> {
  const group = state.registeredGroups[chatJid];
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

  const prefs: ChatRunPreferences = { ...(state.chatRunPreferences[chatJid] || {}) };
  delete prefs.nextRunNoContinue;
  const abortController = new AbortController();
  const activeRun: ActiveChatRun = {
    chatJid,
    startedAt: Date.now(),
    requestId: compactRequestId,
    abortController,
  };
  activeChatRuns.set(chatJid, activeRun);
  activeChatRunsById.set(compactRequestId, activeRun);

  await setTyping(chatJid, true);
  try {
    await maybeRunCompactionMemoryFlush(chatJid, group);

    const run = await runAgent(
      group,
      compactPrompt,
      chatJid,
      'none',
      compactRequestId,
      prefs,
      {},
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
    activeChatRunsById.delete(compactRequestId);
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
  if (!message.media || !state.telegramBot) {
    return message.content;
  }

  const group = state.registeredGroups[message.chatJid];
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
    const downloaded = await state.telegramBot.downloadFile(message.media.fileId);
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
  if (!state.telegramBot) return;

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
      await state.telegramBot.deleteCommands({ type: 'default' });
    } catch (err) {
      logger.debug({ err }, 'Failed deleting default Telegram commands');
    }

    try {
      await state.telegramBot.setCommands(common, { type: 'default' });
    } catch (err) {
      logger.warn(
        { err },
        'Failed setting default Telegram commands; continuing without command menu refresh',
      );
    }

    if (state.lastTelegramMenuMainChatId && state.lastTelegramMenuMainChatId !== mainChatId) {
      try {
        await state.telegramBot.setCommands(common, {
          type: 'chat',
          chatId: state.lastTelegramMenuMainChatId,
        });
      } catch (err) {
        logger.debug({ err }, 'Failed resetting previous main Telegram command scope');
      }
    }

    if (mainChatId) {
      try {
        await state.telegramBot.setCommands(admin, { type: 'chat', chatId: mainChatId });
      } catch (err) {
        logger.warn(
          { err, mainChatId },
          'Failed setting admin Telegram commands for main chat; continuing',
        );
      }
    }

    state.lastTelegramMenuMainChatId = mainChatId;

    try {
      await state.telegramBot.setDescription(
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
  if (!state.telegramBot) return;

  try {
    await state.telegramBot.answerCallbackQuery(q.id);
  } catch (err) {
    logger.debug({ err, callbackId: q.id }, 'Failed answering callback query');
  }

  const settingsAction = getTelegramSettingsPanelAction(q.chatJid, q.data);
  if (settingsAction) {
    switch (settingsAction.kind) {
      case 'show-home':
      case 'show-model-providers':
      case 'show-models-for-provider':
      case 'show-think':
      case 'show-reasoning':
      case 'show-verbose':
      case 'show-queue':
      case 'show-subagents':
      case 'show-setup-home':
      case 'show-setup-providers':
      case 'show-setup-models':
      case 'show-setup-endpoint':
      case 'show-setup-api-key':
        await editTelegramSettingsPanel(q.chatJid, q.messageId, settingsAction);
        return;
      case 'set-model':
        updateChatRunPreferences(q.chatJid, (prefs) => {
          prefs.provider = settingsAction.provider;
          prefs.model = settingsAction.model;
          return prefs;
        });
        await editTelegramSettingsPanel(q.chatJid, q.messageId, {
          kind: 'show-models-for-provider',
          provider: settingsAction.provider,
          page: 0,
        });
        return;
      case 'reset-model':
        updateChatRunPreferences(q.chatJid, (prefs) => {
          delete prefs.provider;
          delete prefs.model;
          return prefs;
        });
        await editTelegramSettingsPanel(
          q.chatJid,
          q.messageId,
          settingsAction.returnTo === 'models'
            ? { kind: 'show-model-providers' }
            : { kind: 'show-home' },
        );
        return;
      case 'set-think':
        updateChatRunPreferences(q.chatJid, (prefs) => {
          if (settingsAction.value === 'off') delete prefs.thinkLevel;
          else prefs.thinkLevel = settingsAction.value;
          return prefs;
        });
        await editTelegramSettingsPanel(q.chatJid, q.messageId, { kind: 'show-think' });
        return;
      case 'set-reasoning':
        updateChatRunPreferences(q.chatJid, (prefs) => {
          if (settingsAction.value === 'off') delete prefs.reasoningLevel;
          else prefs.reasoningLevel = settingsAction.value;
          return prefs;
        });
        await editTelegramSettingsPanel(q.chatJid, q.messageId, { kind: 'show-reasoning' });
        return;
      case 'set-verbose':
        updateChatRunPreferences(q.chatJid, (prefs) => {
          if (settingsAction.value === 'off') delete prefs.verboseMode;
          else prefs.verboseMode = settingsAction.value;
          return prefs;
        });
        await editTelegramSettingsPanel(q.chatJid, q.messageId, { kind: 'show-verbose' });
        return;
      case 'set-queue-mode':
        updateChatRunPreferences(q.chatJid, (prefs) => {
          if (settingsAction.value === 'collect') delete prefs.queueMode;
          else prefs.queueMode = settingsAction.value;
          return prefs;
        });
        await editTelegramSettingsPanel(q.chatJid, q.messageId, { kind: 'show-queue' });
        return;
      case 'stop-subagents':
        if (!isMainChat(q.chatJid)) {
          await sendMessage(
            q.chatJid,
            `${ASSISTANT_NAME}: subagent controls are only available in the main/admin chat.`,
          );
          return;
        }
        if (settingsAction.target === 'all') {
          for (const run of activeChatRuns.values()) {
            run.abortController.abort(new Error('Stopped via Telegram panel (all)'));
          }
        } else {
          const run = activeChatRuns.get(q.chatJid);
          if (run) {
            run.abortController.abort(new Error('Stopped via Telegram panel (current)'));
          }
        }
        await editTelegramSettingsPanel(q.chatJid, q.messageId, { kind: 'show-subagents' });
        return;
      case 'trigger-new':
        updateChatRunPreferences(q.chatJid, (prefs) => {
          prefs.nextRunNoContinue = true;
          return prefs;
        });
        await editTelegramSettingsPanel(q.chatJid, q.messageId, { kind: 'show-home' });
        return;
      case 'set-setup-provider': {
        persistRuntimeConfigUpdates(
          buildRuntimeProviderPresetUpdates({
            preset: settingsAction.preset,
            source: getRuntimeConfigEnv(),
            applyLocalDefaults: true,
          }),
        );
        clearTelegramSetupInputState(q.chatJid);
        await editTelegramSettingsPanel(q.chatJid, q.messageId, {
          kind: 'show-setup-models',
          preset: settingsAction.preset,
          page: 0,
        });
        return;
      }
      case 'set-setup-model':
        persistRuntimeConfigUpdates(
          buildRuntimeProviderPresetUpdates({
            preset: settingsAction.preset,
            model: settingsAction.model,
            source: getRuntimeConfigEnv(),
          }),
        );
        clearTelegramSetupInputState(q.chatJid);
        await editTelegramSettingsPanel(q.chatJid, q.messageId, {
          kind: 'show-setup-home',
        });
        return;
      case 'prompt-setup-provider':
        await editTelegramSettingsPanel(q.chatJid, q.messageId, { kind: 'show-setup-home' });
        await promptTelegramSetupInput(
          q.chatJid,
          'provider',
          'Send the raw provider id to save into PI_API. Example: minimax, kimi-coding, openai, ollama, or another pi-supported provider.',
        );
        return;
      case 'prompt-setup-model': {
        const snapshot = resolveRuntimeConfigSnapshot(getRuntimeConfigEnv());
        if (snapshot.providerPreset !== 'manual') {
          await editTelegramSettingsPanel(q.chatJid, q.messageId, {
            kind: 'show-setup-models',
            preset: snapshot.providerPreset,
            page: 0,
          });
          return;
        }
        await editTelegramSettingsPanel(q.chatJid, q.messageId, { kind: 'show-setup-home' });
        await promptTelegramSetupInput(
          q.chatJid,
          'model',
          'Send the raw model id to save into PI_MODEL.',
        );
        return;
      }
      case 'prompt-setup-model-typed':
        await editTelegramSettingsPanel(q.chatJid, q.messageId, { kind: 'show-setup-home' });
        await promptTelegramSetupInput(
          q.chatJid,
          'model',
          'Send the raw model id to save into PI_MODEL.',
        );
        return;
      case 'prompt-setup-endpoint':
        await editTelegramSettingsPanel(q.chatJid, q.messageId, { kind: 'show-setup-endpoint' });
        await promptTelegramSetupInput(
          q.chatJid,
          'endpoint',
          'Send the openai-compatible base URL to save. Example: http://localhost:11434/v1 (Ollama) or http://127.0.0.1:1234/v1 (LM Studio)',
        );
        return;
      case 'clear-setup-endpoint':
        persistRuntimeConfigUpdates({
          PI_BASE_URL: undefined,
          OPENAI_BASE_URL: undefined,
        });
        clearTelegramSetupInputState(q.chatJid);
        await editTelegramSettingsPanel(q.chatJid, q.messageId, { kind: 'show-setup-endpoint' });
        return;
      case 'prompt-setup-api-key':
        await editTelegramSettingsPanel(q.chatJid, q.messageId, { kind: 'show-setup-api-key' });
        await promptTelegramSetupInput(
          q.chatJid,
          'api-key',
          `Send the API key for ${resolveRuntimeConfigSnapshot(getRuntimeConfigEnv()).apiKeyEnv}.`,
        );
        return;
      case 'clear-setup-api-key': {
        const snapshot = resolveRuntimeConfigSnapshot(getRuntimeConfigEnv());
        persistRuntimeConfigUpdates({ [snapshot.apiKeyEnv]: undefined });
        clearTelegramSetupInputState(q.chatJid);
        await editTelegramSettingsPanel(q.chatJid, q.messageId, { kind: 'show-setup-api-key' });
        return;
      }
      case 'restart-gateway': {
        await sendMessage(
          q.chatJid,
          'Restarting gateway service. Expect a brief disconnect while the host restarts.',
        );
        const result = runGatewayServiceCommand('restart');
        if (!result.ok) {
          await sendMessage(q.chatJid, `Gateway restart failed:\n${result.text}`);
        }
        return;
      }
    }
  }

  if (q.data.startsWith(TELEGRAM_SETTINGS_PANEL_PREFIX)) {
    await sendMessage(
      q.chatJid,
      'That panel expired. Run /model, /think, /reasoning, /verbose, /queue, or /subagents again.',
    );
    return;
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

async function handleTelegramSetupInput(
  m: {
    chatJid: string;
    content: string;
  },
): Promise<boolean> {
  const pending = getTelegramSetupInputState(m.chatJid);
  if (!pending) return false;

  const content = m.content.trim();
  if (!content || content.startsWith('/')) return false;

  switch (pending.kind) {
    case 'provider':
      persistRuntimeConfigUpdates({
        [RUNTIME_PROVIDER_PRESET_ENV]: undefined,
        PI_API: content,
      });
      clearTelegramSetupInputState(m.chatJid);
      await sendTelegramSettingsPanel(m.chatJid, { kind: 'show-setup-home' });
      await sendMessage(
        m.chatJid,
        `Saved provider: ${content}\nUse /setup -> Model next if you need to change PI_MODEL.`,
      );
      return true;
    case 'model':
      persistRuntimeConfigUpdates({ PI_MODEL: content });
      clearTelegramSetupInputState(m.chatJid);
      await sendTelegramSettingsPanel(m.chatJid, { kind: 'show-setup-home' });
      await sendMessage(m.chatJid, `Saved model: ${content}`);
      return true;
    case 'endpoint':
      persistRuntimeConfigUpdates({
        PI_BASE_URL: content,
        OPENAI_BASE_URL: content,
      });
      clearTelegramSetupInputState(m.chatJid);
      await sendTelegramSettingsPanel(m.chatJid, { kind: 'show-setup-home' });
      await sendMessage(m.chatJid, `Saved openai-compatible endpoint: ${content}`);
      return true;
    case 'api-key': {
      const snapshot = resolveRuntimeConfigSnapshot(getRuntimeConfigEnv());
      persistRuntimeConfigUpdates({ [snapshot.apiKeyEnv]: content });
      clearTelegramSetupInputState(m.chatJid);
      await sendTelegramSettingsPanel(m.chatJid, { kind: 'show-setup-home' });
      await sendMessage(m.chatJid, `Saved API key in ${snapshot.apiKeyEnv}.`);
      return true;
    }
    default:
      return false;
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
    if (!searchText && state.telegramBot) {
      await state.telegramBot.sendMessageWithKeyboard(m.chatJid, listed.text, [[
        {
          text: 'Open Model Picker',
          callbackData: registerTelegramSettingsPanelAction(m.chatJid, {
            kind: 'show-model-providers',
          }),
        },
      ]]);
    } else {
      await sendMessage(m.chatJid, listed.text);
    }
    return true;
  }

  if (cmd === '/model') {
    const argText = rest.join(' ').trim();
    if (!argText) {
      logTelegramCommandAudit(m.chatJid, cmd, true, 'show');
      if (state.telegramBot) {
        await sendTelegramSettingsPanel(m.chatJid, { kind: 'show-model-providers' });
      } else {
        const prefs = state.chatRunPreferences[m.chatJid] || {};
        const override = prefs.provider || prefs.model;
        await sendMessage(
          m.chatJid,
          override
            ? `Current model override: ${getEffectiveModelLabel(m.chatJid)}`
            : `Current model: ${getEffectiveModelLabel(m.chatJid)}\n(no override set; using env defaults)`,
        );
      }
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
      const current = state.chatRunPreferences[m.chatJid]?.thinkLevel || 'off';
      logTelegramCommandAudit(m.chatJid, cmd, true, 'show');
      if (state.telegramBot) {
        await sendTelegramSettingsPanel(m.chatJid, { kind: 'show-think' });
      } else {
        await sendMessage(m.chatJid, `Current thinking level: ${current}`);
      }
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
      const current = state.chatRunPreferences[m.chatJid]?.reasoningLevel || 'off';
      logTelegramCommandAudit(m.chatJid, cmd, true, 'show');
      if (state.telegramBot) {
        await sendTelegramSettingsPanel(m.chatJid, { kind: 'show-reasoning' });
      } else {
        await sendMessage(m.chatJid, `Current reasoning level: ${current}`);
      }
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

  if (cmd === '/verbose' || cmd === '/v') {
    const parsed = parseVerboseDirective(m.content);
    if (parsed.kind === 'invalid' || parsed.kind === 'none') {
      logTelegramCommandAudit(m.chatJid, cmd, false, 'invalid verbose mode');
      await sendMessage(
        m.chatJid,
        'Unrecognized tool progress mode. Valid: off, new, all, verbose. `/verbose` cycles modes.',
      );
      return true;
    }

    if (parsed.kind === 'cycle') {
      logTelegramCommandAudit(m.chatJid, cmd, true, 'show');
      if (state.telegramBot) {
        await sendTelegramSettingsPanel(m.chatJid, { kind: 'show-verbose' });
      } else {
        await sendMessage(
          m.chatJid,
          `Current tool progress mode: ${getEffectiveVerboseMode(
            state.chatRunPreferences[m.chatJid]?.verboseMode,
          )}`,
        );
      }
      return true;
    }

    const normalized = parsed.mode;
    updateChatRunPreferences(m.chatJid, (prefs) => {
      if (normalized === 'off') delete prefs.verboseMode;
      else prefs.verboseMode = normalized;
      return prefs;
    });
    logTelegramCommandAudit(m.chatJid, cmd, true, 'set');
    await sendMessage(m.chatJid, describeVerboseMode(normalized));
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
      delete state.chatUsageStats[m.chatJid];
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
      const prefs = state.chatRunPreferences[m.chatJid] || {};
      const mode = prefs.queueMode || 'collect';
      const debounce = prefs.queueDebounceMs || 0;
      const cap = prefs.queueCap || 0;
      const drop = prefs.queueDrop || 'old';
      logTelegramCommandAudit(m.chatJid, cmd, true, 'show');
      if (state.telegramBot) {
        await sendTelegramSettingsPanel(m.chatJid, { kind: 'show-queue' });
      } else {
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
      }
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
    const prefs = state.chatRunPreferences[m.chatJid] || {};
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
    const onboardingGate = resolveMainOnboardingGate(m.chatJid);
    if (onboardingGate.active) {
      logTelegramCommandAudit(m.chatJid, cmd, false, 'blocked by onboarding gate');
      await sendMessage(m.chatJid, onboardingCommandBlockedText());
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
    const isDirectTelegramDm = !chatId.startsWith('-');

    // If main is already configured, don't let random chats steal it.
    const existingMain = hasMainGroup();
    const alreadyMain =
      state.registeredGroups[m.chatJid]?.folder === MAIN_GROUP_FOLDER;
    if (existingMain && !alreadyMain) {
      logTelegramCommandAudit(m.chatJid, cmd, false, 'main already configured');
      await sendMessage(
        m.chatJid,
        'Main chat is already set. If you want to change it, edit data/registered_groups.json (or delete it to re-bootstrap).',
      );
      return true;
    }

    if (!existingMain && isDirectTelegramDm && !TELEGRAM_ADMIN_SECRET) {
      promoteChatToMain(m.chatJid, m.chatName || `${ASSISTANT_NAME} (main)`);
      await refreshTelegramCommandMenus();
      logTelegramCommandAudit(m.chatJid, cmd, true, 'first-claim without secret');
      await sendMessage(
        m.chatJid,
        [
          'This chat is now the main/admin channel.',
          'Note: TELEGRAM_ADMIN_SECRET is not set yet; set it in .env and restart to lock future re-claim actions.',
        ].join('\n'),
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

  if (cmd === '/restart') {
    logTelegramCommandAudit(m.chatJid, cmd, true, 'restart requested');
    await sendMessage(
      m.chatJid,
      'Restarting gateway service. Expect a brief disconnect while the host restarts.',
    );
    const result = runGatewayServiceCommand('restart');
    if (!result.ok) {
      await sendMessage(m.chatJid, `Gateway restart failed:\n${result.text}`);
    }
    return true;
  }

  if (cmd === '/gateway') {
    const actionRaw = (rest[0] || 'status').trim().toLowerCase();
    const action =
      actionRaw === 'restart'
        ? 'restart'
        : actionRaw === 'status'
          ? 'status'
          : actionRaw === 'doctor'
            ? 'doctor'
          : null;
    if (!action) {
      logTelegramCommandAudit(m.chatJid, cmd, false, 'invalid action');
      await sendMessage(m.chatJid, 'Usage: /gateway <status|restart|doctor>');
      return true;
    }

    if (action === 'restart') {
      logTelegramCommandAudit(m.chatJid, cmd, true, 'restart requested');
      await sendMessage(
        m.chatJid,
        'Restarting gateway service. Expect a brief disconnect while the host restarts.',
      );
      const result = runGatewayServiceCommand(action);
      if (!result.ok) {
        await sendMessage(m.chatJid, `Gateway restart failed:\n${result.text}`);
      }
      return true;
    }

    const result = runGatewayServiceCommand(action);
    logTelegramCommandAudit(
      m.chatJid,
      cmd,
      result.ok,
      result.ok ? action : `${action} failed`,
    );
    await sendMessage(
      m.chatJid,
      result.ok ? `Gateway ${action}:\n${result.text}` : `Gateway ${action} failed:\n${result.text}`,
    );
    return true;
  }

  if (cmd === '/setup') {
    const arg = rest.join(' ').trim().toLowerCase();
    if (arg === 'cancel') {
      clearTelegramSetupInputState(m.chatJid);
      logTelegramCommandAudit(m.chatJid, cmd, true, 'cancel');
      await sendMessage(m.chatJid, 'Setup prompt cancelled.');
      return true;
    }

    logTelegramCommandAudit(m.chatJid, cmd, true, 'panel');
    await sendTelegramSettingsPanel(m.chatJid, { kind: 'show-setup-home' });
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
      const entries = Object.entries(state.chatRunPreferences)
        .filter(([, prefs]) => prefs.freeChat === true)
        .map(([jid]) => {
          const group = state.registeredGroups[jid];
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

    const targetGroup = state.registeredGroups[targetJid];
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
    const sub = (rest[0] || '').toLowerCase();
    if (!sub || sub === 'list') {
      await sendMessage(m.chatJid, formatTasksText('list'));
      return true;
    }
    if (sub === 'due') {
      await sendMessage(m.chatJid, formatTasksText('due'));
      return true;
    }
    if (sub === 'detail') {
      const taskId = rest[1];
      if (!taskId) {
        await sendMessage(m.chatJid, 'Usage: /tasks detail <taskId>');
        return true;
      }
      await sendMessage(m.chatJid, summarizeTask(taskId));
      return true;
    }
    if (sub === 'runs') {
      const taskId = rest[1];
      if (!taskId) {
        await sendMessage(m.chatJid, 'Usage: /tasks runs <taskId> [limit]');
        return true;
      }
      const limitRaw = Number.parseInt(rest[2] || '10', 10);
      const limit = Number.isFinite(limitRaw) ? limitRaw : 10;
      await sendMessage(m.chatJid, formatTaskRunsText(taskId, limit));
      return true;
    }
    await sendMessage(
      m.chatJid,
      'Usage: /tasks [list|due|detail <taskId>|runs <taskId> [limit]]',
    );
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
    if (WHATSAPP_ENABLED && state.sock) {
      await syncGroupMetadata(true);
    }
    await refreshTelegramCommandMenus();
    await sendMessage(m.chatJid, 'Command menus and metadata refreshed.');
    return true;
  }

  if (cmd === '/panel') {
    logTelegramCommandAudit(m.chatJid, cmd, true, 'ok');
    if (!state.telegramBot) return true;
    await state.telegramBot.sendMessageWithKeyboard(
      m.chatJid,
      'Admin panel:',
      buildAdminPanelKeyboard(),
    );
    return true;
  }

  if (cmd === '/subagents') {
    const action = (rest[0] || 'list').toLowerCase();
    if (!rest[0] && state.telegramBot) {
      logTelegramCommandAudit(m.chatJid, cmd, true, 'panel');
      await sendTelegramSettingsPanel(m.chatJid, { kind: 'show-subagents' });
      return true;
    }
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

      const group = state.registeredGroups[m.chatJid];
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
      activeChatRunsById.set(requestId, activeRun);
      emitTuiChatEvent({
        runId: requestId,
        sessionKey: getSessionKeyForChat(m.chatJid),
        state: 'message',
        message: { role: 'system', content: `Starting subagent run (${requestId})...` },
      });
      emitTuiAgentEvent({
        runId: requestId,
        sessionKey: getSessionKeyForChat(m.chatJid),
        phase: 'start',
        detail: 'running',
      });
      await sendMessage(m.chatJid, `Starting subagent run (${requestId})...`);
      await setTyping(m.chatJid, true);
      try {
        const run = await runAgent(
          group,
          `[SUBAGENT EXECUTE REQUEST]\n${task}`,
          m.chatJid,
          'force_delegate_execute',
          requestId,
          state.chatRunPreferences[m.chatJid] || {},
          {},
          abortController.signal,
        );
        updateChatUsage(m.chatJid, run.usage);
        if (!run.ok) {
          emitTuiChatEvent({
            runId: requestId,
            sessionKey: getSessionKeyForChat(m.chatJid),
            state: 'error',
            errorMessage: 'Subagent run failed',
          });
          emitTuiAgentEvent({
            runId: requestId,
            sessionKey: getSessionKeyForChat(m.chatJid),
            phase: 'error',
            detail: 'subagent run failed',
          });
        } else if (run.result) {
          persistAssistantHistory(m.chatJid, run.result, requestId);
          if (!run.streamed) {
            await sendAgentResultMessage(m.chatJid, run.result);
          }
          emitTuiChatEvent({
            runId: requestId,
            sessionKey: getSessionKeyForChat(m.chatJid),
            state: 'final',
            message: { role: 'assistant', content: run.result },
            usage: run.usage,
          });
          emitTuiAgentEvent({
            runId: requestId,
            sessionKey: getSessionKeyForChat(m.chatJid),
            phase: 'end',
            detail: run.streamed ? 'streamed' : 'complete',
          });
        } else {
          emitTuiAgentEvent({
            runId: requestId,
            sessionKey: getSessionKeyForChat(m.chatJid),
            phase: 'end',
            detail: run.streamed ? 'streamed' : 'complete',
          });
        }
      } finally {
        if (activeChatRuns.get(m.chatJid) === activeRun) {
          activeChatRuns.delete(m.chatJid);
        }
        activeChatRunsById.delete(requestId);
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
  if (state.telegramBot) return;

  state.telegramBot = createTelegramBot({
    token: TELEGRAM_BOT_TOKEN,
    apiBaseUrl: TELEGRAM_API_BASE_URL,
    assistantName: ASSISTANT_NAME,
    triggerPattern: TRIGGER_PATTERN,
  });

  state.telegramBot.startPolling(async (event) => {
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

    if (await handleTelegramSetupInput(m)) return;

    // Handle lightweight admin commands without invoking the agent.
    if (await handleTelegramCommand(m)) return;

    if (state.registeredGroups[m.chatJid]) {
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
  void refreshTelegramCommandMenus();
}

async function processMessage(msg: NewMessage): Promise<boolean> {
  const group = state.registeredGroups[msg.chat_jid];
  if (!group) return true;

  const content = msg.content.trim();
  const isMainGroup = group.folder === MAIN_GROUP_FOLDER;
  const queuePrefs = state.chatRunPreferences[msg.chat_jid] || {};
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
  const onboardingGate = resolveMainOnboardingGate(msg.chat_jid);

  if (onboardingGate.active && isCoderDelegationCommand(content)) {
    await sendMessage(msg.chat_jid, onboardingCommandBlockedText());
    return true;
  }

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
  let requestId = makeRunId('chat');
  let delegationInstruction: string | null = null;
  let delegationMarker: string | null = null;

  // In main, allow "/coder...", "/coder-plan...", or explicit alias phrases.
  // In non-main, trigger prefix is required (checked above) and delegation is blocked.
  const stripped = content.replace(TRIGGER_PATTERN, '').trimStart();
  const parsedTrigger = onboardingGate.active
    ? { hint: 'none' as CodingHint, instruction: null }
    : parseDelegationTrigger(stripped);
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
  const sinceTimestamp = state.lastAgentTimestamp[msg.chat_jid] || '';
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
  if (group.folder === MAIN_GROUP_FOLDER) {
    rememberHeartbeatTarget(msg.chat_jid);
  }
  const sessionKey = getSessionKeyForChat(msg.chat_jid);
  const latestUserText = selectedMessages[selectedMessages.length - 1]?.content || content;

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

  if (onboardingGate.active) {
    codingHint = 'none';
    requestId = makeRunId('onboarding');
    finalPrompt = buildOnboardingInterviewPrompt({
      prompt,
      latestUserText,
    });
  }

  logger.info(
    {
      group: group.name,
      messageCount: missedMessages.length,
      selectedMessageCount: selectedMessages.length,
      queueMode,
      queueCap: queueCap || 0,
      queueDrop,
      onboardingGate: onboardingGate.active,
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
    ...(state.chatRunPreferences[msg.chat_jid] || {}),
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
  activeChatRunsById.set(requestId, activeRun);
  emitTuiChatEvent({
    runId: requestId,
    sessionKey,
    state: 'message',
    message: { role: 'user', content: latestUserText },
  });
  emitTuiAgentEvent({
    runId: requestId,
    sessionKey,
    phase: 'start',
    detail: 'running',
  });
  await setTyping(msg.chat_jid, true);
  try {
    const run = await runAgent(
      group,
      finalPrompt,
      msg.chat_jid,
      codingHint,
      requestId,
      runPreferences,
      {},
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
    activeChatRunsById.delete(requestId);
    activeCoderRuns.delete(requestId);
  }

  if (ok && onboardingGate.active) {
    const completion = extractOnboardingCompletion(result);
    result = completion.text;
    if (completion.completed) {
      completeMainWorkspaceOnboarding({ workspaceDir: MAIN_WORKSPACE_DIR });
      if (!result) {
        result = 'Onboarding complete.';
      }
      logger.info(
        { chatJid: msg.chat_jid, requestId },
        'Completed main workspace onboarding from gated interview run',
      );
    }
  }

  // Only advance last-agent timestamp after a successful run; otherwise the
  // next loop should retry with the same context window.
  if (ok) {
    const externallyCompleted = isTelegramJid(msg.chat_jid)
      ? consumeTelegramHostCompletedRun(msg.chat_jid, requestId)
      : false;
    const telegramStreamState =
      isTelegramJid(msg.chat_jid)
        ? consumeTelegramHostStreamState(msg.chat_jid, requestId)
        : null;
    const telegramCompletionState = resolveTelegramStreamCompletionState({
      reportedStreamed: streamed,
      externallyCompleted,
      streamState: telegramStreamState,
    });
    streamed = telegramCompletionState.effectiveStreamed;
    const telegramPreviewState = telegramCompletionState.messagePreviewState;
    updateChatUsage(msg.chat_jid, usage);
    state.lastAgentTimestamp[msg.chat_jid] = msg.timestamp;
    if (abortController.signal.aborted) {
      if (telegramPreviewState) {
        await deleteTelegramPreviewMessage(
          msg.chat_jid,
          telegramPreviewState.messageId,
        );
      }
      emitTuiChatEvent({
        runId: requestId,
        sessionKey,
        state: 'aborted',
      });
      emitTuiAgentEvent({
        runId: requestId,
        sessionKey,
        phase: 'end',
        detail: 'aborted',
      });
    } else if (result) {
      persistAssistantHistory(msg.chat_jid, result, requestId);
      let finalizedPreview = false;
      if (!externallyCompleted && telegramPreviewState) {
        finalizedPreview = await finalizeTelegramPreviewMessage(
          msg.chat_jid,
          telegramPreviewState.messageId,
          result,
        );
      }
      if (
        !externallyCompleted &&
        (!streamed || (telegramPreviewState && !finalizedPreview))
      ) {
        await sendAgentResultMessage(msg.chat_jid, result, { prefixWhatsApp: true });
      }
      emitTuiChatEvent({
        runId: requestId,
        sessionKey,
        state: 'final',
        message: { role: 'assistant', content: result },
        usage,
      });
      emitTuiAgentEvent({
        runId: requestId,
        sessionKey,
        phase: 'end',
        detail: streamed ? 'streamed' : 'complete',
      });
    } else {
      if (telegramPreviewState) {
        await deleteTelegramPreviewMessage(
          msg.chat_jid,
          telegramPreviewState.messageId,
        );
      }
      emitTuiAgentEvent({
        runId: requestId,
        sessionKey,
        phase: 'end',
        detail: streamed ? 'streamed' : 'complete',
      });
    }
  } else {
    emitTuiChatEvent({
      runId: requestId,
      sessionKey,
      state: 'error',
      errorMessage: 'Run failed',
    });
    emitTuiAgentEvent({
      runId: requestId,
      sessionKey,
      phase: 'error',
      detail: 'run failed',
    });
  }
  return true;
}

async function runDirectSessionTurn(params: {
  chatJid: string;
  text: string;
  runId: string;
  deliver: boolean;
}): Promise<{ runId: string; status: 'started' | 'queued' | 'already_running' }> {
  const { chatJid, text, runId, deliver } = params;
  const group = state.registeredGroups[chatJid];
  if (!group) {
    throw new Error(`Chat is not registered: ${chatJid}`);
  }
  const existing = activeChatRuns.get(chatJid);
  if (existing) {
    // Queue in-memory so it's processed through the TUI path after the current run completes.
    // Storing via storeTextMessage with a non-TUI_SENDER_ID would leak into the Telegram
    // message loop, causing responses to be sent to Telegram instead of the TUI.
    const queue = tuiMessageQueue.get(chatJid) ?? [];
    queue.push({ text, runId, deliver });
    tuiMessageQueue.set(chatJid, queue);
    return { runId: existing.requestId, status: 'queued' };
  }
  const onboardingGate = resolveMainOnboardingGate(chatJid);

  const sessionKey = getSessionKeyForChat(chatJid);
  persistTuiUserHistory(chatJid, text, runId);
  emitTuiChatEvent({
    runId,
    sessionKey,
    state: 'message',
    message: { role: 'user', content: text },
  });
  emitTuiAgentEvent({
    runId,
    sessionKey,
    phase: 'start',
    detail: 'running',
  });

  const runPreferences: ChatRunPreferences = {
    ...(state.chatRunPreferences[chatJid] || {}),
  };
  if (consumeNextRunNoContinue(chatJid)) {
    runPreferences.nextRunNoContinue = true;
  }

  const directPrompt = `[${new Date().toISOString()}] ${TUI_SENDER_NAME}: ${text}`;
  const prompt = onboardingGate.active
    ? buildOnboardingInterviewPrompt({
        prompt: directPrompt,
        latestUserText: text,
      })
    : directPrompt;
  const abortController = new AbortController();
  const activeRun: ActiveChatRun = {
    chatJid,
    startedAt: Date.now(),
    requestId: runId,
    abortController,
  };
  activeChatRuns.set(chatJid, activeRun);
  activeChatRunsById.set(runId, activeRun);

  // Detach agent execution so RPC response is sent before any events arrive at the client.
  // This prevents the client from receiving run-complete events before it knows the runId,
  // which caused the spinner to get stuck in 'running' forever.
  void (async () => {
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

    await setTyping(chatJid, true);
    try {
      const run = await runAgent(
        group,
        prompt,
        chatJid,
        'none',
        runId,
        runPreferences,
        {},
        abortController.signal,
      );
      result = run.result;
      streamed = run.streamed;
      ok = run.ok;
      usage = run.usage;
    } finally {
      await setTyping(chatJid, false);
      if (activeChatRuns.get(chatJid) === activeRun) {
        activeChatRuns.delete(chatJid);
      }
      activeChatRunsById.delete(runId);

      // Dequeue the next TUI message (if any) through the TUI path.
      // Must happen after activeChatRuns is cleared so the next run registers cleanly.
      const tuiQueue = tuiMessageQueue.get(chatJid);
      const nextTuiMessage = tuiQueue?.shift();
      if (nextTuiMessage) {
        if (tuiQueue?.length === 0) tuiMessageQueue.delete(chatJid);
        void runDirectSessionTurn({
          chatJid,
          text: nextTuiMessage.text,
          runId: nextTuiMessage.runId,
          deliver: nextTuiMessage.deliver,
        });
      }
    }

    if (!ok) {
      emitTuiChatEvent({
        runId,
        sessionKey,
        state: 'error',
        errorMessage: 'Run failed',
      });
      emitTuiAgentEvent({
        runId,
        sessionKey,
        phase: 'error',
        detail: 'run failed',
      });
      // Error is communicated via events; RPC response already sent successfully.
      return;
    }

    if (onboardingGate.active) {
      const completion = extractOnboardingCompletion(result);
      result = completion.text;
      if (completion.completed) {
        completeMainWorkspaceOnboarding({ workspaceDir: MAIN_WORKSPACE_DIR });
        if (!result) {
          result = 'Onboarding complete.';
        }
        logger.info(
          { chatJid, runId },
          'Completed main workspace onboarding from direct session run',
        );
      }
    }

    updateChatUsage(chatJid, usage);
    const externallyCompleted = isTelegramJid(chatJid)
      ? consumeTelegramHostCompletedRun(chatJid, runId)
      : false;
    const telegramStreamState = isTelegramJid(chatJid)
      ? consumeTelegramHostStreamState(chatJid, runId)
      : null;
    const telegramCompletionState = resolveTelegramStreamCompletionState({
      reportedStreamed: streamed,
      externallyCompleted,
      streamState: telegramStreamState,
    });
    streamed = telegramCompletionState.effectiveStreamed;
    const telegramPreviewState = telegramCompletionState.messagePreviewState;

    if (abortController.signal.aborted) {
      if (telegramPreviewState) {
        await deleteTelegramPreviewMessage(chatJid, telegramPreviewState.messageId);
      }
      emitTuiChatEvent({
        runId,
        sessionKey,
        state: 'aborted',
      });
      emitTuiAgentEvent({
        runId,
        sessionKey,
        phase: 'end',
        detail: 'aborted',
      });
      return;
    }

    if (result) {
      persistAssistantHistory(chatJid, result, runId);
      let finalizedPreview = false;
      if (!externallyCompleted && telegramPreviewState) {
        finalizedPreview = await finalizeTelegramPreviewMessage(
          chatJid,
          telegramPreviewState.messageId,
          result,
        );
      }
      if (
        deliver &&
        !externallyCompleted &&
        (!streamed || (telegramPreviewState && !finalizedPreview))
      ) {
        await sendAgentResultMessage(chatJid, result, { prefixWhatsApp: true });
      }
    } else if (telegramPreviewState) {
      await deleteTelegramPreviewMessage(chatJid, telegramPreviewState.messageId);
    }

    emitTuiChatEvent({
      runId,
      sessionKey,
      state: 'final',
      ...(result ? { message: { role: 'assistant' as const, content: result } } : {}),
      usage,
    });
    emitTuiAgentEvent({
      runId,
      sessionKey,
      phase: 'end',
      detail: streamed ? 'streamed' : 'complete',
    });
  })();

  return { runId, status: 'started' };
}

async function runAgent(
  group: RegisteredGroup,
  prompt: string,
  chatJid: string,
  codingHint: CodingHint = 'none',
  requestId?: string,
  runtimePrefs: ChatRunPreferences = {},
  options: { suppressErrorReply?: boolean } = {},
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
      context_mode: t.context_mode,
      session_target: t.session_target,
      wake_mode: t.wake_mode,
      delivery_mode: t.delivery_mode,
      timeout_seconds: t.timeout_seconds,
    })),
  );

  // Update available groups snapshot (main group only can see all groups)
  const availableGroups = getAvailableGroups();
  writeGroupsSnapshot(
    group.folder,
    isMain,
    availableGroups,
    new Set(Object.keys(state.registeredGroups)),
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
            verbose_mode: runtimePrefs.verboseMode || null,
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
      assistantName: ASSISTANT_NAME,
      codingHint,
      requestId,
      extraSystemPrompt,
      provider: runtimePrefs.provider,
      model: runtimePrefs.model,
      thinkLevel: runtimePrefs.thinkLevel,
      reasoningLevel: runtimePrefs.reasoningLevel,
      verboseMode: runtimePrefs.verboseMode,
      noContinue: runtimePrefs.nextRunNoContinue === true,
    };

    const sessionKey = getSessionKeyForChat(chatJid);
    const executeRun = async (
      runPrefs: ChatRunPreferences,
    ): Promise<{
      status: 'success' | 'error';
      result: string | null;
      error?: string;
      streamed?: boolean;
      usage?: {
        inputTokens?: number;
        outputTokens?: number;
        totalTokens?: number;
        provider?: string;
        model?: string;
      };
    }> => runContainerAgent(
      group,
      {
        ...input,
        verboseMode: runPrefs.verboseMode,
        noContinue: runPrefs.nextRunNoContinue === true,
      },
      abortSignal,
      (event) => {
        if (event.kind !== 'tool' || !requestId) return;
        if (isTelegramJid(chatJid)) {
          queueTelegramToolProgressUpdate(chatJid, requestId, runPrefs.verboseMode, {
            toolName: event.toolName,
            status: event.status,
            ...(event.args ? { args: event.args } : {}),
            ...(event.output ? { output: event.output } : {}),
            ...(event.error ? { error: event.error } : {}),
          });
        }
        emitTuiToolEvent({
          runId: requestId,
          sessionKey,
          index: event.index,
          toolName: event.toolName,
          status: event.status,
          ...(event.args ? { args: event.args } : {}),
          ...(event.output ? { output: event.output } : {}),
          ...(event.error ? { error: event.error } : {}),
        });
      },
    );

    let output = await executeRun(runtimePrefs);

    if (output.status === 'error') {
      if (typeof output.error === 'string' && /aborted by user/i.test(output.error)) {
        return { result: null, streamed: false, ok: true };
      }
      if (options.suppressErrorReply) {
        logger.warn(
          { group: group.name, error: output.error },
          'Container agent error (suppressed user reply)',
        );
        return { result: null, streamed: false, ok: false };
      }
      logger.error(
        { group: group.name, error: output.error },
        'Container agent error',
      );
      // Reply with a short error rather than silently dropping the message.
      // Also mark ok=true so we don't keep re-sending the same failing prompt.
      const msg = output.error
        ? `LLM error: ${output.error}`
        : 'LLM error: agent runner failed (no details).';
      return { result: msg, streamed: false, ok: true };
    }

    const isHeartbeatRun = requestId?.startsWith('heartbeat-') === true;
    const emptyOutputPolicy = await applyNonHeartbeatEmptyOutputPolicy({
      isHeartbeatRun,
      firstRun: {
        result: output.result,
        streamed: !!output.streamed,
        ok: true,
        usage: output.usage,
      },
      retryRun: async () => {
        const retryOutput = await executeRun({
          ...runtimePrefs,
          nextRunNoContinue: true,
        });
        if (retryOutput.status === 'error') {
          if (
            typeof retryOutput.error === 'string' &&
            /aborted by user/i.test(retryOutput.error)
          ) {
            return { result: null, streamed: false, ok: true };
          }
          logger.error(
            { group: group.name, error: retryOutput.error },
            'Container agent retry error after empty output',
          );
          return {
            result: retryOutput.error
              ? `LLM error: ${retryOutput.error}`
              : 'LLM error: agent runner failed (no details).',
            streamed: false,
            ok: true,
          };
        }
        return {
          result: retryOutput.result,
          streamed: !!retryOutput.streamed,
          ok: true,
          usage: retryOutput.usage,
        };
      },
    });

    return {
      result: emptyOutputPolicy.finalRun.result,
      streamed: emptyOutputPolicy.finalRun.streamed,
      ok: emptyOutputPolicy.finalRun.ok,
      usage: emptyOutputPolicy.finalRun.usage,
    };
  } catch (err) {
    logger.error({ group: group.name, err }, 'Agent error');
    return { result: null, streamed: false, ok: false };
  } finally {
    if (requestId && isTelegramJid(chatJid)) {
      await finalizeTelegramToolProgress(chatJid, requestId);
    }
  }
}

function createTuiGatewayAdapters(): TuiGatewayAdapters {
  return {
    getStatus: () => ({
      runtime: getContainerRuntime(),
      sessions: buildTuiSessionList().length,
      activeRuns: activeChatRunsById.size,
    }),
    listSessions: () => buildTuiSessionList(),
    resolveChatJid: (sessionKey: string) => resolveChatJidForSessionKey(sessionKey),
    getSessionKeyForChat: (chatJid: string) => getSessionKeyForChat(chatJid),
    getSessionPrefs: (chatJid: string) => getTuiSessionPrefs(chatJid),
    patchSessionPrefs: (chatJid: string, patch: TuiSessionPrefs) =>
      patchTuiSessionPrefs(chatJid, patch),
    resetSession: (chatJid: string, reason: string) => resetTuiSession(chatJid, reason),
    getHistory: async (chatJid: string, limit: number) =>
      getTuiSessionHistory(chatJid, limit),
    sendChat: async ({ chatJid, message, runId, deliver }) =>
      runDirectSessionTurn({
        chatJid,
        text: message,
        runId,
        deliver,
      }),
    abortChat: async ({ chatJid, runId }) => {
      const active = activeChatRunsById.get(runId);
      if (!active || active.chatJid !== chatJid) {
        return { aborted: false };
      }
      active.abortController.abort(new Error('Aborted via TUI gateway'));
      return { aborted: true };
    },
    serviceGateway: async ({ action }) => runGatewayServiceCommand(action),
  };
}

function createWebControlCenterAdapters(): WebControlCenterAdapters {
  return {
    getRuntimeStatus: () => ({
      runtime: getContainerRuntime(),
      sessions: buildTuiSessionList().length,
      activeRuns: activeChatRunsById.size,
    }),
    getProfileStatus: () => ({
      profile: FFT_PROFILE,
      featureFarm: FEATURE_FARM,
      profileDetection: PROFILE_DETECTION,
    }),
    getBuildInfo: () => ({
      startedAt: SERVICE_STARTED_AT,
      version: APP_VERSION,
      ...GIT_INFO,
    }),
    getGatewayStatus: () => ({
      host: FFT_NANO_TUI_HOST,
      port: FFT_NANO_TUI_PORT,
      authRequired: FFT_NANO_TUI_AUTH_TOKEN.length > 0,
    }),
  };
}

async function startTuiGatewayService(): Promise<void> {
  if (state.tuiGatewayServer) return;
  if (!FFT_NANO_TUI_ENABLED) {
    logger.info('TUI gateway disabled via FFT_NANO_TUI_ENABLED');
    return;
  }
  try {
    state.tuiGatewayServer = await startTuiGatewayServer(
      createTuiGatewayAdapters(),
      tuiRuntimeEvents,
      {
        host: FFT_NANO_TUI_HOST,
        port: FFT_NANO_TUI_PORT,
        authToken: FFT_NANO_TUI_AUTH_TOKEN || undefined,
      },
    );
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    logger.error({ err: error }, 'TUI gateway failed to start; continuing without TUI surface');
  }
}

async function stopTuiGatewayService(): Promise<void> {
  if (!state.tuiGatewayServer) return;
  const server = state.tuiGatewayServer;
  state.tuiGatewayServer = null;
  try {
    await server.close();
    logger.info('TUI gateway server stopped');
  } catch (err) {
    logger.warn({ err }, 'Failed to stop TUI gateway server cleanly');
  }
}

async function startWebControlCenterService(): Promise<void> {
  if (state.webControlCenterServer) return;
  if (!FFT_NANO_WEB_ENABLED) {
    logger.info('FFT Control Center disabled via FFT_NANO_WEB_ENABLED');
    return;
  }
  if (!fs.existsSync(FFT_NANO_WEB_STATIC_DIR)) {
    logger.warn(
      { staticDir: FFT_NANO_WEB_STATIC_DIR },
      'FFT Control Center build is missing; run npm run web:build',
    );
    return;
  }

  try {
    state.webControlCenterServer = await startWebControlCenterServer(
      createWebControlCenterAdapters(),
      {
        host: FFT_NANO_WEB_HOST,
        port: FFT_NANO_WEB_PORT,
        accessMode: FFT_NANO_WEB_ACCESS_MODE,
        authToken: FFT_NANO_WEB_AUTH_TOKEN,
        staticDir: FFT_NANO_WEB_STATIC_DIR,
        logsDir: path.resolve(process.cwd(), 'logs'),
        fileRoots: [
          {
            id: 'workspace',
            label: 'Main Workspace',
            path: MAIN_WORKSPACE_DIR,
          },
          {
            id: 'skills-project',
            label: 'Project Skills',
            path: path.resolve(process.cwd(), 'skills'),
          },
          {
            id: 'skills-user',
            label: 'User Skills',
            path: path.join(MAIN_WORKSPACE_DIR, 'skills'),
          },
        ],
      },
    );
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    logger.error(
      { err: error },
      'FFT Control Center failed to start; continuing without web surface',
    );
  }
}

async function stopWebControlCenterService(): Promise<void> {
  if (!state.webControlCenterServer) return;
  const server = state.webControlCenterServer;
  state.webControlCenterServer = null;
  try {
    await server.close();
    logger.info('FFT Control Center server stopped');
  } catch (err) {
    logger.warn({ err }, 'Failed to stop FFT Control Center server cleanly');
  }
}

function truncateTelegramCaption(value?: string | null): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > TELEGRAM_CAPTION_MAX_CHARS
    ? trimmed.slice(0, TELEGRAM_CAPTION_MAX_CHARS)
    : trimmed;
}

function extractAttachmentAttribute(rawAttrs: string, key: string): string | null {
  const pattern = new RegExp(
    `\\b${key}=(?:\"([^\"]+)\"|'([^']+)'|([^\\s\\]]+))`,
    'i',
  );
  const match = rawAttrs.match(pattern);
  if (!match) return null;
  const value = match[1] || match[2] || match[3] || '';
  const trimmed = value.trim().replace(/^`+|`+$/g, '');
  return trimmed || null;
}

function normalizeTelegramReplyText(text: string): string {
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

function parseMarkdownLocalPath(rawTarget: string): string | null {
  const trimmed = rawTarget.trim();
  if (!trimmed) return null;
  let token = trimmed.match(/^\S+/)?.[0] || trimmed;
  token = token.replace(/^<|>$/g, '').replace(/^`+|`+$/g, '');
  if (!token) return null;
  if (!token.startsWith('/workspace/')) return null;
  return token;
}

function extractTelegramAttachmentHints(
  text: string,
): { cleanedText: string; hints: TelegramAttachmentHint[] } {
  const hints: TelegramAttachmentHint[] = [];
  let cleaned = text;

  cleaned = cleaned.replace(TELEGRAM_ATTACHMENT_HINT_RE, (_full, attrs: string) => {
    const rawPath = extractAttachmentAttribute(attrs, 'path');
    if (rawPath) {
      hints.push({
        rawPath,
        caption: truncateTelegramCaption(extractAttachmentAttribute(attrs, 'caption')),
      });
    }
    return '';
  });

  cleaned = cleaned.replace(
    TELEGRAM_MARKDOWN_IMAGE_RE,
    (full: string, alt: string, target: string) => {
      const localPath = parseMarkdownLocalPath(target);
      if (!localPath) return full;
      hints.push({
        rawPath: localPath,
        caption: truncateTelegramCaption(alt),
      });
      return '';
    },
  );

  cleaned = cleaned.replace(TELEGRAM_MARKDOWN_LINK_RE, (full: string, target: string) => {
    const localPath = parseMarkdownLocalPath(target);
    if (!localPath) return full;
    hints.push({ rawPath: localPath });
    return '';
  });

  const deduped = new Map<string, TelegramAttachmentHint>();
  for (const hint of hints) {
    const existing = deduped.get(hint.rawPath);
    if (!existing) {
      deduped.set(hint.rawPath, hint);
      continue;
    }
    if (!existing.caption && hint.caption) {
      deduped.set(hint.rawPath, { ...existing, caption: hint.caption });
    }
  }

  return {
    cleanedText: normalizeTelegramReplyText(cleaned),
    hints: Array.from(deduped.values()),
  };
}

function isPathWithinBase(baseDir: string, targetPath: string): boolean {
  const relative = path.relative(baseDir, targetPath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function resolveTelegramAttachmentHostPath(chatJid: string, rawPath: string): string | null {
  const group = state.registeredGroups[chatJid];
  if (!group) return null;

  const groupRoot =
    group.folder === MAIN_GROUP_FOLDER
      ? path.resolve(MAIN_WORKSPACE_DIR)
      : resolveGroupFolderPath(group.folder);
  const projectRoot = path.resolve(process.cwd());
  const globalRoot = path.resolve(path.join(GROUPS_DIR, 'global'));

  const allowedRoots: string[] = [groupRoot];
  if (group.folder === MAIN_GROUP_FOLDER) {
    allowedRoots.push(projectRoot);
  }
  if (fs.existsSync(globalRoot)) {
    allowedRoots.push(globalRoot);
  }

  const trimmed = rawPath.trim();
  if (!trimmed) return null;

  let resolved: string;
  if (trimmed === '/workspace/group') {
    resolved = groupRoot;
  } else if (trimmed.startsWith('/workspace/group/')) {
    resolved = path.resolve(groupRoot, trimmed.slice('/workspace/group/'.length));
  } else if (trimmed === '/workspace/project') {
    resolved = projectRoot;
  } else if (trimmed.startsWith('/workspace/project/')) {
    resolved = path.resolve(projectRoot, trimmed.slice('/workspace/project/'.length));
  } else if (trimmed === '/workspace/global') {
    resolved = globalRoot;
  } else if (trimmed.startsWith('/workspace/global/')) {
    resolved = path.resolve(globalRoot, trimmed.slice('/workspace/global/'.length));
  } else if (path.isAbsolute(trimmed)) {
    resolved = path.resolve(trimmed);
  } else {
    resolved = path.resolve(groupRoot, trimmed);
  }

  if (!allowedRoots.some((root) => isPathWithinBase(root, resolved))) {
    return null;
  }

  return resolved;
}

function resolveTelegramAttachments(
  chatJid: string,
  hints: TelegramAttachmentHint[],
): { attachments: TelegramResolvedAttachment[]; skipped: number } {
  const attachments: TelegramResolvedAttachment[] = [];
  let skipped = 0;

  for (const hint of hints) {
    const hostPath = resolveTelegramAttachmentHostPath(chatJid, hint.rawPath);
    if (!hostPath) {
      skipped += 1;
      logger.warn({ chatJid, rawPath: hint.rawPath }, 'Blocked Telegram attachment path');
      continue;
    }

    let stat: fs.Stats;
    try {
      stat = fs.statSync(hostPath);
    } catch {
      skipped += 1;
      logger.warn({ chatJid, hostPath }, 'Telegram attachment path not found');
      continue;
    }

    if (!stat.isFile()) {
      skipped += 1;
      logger.warn({ chatJid, hostPath }, 'Telegram attachment path is not a file');
      continue;
    }

    if (stat.size > TELEGRAM_MEDIA_MAX_BYTES) {
      skipped += 1;
      logger.warn(
        { chatJid, hostPath, size: stat.size, maxBytes: TELEGRAM_MEDIA_MAX_BYTES },
        'Telegram attachment exceeded max size',
      );
      continue;
    }

    const fileName = path.basename(hostPath);
    const ext = path.extname(fileName).toLowerCase();
    const kind: 'photo' | 'document' = TELEGRAM_IMAGE_EXTENSIONS.has(ext)
      ? 'photo'
      : 'document';
    attachments.push({
      hostPath,
      fileName,
      kind,
      caption: truncateTelegramCaption(hint.caption),
    });
  }

  return { attachments, skipped };
}

async function sendTelegramAgentReply(chatJid: string, text: string): Promise<void> {
  if (!state.telegramBot) {
    await sendMessage(chatJid, text);
    return;
  }

  const extracted = extractTelegramAttachmentHints(text);
  if (extracted.hints.length === 0) {
    await sendMessage(chatJid, text);
    return;
  }

  const resolved = resolveTelegramAttachments(chatJid, extracted.hints);
  if (resolved.attachments.length === 0) {
    await sendMessage(chatJid, text);
    return;
  }

  if (extracted.cleanedText) {
    await sendMessage(chatJid, extracted.cleanedText);
  }

  let failedSends = 0;
  for (const attachment of resolved.attachments) {
    try {
      const data = fs.readFileSync(attachment.hostPath);
      if (attachment.kind === 'photo') {
        await state.telegramBot.sendPhoto(chatJid, data, attachment.caption);
      } else {
        await state.telegramBot.sendDocument(
          chatJid,
          data,
          attachment.fileName,
          attachment.caption,
        );
      }
      logger.info(
        { chatJid, kind: attachment.kind, fileName: attachment.fileName, path: attachment.hostPath },
        'Telegram attachment sent',
      );
    } catch (err) {
      failedSends += 1;
      logger.error(
        { chatJid, err, fileName: attachment.fileName, path: attachment.hostPath },
        'Failed to send Telegram attachment',
      );
    }
  }

  const failedTotal = failedSends + resolved.skipped;
  if (failedTotal > 0) {
    await sendMessage(
      chatJid,
      `Note: ${failedTotal} attachment${failedTotal === 1 ? '' : 's'} could not be delivered.`,
    );
  }
}

async function sendAgentResultMessage(
  chatJid: string,
  text: string,
  opts: { prefixWhatsApp?: boolean } = {},
): Promise<void> {
  if (isTelegramJid(chatJid)) {
    await sendTelegramAgentReply(chatJid, text);
    return;
  }

  const outgoing = opts.prefixWhatsApp ? `${ASSISTANT_NAME}: ${text}` : text;
  await sendMessage(chatJid, outgoing);
}

async function sendMessage(jid: string, text: string): Promise<void> {
  if (isTelegramJid(jid)) {
    if (!state.telegramBot) {
      logger.error({ jid }, 'Telegram message send requested but Telegram is not configured');
      return;
    }
    try {
      await state.telegramBot.sendMessage(jid, text);
      logger.info({ jid, length: text.length }, 'Telegram message sent');
    } catch (err) {
      logger.error({ jid, err }, 'Failed to send Telegram message');
    }
    return;
  }

  if (!state.sock) {
    logger.error({ jid }, 'WhatsApp message send requested but WhatsApp is not connected');
    return;
  }
  try {
    await state.sock.sendMessage(jid, { text });
    logger.info({ jid, length: text.length }, 'Message sent');
  } catch (err) {
    logger.error({ jid, err }, 'Failed to send message');
  }
}

const TELEGRAM_TOOL_EMOJIS: Record<string, string> = {
  bash: '💻',
  read: '📖',
  write: '✍️',
  edit: '🔧',
  grep: '🔎',
  find: '🔎',
  ls: '📂',
  web: '🌐',
  fetch: '📄',
  search: '🔍',
};

function getTelegramToolProgressKey(chatJid: string, requestId: string): string {
  return `${chatJid}::${requestId}`;
}

function truncateToolProgressPreview(value: string, max = 80): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  if (!compact) return '';
  return compact.length <= max ? compact : `${compact.slice(0, max - 3)}...`;
}

function extractToolProgressPreview(args?: string): string | null {
  if (!args) return null;
  try {
    const parsed = JSON.parse(args) as Record<string, unknown>;
    for (const key of ['command', 'path', 'url', 'query', 'pattern', 'task', 'prompt', 'message']) {
      const value = parsed[key];
      if (typeof value === 'string' && value.trim()) {
        return truncateToolProgressPreview(value);
      }
    }
    const firstString = Object.values(parsed).find((value) => typeof value === 'string' && value.trim());
    if (typeof firstString === 'string') {
      return truncateToolProgressPreview(firstString);
    }
  } catch {
    return truncateToolProgressPreview(args);
  }
  return truncateToolProgressPreview(args);
}

function buildTelegramToolProgressLine(
  event: {
    toolName: string;
    status: 'start' | 'ok' | 'error';
    args?: string;
    output?: string;
    error?: string;
  },
  mode: VerboseMode,
  lastToolName?: string,
): string | null {
  const emoji = TELEGRAM_TOOL_EMOJIS[event.toolName] || '⚙️';
  if (event.status === 'start') {
    if (mode === 'new' && event.toolName === lastToolName) return null;
    if (mode === 'new') {
      // For 'new' mode, only show tool name without args
      return `${emoji} ${event.toolName}`;
    }
    if (mode === 'verbose' && event.args) {
      let keys = '';
      try {
        const parsed = JSON.parse(event.args) as Record<string, unknown>;
        keys = Object.keys(parsed).join(', ');
      } catch {
        keys = '';
      }
      return keys
        ? `${emoji} ${event.toolName}(${keys})\n${truncateToolProgressPreview(event.args, 200)}`
        : `${emoji} ${event.toolName}\n${truncateToolProgressPreview(event.args, 200)}`;
    }
    const preview = extractToolProgressPreview(event.args);
    return preview ? `${emoji} ${event.toolName}: "${preview}"` : `${emoji} ${event.toolName}...`;
  }
  if (event.status === 'error') {
    const preview = truncateToolProgressPreview(event.error || event.output || 'tool failed', 120);
    return `⚠️ ${event.toolName} error: ${preview}`;
  }
  if (mode === 'verbose' && event.output) {
    return `↳ ${event.toolName}: ${truncateToolProgressPreview(event.output, 160)}`;
  }
  return null;
}

function queueTelegramToolProgressUpdate(
  chatJid: string,
  requestId: string,
  mode: VerboseMode | undefined,
  event: {
    toolName: string;
    status: 'start' | 'ok' | 'error';
    args?: string;
    output?: string;
    error?: string;
  },
): void {
  const bot = state.telegramBot;
  if (!bot) return;
  const effectiveMode = getEffectiveVerboseMode(mode);
  if (effectiveMode === 'off') return;

  const key = getTelegramToolProgressKey(chatJid, requestId);
  const progress = telegramToolProgressRuns.get(key) || {
    lines: [],
    chain: Promise.resolve(),
  };
  telegramToolProgressRuns.set(key, progress);

  progress.chain = progress.chain
    .then(async () => {
      const line = buildTelegramToolProgressLine(event, effectiveMode, progress.lastToolName);
      if (!line) return;
      if (event.status === 'start') {
        progress.lastToolName = event.toolName;
      }
      progress.lines.push(line);
      const text = progress.lines.join('\n');
      if (!progress.messageId) {
        progress.messageId = await bot.sendStreamMessage(chatJid, text);
        return;
      }
      await bot.editStreamMessage(chatJid, progress.messageId, text);
    })
    .catch((err) => {
      logger.warn({ chatJid, requestId, err }, 'Failed to update Telegram tool progress');
    });
}

async function finalizeTelegramToolProgress(
  chatJid: string,
  requestId: string,
): Promise<void> {
  const key = getTelegramToolProgressKey(chatJid, requestId);
  const progress = telegramToolProgressRuns.get(key);
  if (!progress) return;
  telegramToolProgressRuns.delete(key);
  try {
    await progress.chain;
  } catch {
    // best-effort cleanup
  }
}

async function deleteTelegramPreviewMessage(
  chatJid: string,
  messageId: number,
): Promise<void> {
  if (!state.telegramBot) return;
  try {
    await state.telegramBot.deleteMessage(chatJid, messageId);
    logger.info({ chatJid, messageId }, 'Telegram streaming preview deleted');
  } catch (err) {
    logger.warn(
      { chatJid, messageId, err },
      'Failed to delete Telegram streaming preview',
    );
  }
}

async function finalizeTelegramPreviewMessage(
  chatJid: string,
  messageId: number,
  text: string,
): Promise<boolean> {
  if (!state.telegramBot) return false;

  const extracted = extractTelegramAttachmentHints(text);
  if (extracted.hints.length > 0) {
    await deleteTelegramPreviewMessage(chatJid, messageId);
    await sendTelegramAgentReply(chatJid, text);
    logger.info(
      { chatJid, messageId, finalizeMode: 'delete-then-send' },
      'Telegram streaming preview finalized',
    );
    return true;
  }

  const chunks = splitTelegramText(text);
  if (chunks.length === 0) {
    await deleteTelegramPreviewMessage(chatJid, messageId);
    logger.info(
      { chatJid, messageId, finalizeMode: 'delete-empty' },
      'Telegram streaming preview finalized',
    );
    return true;
  }

  try {
    await state.telegramBot.editStreamMessage(chatJid, messageId, chunks[0]);
  } catch (err) {
    logger.warn(
      { chatJid, messageId, err },
      'Failed to finalize Telegram streaming preview in place',
    );
    await deleteTelegramPreviewMessage(chatJid, messageId);
    return false;
  }

  for (const chunk of chunks.slice(1)) {
    await state.telegramBot.sendMessage(chatJid, chunk);
  }

  logger.info(
    {
      chatJid,
      messageId,
      finalizeMode: chunks.length > 1 ? 'edit-plus-followups' : 'edit-in-place',
      chunkCount: chunks.length,
    },
    'Telegram streaming preview finalized',
  );
  return true;
}

function getTelegramHostStreamKey(chatJid: string, requestId: string): string {
  return `${chatJid}:${requestId}`;
}

function noteTelegramHostStreamedRun(chatJid: string, requestId: string): boolean {
  const key = getTelegramHostStreamKey(chatJid, requestId);
  const had = telegramHostStreamedRuns.has(key);
  telegramHostStreamedRuns.set(key, Date.now());
  return !had;
}

function noteTelegramHostCompletedRun(chatJid: string, requestId: string): void {
  telegramHostCompletedRuns.set(
    getTelegramHostStreamKey(chatJid, requestId),
    Date.now(),
  );
}

function consumeTelegramHostCompletedRun(
  chatJid: string,
  requestId: string,
): boolean {
  const key = getTelegramHostStreamKey(chatJid, requestId);
  const had = telegramHostCompletedRuns.has(key);
  if (had) telegramHostCompletedRuns.delete(key);
  return had;
}

function consumeTelegramHostStreamState(
  chatJid: string,
  requestId: string,
): { mode: 'draft'; lastText: string; updatedAt: number }
  | { mode: 'message'; messageId: number; lastText: string; updatedAt: number }
  | null {
  const key = getTelegramHostStreamKey(chatJid, requestId);
  telegramHostStreamedRuns.delete(key);
  const state = telegramDraftDisabledRuns.getStreamState(key);
  telegramDraftDisabledRuns.disable(key);
  return state || null;
}

function pruneTelegramHostStreamedRuns(): void {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [key, ts] of telegramHostStreamedRuns.entries()) {
    if (ts <= cutoff) telegramHostStreamedRuns.delete(key);
  }
  for (const [key, ts] of telegramHostCompletedRuns.entries()) {
    if (ts <= cutoff) telegramHostCompletedRuns.delete(key);
  }
}

function startIpcWatcher(): void {
  if (state.ipcWatcherRunning) {
    logger.debug('IPC watcher already running, skipping duplicate start');
    return;
  }
  state.ipcWatcherRunning = true;

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
    telegramDraftDisabledRuns.prune();
    pruneTelegramHostStreamedRuns();

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
              const draftUpdate = parseTelegramDraftIpcMessage(data);
              if (draftUpdate) {
                const targetGroup = state.registeredGroups[draftUpdate.chatJid];
                if (!isMain && (!targetGroup || targetGroup.folder !== sourceGroup)) {
                  logger.warn(
                    { chatJid: draftUpdate.chatJid, sourceGroup },
                    'Unauthorized IPC Telegram draft update blocked',
                  );
                } else if (!isTelegramJid(draftUpdate.chatJid)) {
                  logger.debug(
                    { chatJid: draftUpdate.chatJid, sourceGroup },
                    'Ignoring IPC Telegram draft update for non-Telegram chat',
                  );
                } else if (!state.telegramBot) {
                  logger.debug(
                    { chatJid: draftUpdate.chatJid, sourceGroup },
                    'Ignoring IPC Telegram draft update while Telegram is disabled',
                  );
                } else {
                  const sendResult = await sendTelegramDraftWithFallback({
                    bot: state.telegramBot,
                    draft: draftUpdate,
                    registry: telegramDraftDisabledRuns,
                  });
                  if (
                    sendResult.sent &&
                    draftUpdate.requestId &&
                    telegramDraftDisabledRuns.getStreamState(sendResult.runKey)?.mode ===
                      'message'
                  ) {
                    const firstStreamForRun = noteTelegramHostStreamedRun(
                      draftUpdate.chatJid,
                      draftUpdate.requestId,
                    );
                    if (firstStreamForRun) {
                      logger.info(
                        {
                          chatJid: draftUpdate.chatJid,
                          sourceGroup,
                          requestId: draftUpdate.requestId,
                          runKey: sendResult.runKey,
                        },
                        'Telegram streaming preview active for run',
                      );
                    }
                  }
                  if (!sendResult.sent && sendResult.disabled && !sendResult.error) {
                    logger.debug(
                      {
                        chatJid: draftUpdate.chatJid,
                        sourceGroup,
                        runKey: sendResult.runKey,
                      },
                      'Skipping Telegram draft update for disabled run',
                    );
                  } else if (sendResult.error) {
                    logger.warn(
                      {
                        chatJid: draftUpdate.chatJid,
                        sourceGroup,
                        runKey: sendResult.runKey,
                        err: sendResult.error,
                      },
                      'Telegram draft update failed; disabling draft updates for this run',
                    );
                  }
                }
              } else if (data.type === 'message' && data.chatJid && data.text) {
                // Authorization: verify this group can send to this chatJid
                const targetGroup = state.registeredGroups[data.chatJid];
                const requestId =
                  typeof data.requestId === 'string' && data.requestId.trim()
                    ? data.requestId.trim()
                    : undefined;
                if (
                  isMain ||
                  (targetGroup && targetGroup.folder === sourceGroup)
                ) {
                  if (isTelegramJid(data.chatJid) && requestId) {
                    const previewState = consumeTelegramHostStreamState(
                      data.chatJid,
                      requestId,
                    );
                    noteTelegramHostCompletedRun(data.chatJid, requestId);
                    if (previewState?.mode === 'message') {
                      const finalized = await finalizeTelegramPreviewMessage(
                        data.chatJid,
                        previewState.messageId,
                        data.text,
                      );
                      if (!finalized) {
                        await sendTelegramAgentReply(data.chatJid, data.text);
                      }
                    } else {
                      await sendTelegramAgentReply(data.chatJid, data.text);
                    }
                  } else {
                    await sendMessage(
                      data.chatJid,
                      `${ASSISTANT_NAME}: ${data.text}`,
                    );
                  }
                  logger.info(
                    { chatJid: data.chatJid, sourceGroup, requestId },
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
                const result = FEATURE_FARM
                  ? await executeFarmAction(request, isMain)
                  : {
                      requestId: request.requestId,
                      status: 'error' as const,
                      error:
                        'farm_action is disabled in core profile (set FFT_PROFILE=farm or FEATURE_FARM=1)',
                      executedAt: new Date().toISOString(),
                    };
                const resultPath = path.join(
                  resultDir,
                  `${request.requestId}.json`,
                );
                fs.writeFileSync(resultPath, JSON.stringify(result, null, 2));
              } else if (request.type === 'memory_action') {
                const result = await executeMemoryAction(request, {
                  sourceGroup,
                  isMain,
                  registeredGroups: state.registeredGroups,
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
    schedule?: CronV2Schedule | string;
    context_mode?: string;
    session_target?: string;
    wake_mode?: string;
    delivery_mode?: string;
    delivery_channel?: string;
    delivery_to?: string;
    delivery_webhook_url?: string;
    delivery?: {
      mode?: string;
      channel?: string;
      to?: string;
      webhookUrl?: string;
    };
    timeout_seconds?: number | string;
    stagger_ms?: number | string;
    delete_after_run?: boolean | number | string;
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

  switch (data.type) {
    case 'schedule_task':
      if (
        data.prompt &&
        (data.schedule || (data.schedule_type && data.schedule_value)) &&
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
        const targetJid = Object.entries(state.registeredGroups).find(
          ([, group]) => group.folder === targetGroup,
        )?.[0];

        if (!targetJid) {
          logger.warn(
            { targetGroup },
            'Cannot schedule task: target group not registered',
          );
          break;
        }

        let executionPlan;
        try {
          executionPlan = resolveCronExecutionPlan(data);
        } catch (err) {
          logger.warn(
            {
              scheduleType: data.schedule_type,
              scheduleValue: data.schedule_value,
              schedule: data.schedule,
              err,
            },
            'Invalid schedule in schedule_task',
          );
          break;
        }
        const policy = resolveCronPolicy(data);

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
          schedule_type: executionPlan.scheduleType,
          schedule_value: executionPlan.scheduleValue,
          context_mode: contextMode,
          schedule_json: executionPlan.scheduleJson || null,
          session_target: policy.sessionTarget,
          wake_mode: policy.wakeMode,
          delivery_mode: policy.delivery.mode,
          delivery_channel: policy.delivery.channel || null,
          delivery_to: policy.delivery.to || null,
          delivery_webhook_url: policy.delivery.webhookUrl || null,
          timeout_seconds: policy.timeoutSeconds || null,
          stagger_ms: policy.staggerMs || null,
          delete_after_run: policy.deleteAfterRun ? 1 : 0,
          consecutive_errors: 0,
          next_run: executionPlan.nextRun,
          status: 'active',
          created_at: new Date().toISOString(),
        });
        logger.info(
          {
            taskId,
            sourceGroup,
            targetGroup,
            contextMode,
            sessionTarget: policy.sessionTarget,
            wakeMode: policy.wakeMode,
            deliveryMode: policy.delivery.mode,
          },
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
          await import('./pi-runner.js');
        writeGroups(
          sourceGroup,
          true,
          availableGroups,
          new Set(Object.keys(state.registeredGroups)),
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

  const { state: authState, saveCreds } = await useMultiFileAuthState(authDir);

  state.sock = makeWASocket({
    auth: {
      creds: authState.creds,
      keys: makeCacheableSignalKeyStore(authState.keys, logger),
    },
    printQRInTerminal: false,
    logger,
    browser: Browsers.macOS('Chrome'),
  });

  state.sock.ev.on('connection.update', (update) => {
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
      const reason = (
        lastDisconnect?.error as { output?: { statusCode?: number } } | undefined
      )?.output?.statusCode;
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

      // Keep presence in an active state so per-chat typing updates remain reliable.
      state.sock!.sendPresenceUpdate('available').catch((err) => {
        logger.debug({ err }, 'Failed to set initial available presence');
      });

      // Build LID to phone mapping from auth state for self-chat translation
      if (state.sock!.user) {
        const phoneUser = state.sock!.user.id.split(':')[0];
        const lidUser = state.sock!.user.lid?.split(':')[0];
        if (lidUser && phoneUser) {
          state.lidToPhoneMap[lidUser] = `${phoneUser}@s.whatsapp.net`;
          logger.debug({ lidUser, phoneUser }, 'LID to phone mapping set');
        }
      }

      maybeRegisterWhatsAppMainChat();
      
      // Sync group metadata on startup (respects 24h cache)
      syncGroupMetadata().catch((err) =>
        logger.error({ err }, 'Initial group sync failed'),
      );
      // Set up daily sync timer (only once)
      if (!state.groupSyncTimerStarted) {
        state.groupSyncTimerStarted = true;
        setInterval(() => {
          syncGroupMetadata().catch((err) =>
            logger.error({ err }, 'Periodic group sync failed'),
          );
        }, GROUP_SYNC_INTERVAL_MS);
      }
      startSchedulerLoop({
        sendMessage,
        registeredGroups: () => state.registeredGroups,
        requestHeartbeatNow,
      });
      startIpcWatcher();
      void startMessageLoop().catch((err) =>
        logger.fatal({ err }, 'Message loop crashed unexpectedly'),
      );
    }
  });

  state.sock.ev.on('creds.update', saveCreds);

  state.sock.ev.on('messages.upsert', ({ messages }) => {
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
      if (state.registeredGroups[chatJid]) {
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
  if (state.messageLoopRunning) {
    logger.debug('Message loop already running, skipping duplicate start');
    return;
  }
  state.messageLoopRunning = true;
  logger.info(`FFT_nano running (trigger: @${ASSISTANT_NAME})`);

  while (true) {
    try {
      const jids = Object.keys(state.registeredGroups);
      const { messages } = getNewMessages(jids, state.lastTimestamp, ASSISTANT_NAME);

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
          state.lastTimestamp = msg.timestamp;
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

function logHeartbeatSkip(
  reason: string,
  extra: Record<string, string | number | boolean | null> = {},
): void {
  logger.debug({ reason, ...extra }, 'Skipping heartbeat');
}

function shouldBypassEmptyHeartbeatSkip(reason: string): boolean {
  return (
    reason === 'wake' ||
    reason === 'exec-event' ||
    reason.startsWith('cron:') ||
    reason.startsWith('hook:')
  );
}

async function runHeartbeatTurn(reason = 'interval'): Promise<void> {
  if (!HEARTBEAT_ENABLED) return;
  const mainChatJid = findMainChatJid();
  if (!mainChatJid) {
    logHeartbeatSkip('no-main-chat');
    return;
  }
  if (!isWithinHeartbeatActiveHours(HEARTBEAT_ACTIVE_HOURS)) {
    logHeartbeatSkip('quiet-hours', {
      activeHours: HEARTBEAT_ACTIVE_HOURS?.raw || null,
      reason,
    });
    return;
  }
  if (activeChatRuns.has(mainChatJid)) {
    logHeartbeatSkip('active-run', { chatJid: mainChatJid, reason });
    return;
  }

  const group = state.registeredGroups[mainChatJid];
  if (!group || group.folder !== MAIN_GROUP_FOLDER) {
    logHeartbeatSkip('main-group-not-registered', { chatJid: mainChatJid, reason });
    return;
  }
  if (
    !shouldBypassEmptyHeartbeatSkip(reason) &&
    isHeartbeatFileEffectivelyEmpty(path.join(MAIN_WORKSPACE_DIR, 'HEARTBEAT.md'))
  ) {
    logHeartbeatSkip('empty-heartbeat-file', { chatJid: mainChatJid, reason });
    return;
  }

  const requestId = `heartbeat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const abortController = new AbortController();
  const activeRun: ActiveChatRun = {
    chatJid: mainChatJid,
    startedAt: Date.now(),
    requestId,
    abortController,
  };
  activeChatRuns.set(mainChatJid, activeRun);
  activeChatRunsById.set(requestId, activeRun);
  await setTyping(mainChatJid, true);
  try {
    const run = await runAgent(
      group,
      `${HEARTBEAT_PROMPT}\n\n[SYSTEM NOTE]\nHeartbeat run.`,
      mainChatJid,
      'auto',
      requestId,
      state.chatRunPreferences[mainChatJid] || {},
      { suppressErrorReply: true },
      abortController.signal,
    );
    if (!run.ok) {
      logger.warn({ chatJid: mainChatJid, reason }, 'Heartbeat run failed');
      return;
    }
    updateChatUsage(mainChatJid, run.usage);
    if (run.streamed || !run.result) return;

    const normalized = stripHeartbeatToken(run.result, {
      mode: 'heartbeat',
      maxAckChars: HEARTBEAT_ACK_MAX_CHARS,
    });
    if (normalized.shouldSkip || !normalized.text.trim()) {
      if (HEARTBEAT_SHOW_OK && /HEARTBEAT_OK/.test(run.result)) {
        const destination = resolveHeartbeatTargetJid(mainChatJid);
        if (!destination) {
          logHeartbeatSkip('no-destination', { chatJid: mainChatJid, reason });
          return;
        }
        await sendMessage(destination, 'HEARTBEAT_OK');
        rememberHeartbeatTarget(destination);
      }
      logHeartbeatSkip('ack-token', {
        chatJid: mainChatJid,
        didStrip: normalized.didStrip,
        reason,
      });
      return;
    }
    if (!HEARTBEAT_SHOW_ALERTS) {
      logHeartbeatSkip('alerts-hidden', { chatJid: mainChatJid, reason });
      return;
    }

    const nowMs = Date.now();
    const previous = heartbeatLastSent.get(mainChatJid);
    if (
      shouldSuppressDuplicateHeartbeat({
        text: normalized.text,
        nowMs,
        previousText: previous?.text,
        previousSentAt: previous?.sentAt,
      })
    ) {
      logHeartbeatSkip('duplicate', { chatJid: mainChatJid, reason });
      return;
    }

    const destination = resolveHeartbeatTargetJid(mainChatJid);
    if (!destination) {
      logHeartbeatSkip('no-destination', { chatJid: mainChatJid, reason });
      return;
    }
    if (HEARTBEAT_TARGET_ACCOUNT_ID?.trim()) {
      logger.debug(
        { accountId: HEARTBEAT_TARGET_ACCOUNT_ID, target: HEARTBEAT_TARGET },
        'Heartbeat accountId configured but ignored (single-account channels in FFT_nano)',
      );
    }
    await sendMessage(destination, normalized.text);
    rememberHeartbeatTarget(destination);
    if (HEARTBEAT_INCLUDE_REASONING) {
      const match =
        run.result.match(/<reasoning>([\s\S]*?)<\/reasoning>/i) ||
        run.result.match(/<thinking>([\s\S]*?)<\/thinking>/i);
      const reasoning = match?.[1]?.trim();
      if (reasoning) {
        await sendMessage(destination, `Reasoning:\n${reasoning}`);
      }
    }
    heartbeatLastSent.set(mainChatJid, { text: normalized.text, sentAt: nowMs });
  } catch (err) {
    logger.warn({ err, chatJid: mainChatJid }, 'Heartbeat run failed');
  } finally {
    if (activeChatRuns.get(mainChatJid) === activeRun) {
      activeChatRuns.delete(mainChatJid);
    }
    activeChatRunsById.delete(requestId);
    await setTyping(mainChatJid, false);
  }
}

function startHeartbeatLoop(): void {
  if (!HEARTBEAT_ENABLED || state.heartbeatLoopStarted) return;
  state.heartbeatLoopStarted = true;
  setInterval(() => {
    if (state.shuttingDown) return;
    void runHeartbeatTurn('interval');
  }, HEARTBEAT_INTERVAL_MS);
  logger.info({ everyMs: HEARTBEAT_INTERVAL_MS }, 'Heartbeat loop started');
}

function requestHeartbeatNow(reason = 'manual'): void {
  if (state.shuttingDown) return;
  void runHeartbeatTurn(reason);
}

function ensureContainerSystemRunning(): void {
  const runtime = getContainerRuntime();
  if (runtime === 'host') {
    if (
      (process.env.NODE_ENV || '').toLowerCase() === 'production' &&
      !['1', 'true', 'yes', 'on'].includes(
        (process.env.FFT_NANO_ALLOW_HOST_RUNTIME_IN_PROD || '').toLowerCase(),
      )
    ) {
      throw new Error(
        'Host runtime is blocked in production unless FFT_NANO_ALLOW_HOST_RUNTIME_IN_PROD=1',
      );
    }
    logger.warn(
      'Running in host runtime mode (no container isolation). This should only be used for trusted local workflows.',
    );
    return;
  }

  try {
    // Verifies Docker is installed and the daemon is reachable.
    execSync('docker info', { stdio: 'pipe' });
    logger.debug('Docker runtime available');
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

  try {
    const output = execSync(
      "docker ps -a --filter status=exited --filter name=nanoclaw- --format '{{.Names}}'",
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        encoding: 'utf-8',
      },
    );
    const stale = output
      .split('\n')
      .map((n) => n.trim())
      .filter((n) => n.startsWith('nanoclaw-'));
    if (stale.length > 0) {
      execSync(`docker rm ${stale.join(' ')}`, { stdio: 'pipe' });
      logger.info({ runtime, count: stale.length }, 'Cleaned up stale containers');
    }
  } catch {
    // Ignore cleanup failures (unsupported flags/no stale containers/runtime quirks).
  }
}

function stopFarmServicesForShutdown(signal: string): void {
  if (state.shuttingDown) return;
  state.shuttingDown = true;
  logger.info({ signal }, 'Shutting down FFT_nano services');

  if (FEATURE_FARM && FARM_STATE_ENABLED) {
    stopFarmStateCollector();
  }
}

async function shutdownAndExit(signal: string, exitCode: number): Promise<void> {
  stopFarmServicesForShutdown(signal);
  await stopWebControlCenterService();
  await stopTuiGatewayService();
  process.exit(exitCode);
}

function registerShutdownHandlers(): void {
  process.on('SIGINT', () => {
    void shutdownAndExit('SIGINT', 0);
  });

  process.on('SIGTERM', () => {
    void shutdownAndExit('SIGTERM', 0);
  });
}

async function main(): Promise<void> {
  registerShutdownHandlers();
  if (HEARTBEAT_ACTIVE_HOURS_RAW?.trim() && !HEARTBEAT_ACTIVE_HOURS) {
    logger.warn(
      { value: HEARTBEAT_ACTIVE_HOURS_RAW },
      'Ignoring invalid heartbeat active-hours format; expected HH:MM-HH:MM, Mon-Fri@HH:MM-HH:MM, or HH:MM-HH:MM@America/New_York',
    );
  }
  acquireSingletonLock(path.join(DATA_DIR, 'fft_nano.lock'));
  ensureContainerSystemRunning();
  initDatabase();
  logger.info('Database initialized');
  loadState();
  migrateLegacyClaudeMemoryFiles();
  migrateCompactionSummariesFromSoul();
  maybePromoteConfiguredTelegramMain();
  await startTuiGatewayService();
  await startWebControlCenterService();
  logger.info(
    {
      profile: FFT_PROFILE,
      featureFarm: FEATURE_FARM,
      profileDetection: PROFILE_DETECTION,
    },
    'Runtime profile resolved',
  );

  if (FEATURE_FARM && FARM_STATE_ENABLED) {
    startFarmStateCollector();
  }

  const telegramEnabled = !!TELEGRAM_BOT_TOKEN;
  const farmOnlyMode =
    FEATURE_FARM && FARM_STATE_ENABLED && !WHATSAPP_ENABLED && !telegramEnabled;
  
  if (!WHATSAPP_ENABLED && !telegramEnabled && !farmOnlyMode) {
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
      registeredGroups: () => state.registeredGroups,
      requestHeartbeatNow,
    });
    startIpcWatcher();
    startHeartbeatLoop();
    void startMessageLoop().catch((err) =>
      logger.fatal({ err }, 'Message loop crashed unexpectedly'),
    );
  }

  if (farmOnlyMode) {
    logger.info('Running in farm-state-only mode (no channels enabled)');
  } else if (WHATSAPP_ENABLED) {
    await connectWhatsApp();
    startHeartbeatLoop();
  } else {
    logger.info('WhatsApp disabled (WHATSAPP_ENABLED=0)');
  }

  void maybeRunBootMdOnce();
}

main().catch(async (err) => {
  stopFarmServicesForShutdown('startup_error');
  await stopWebControlCenterService();
  await stopTuiGatewayService();
  logger.error({ err }, 'Failed to start FFT_nano');
  process.exit(1);
});
