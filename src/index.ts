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
  deriveTelegramDraftId,
  runContainerAgent,
  type ExtensionUIRequest,
  type ExtensionUIResponse,
  writeGroupsSnapshot,
  writeTasksSnapshot,
} from './pi-runner.js';
import {
  createPendingConfirmation,
  parsePermissionGateCallback,
  resolvePendingConfirmation,
  shouldPromptPermissionGate,
} from './permission-gate-ui.js';
import {
  getAllChats,
  getAllTasks,
  deleteTask,
  getDueTasks,
  getChatHistory,
  getLastGroupSync,
  getMessagesSince,
  getPromptTranscriptMessages,
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
  buildTelegramMediaStoragePaths,
  extractTelegramAttachmentHints as extractTelegramAttachmentHintsFromReply,
  resolveTelegramAttachments as resolveTelegramAttachmentsFromReply,
  sendResolvedTelegramAttachments,
} from './telegram-attachments.js';
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
  getRuntimeProviderDefinitionByPiApi,
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
  consumeNextRunNoContinue as consumeNextRunNoContinueCore,
  formatChatRuntimePreferences as formatChatRuntimePreferencesCore,
  formatUsageText as formatUsageTextCore,
  getEffectiveModelLabel as getEffectiveModelLabelCore,
  getTuiSessionPrefs as getTuiSessionPrefsCore,
  normalizeTelegramDeliveryMode,
  normalizeReasoningLevel,
  normalizeThinkLevel,
  parseDurationMs,
  parseQueueArgs,
  patchTuiSessionPrefs as patchTuiSessionPrefsCore,
  updateChatRunPreferences as updateChatRunPreferencesCore,
  updateChatUsage as updateChatUsageCore,
} from './chat-preferences.js';
import {
  isSubstantialCodingTask,
  parseDelegationTrigger,
  type CodingHint,
} from './coding-delegation.js';
import {
  createCodingOrchestrator,
  type CodingWorkerRequest,
} from './coding-orchestrator.js';
import { resolveCoderProjectTarget } from './coder-project-resolver.js';
import { executeFarmAction } from './farm-action-gateway.js';
import {
  startFarmStateCollector,
  stopFarmStateCollector,
} from './farm-state-collector.js';
import { executeMemoryAction } from './memory-action-gateway.js';
import { isValidGroupFolder, resolveGroupFolderPath } from './group-folder.js';
import { applyNonHeartbeatEmptyOutputPolicy } from './agent-empty-output.js';
import {
  appendCompactionSummaryToMemory,
  migrateCompactionsForGroup,
  resolveCompactionMemoryRelativePath,
} from './memory-maintenance.js';
import { ensureMemoryScaffold } from './memory-paths.js';
import { resolveCoderProjectWorkspace } from './coder-project-path.js';
import {
  cycleVerboseMode,
  describeVerboseMode,
  getEffectiveVerboseMode,
  parseVerboseDirective,
  type VerboseMode,
} from './verbose-mode.js';
import {
  resolveCronExecutionPlan,
  resolveCronPolicy,
} from './cron/adapters.js';
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
  getTelegramPreviewRunKey,
  resolveTelegramStreamCompletionState,
  type TelegramMessagePreviewState,
  updateTelegramDraftPreview,
  updateTelegramPreview,
} from './telegram-streaming.js';
import {
  awaitTelegramToolProgressRun,
  buildTelegramPreviewToolTrailEntry,
  enqueueTelegramToolProgressMessage,
  getTelegramToolProgressKey,
  getTelegramToolEmoji,
  shouldUseTelegramPreviewToolTrail,
  shouldUseStandaloneTelegramToolProgress,
} from './telegram-tool-progress.js';
import {
  createHostEventId,
  createOrderedHostEventProcessor,
  type HostEvent,
} from './runtime/host-events.js';
import {
  createStatusTelemetry,
  formatStatusReport,
  isUserAbortedErrorMessage,
} from './status-report.js';
import {
  dispatchLegacyMessageEnvelope,
  wrapLegacyActionEnvelope,
  wrapLegacyMessageEnvelope,
  wrapLegacyTaskEnvelope,
} from './runtime/boundary-ipc.js';
import { createAppRuntime } from './app.js';
import {
  createMessageDispatcher,
  finalizeCompletedRun,
  type PromptInputLogEntry,
} from './message-dispatch.js';
import { writePromptInputLogFile } from './prompt-input-log.js';
import { createTelegramCommandHandlers } from './telegram-commands.js';
import {
  state,
  activeCoderRuns,
  activeChatRuns,
  activeChatRunsById,
  tuiMessageQueue,
  telegramPreviewRegistry,
  heartbeatLastSent,
  heartbeatLastTargetByChannel,
  compactionMemoryFlushMarkers,
  telegramSettingsPanelActions,
  telegramSetupInputStates,
  hostEventBus,
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
  type TelegramDeliveryMode,
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
const HEARTBEAT_ENABLED =
  PARITY_CONFIG.heartbeat.enabled && HEARTBEAT_INTERVAL_MS > 0;
const HEARTBEAT_ACTIVE_HOURS_RAW = resolveHeartbeatActiveHoursRaw();
const HEARTBEAT_ACK_MAX_CHARS = Math.max(
  0,
  PARITY_CONFIG.heartbeat.ackMaxChars || 300,
);
const HEARTBEAT_ACTIVE_HOURS = parseHeartbeatActiveHours(
  HEARTBEAT_ACTIVE_HOURS_RAW,
);
const HEARTBEAT_TARGET = PARITY_CONFIG.heartbeat.target;
const HEARTBEAT_TARGET_TO = PARITY_CONFIG.heartbeat.to;
const HEARTBEAT_TARGET_ACCOUNT_ID = PARITY_CONFIG.heartbeat.accountId;
const HEARTBEAT_SHOW_OK = PARITY_CONFIG.heartbeat.visibility.showOk;
const HEARTBEAT_SHOW_ALERTS = PARITY_CONFIG.heartbeat.visibility.showAlerts;
const HEARTBEAT_INCLUDE_REASONING = PARITY_CONFIG.heartbeat.includeReasoning;
const STATUS_INCIDENT_WINDOW_MS = 30 * 60 * 1000;
const STATUS_INCIDENT_WINDOW_LABEL = '30m';
const STATUS_STUCK_WARNING_SECONDS = 120;

const GROUP_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const TELEGRAM_MEDIA_MAX_BYTES = TELEGRAM_MEDIA_MAX_MB * 1024 * 1024;
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
const statusTelemetry = createStatusTelemetry({
  incidentWindowMs: STATUS_INCIDENT_WINDOW_MS,
  maxIncidents: 3,
});

function getChatPrefsRuntime() {
  return {
    chatRunPreferences: state.chatRunPreferences,
    chatUsageStats: state.chatUsageStats,
    saveState,
    defaultProvider: process.env.PI_API,
    defaultModel: process.env.PI_MODEL,
    getEffectiveVerboseMode,
  };
}

function updateChatRunPreferences(
  chatJid: string,
  updater: (current: ChatRunPreferences) => ChatRunPreferences,
): ChatRunPreferences {
  return updateChatRunPreferencesCore(getChatPrefsRuntime(), chatJid, updater);
}

function getTuiSessionPrefs(chatJid: string): TuiSessionPrefs {
  return getTuiSessionPrefsCore(getChatPrefsRuntime(), chatJid);
}

function patchTuiSessionPrefs(
  chatJid: string,
  patch: TuiSessionPrefs,
): TuiSessionPrefs {
  return patchTuiSessionPrefsCore(getChatPrefsRuntime(), chatJid, patch);
}

function consumeNextRunNoContinue(chatJid: string): boolean {
  return consumeNextRunNoContinueCore(getChatPrefsRuntime(), chatJid);
}

function getEffectiveModelLabel(chatJid: string): string {
  return getEffectiveModelLabelCore(getChatPrefsRuntime(), chatJid);
}

function formatChatRuntimePreferences(chatJid: string): string[] {
  return formatChatRuntimePreferencesCore(getChatPrefsRuntime(), chatJid);
}

function updateChatUsage(
  chatJid: string,
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    provider?: string;
    model?: string;
  },
): void {
  updateChatUsageCore(getChatPrefsRuntime(), chatJid, usage);
}

function formatUsageText(
  chatJid: string,
  scope: 'chat' | 'all' = 'chat',
): string {
  return formatUsageTextCore(getChatPrefsRuntime(), chatJid, scope);
}

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
  state.chatRunPreferences = Object.fromEntries(
    Object.entries(loaded.chat_run_preferences || {}).map(
      ([chatJid, prefs]) => {
        const nextPrefs: ChatRunPreferences = { ...prefs };
        const normalizedDelivery = prefs.telegramDeliveryMode
          ? normalizeTelegramDeliveryMode(prefs.telegramDeliveryMode)
          : undefined;
        if (
          normalizedDelivery === 'partial' ||
          normalizedDelivery === undefined
        ) {
          delete nextPrefs.telegramDeliveryMode;
        } else {
          nextPrefs.telegramDeliveryMode = normalizedDelivery;
        }
        return [chatJid, nextPrefs];
      },
    ),
  );
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
  saveJson(
    path.join(DATA_DIR, 'registered_groups.json'),
    state.registeredGroups,
  );

  // Create group folder
  fs.mkdirSync(path.join(groupDir, 'logs'), { recursive: true });

  // Workspace persona file naming: SOUL.md is canonical. CLAUDE.md is supported
  // for backwards compatibility (older installs/groups).
  const soulFile = path.join(groupDir, 'SOUL.md');
  const nanoFile = path.join(groupDir, 'NANO.md');
  const todosFile = path.join(groupDir, 'TODOS.md');
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

  if (!fs.existsSync(nanoFile)) {
    fs.writeFileSync(
      nanoFile,
      [
        '# NANO',
        '',
        'Nano Core runtime contract.',
        '',
        'Session context order:',
        '1. Read NANO.md',
        '2. Read SOUL.md',
        '3. Read TODOS.md',
        '4. Retrieve durable canon from canonical/*.md when needed',
        '5. Read BOOTSTRAP.md (if present)',
        '',
        'Heartbeat and scheduled maintenance runs also read HEARTBEAT.md.',
        '',
        'Memory policy:',
        '- Durable memory belongs in canonical/*.md.',
        '- Daily staging and compaction notes belong in memory/*.md.',
        '- Keep SOUL.md stable; do not use it as compaction log storage.',
        '- TODOS.md is mission control for active execution state.',
        '',
        'Execution stance:',
        '- Use tools to verify claims and perform edits.',
        '- Prefer deterministic, testable changes.',
        '- Keep user-facing updates concise and concrete.',
      ].join('\n') + '\n',
    );
  }

  if (!fs.existsSync(soulFile)) {
    fs.writeFileSync(
      soulFile,
      `# SOUL\n\nYou are ${ASSISTANT_NAME}, a concise and practical assistant for ${group.name}.\n`,
    );
  }

  if (!fs.existsSync(todosFile)) {
    fs.writeFileSync(
      todosFile,
      [
        '# TODOS.md = MISSION CONTROL: Initial Mission',
        '',
        '## 🚀 ACTIVE OBJECTIVE',
        '> Ship the next validated increment safely.',
        '',
        '## 📋 TASK BOARD',
        '- [ ] Define first active task <!-- id:T1 status:PENDING -->',
        '',
        '## 🤖 SUB-AGENTS & PROCESSES',
        '- [None]',
        '',
        '## ⏳ BLOCKED / WAITING',
        '- [None]',
        '',
        '## 📝 MISSION LOG',
        '- [00:00] - Mission control initialized.',
      ].join('\n') + '\n',
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
  if (PARITY_CONFIG.workspace.skipBootstrap)
    return { active: false, pending: false };
  if (!PARITY_CONFIG.workspace.enforceBootstrapGate)
    return { active: false, pending: false };

  // Ensure first-message gate checks observe freshly seeded bootstrap state.
  ensureMainWorkspaceBootstrap({ workspaceDir: MAIN_WORKSPACE_DIR });
  const status = getMainWorkspaceOnboardingStatus(MAIN_WORKSPACE_DIR);
  if (!status.pending) return { active: false, pending: false };

  const enforceForWorkspace =
    status.gateEligible ||
    PARITY_CONFIG.workspace.enforceBootstrapGateForExisting;
  return {
    active: enforceForWorkspace,
    pending: true,
  };
}

function isCoderDelegationCommand(content: string): boolean {
  return /^\/(?:coder|coding|coder-plan|coder_plan|coder-create-project|coder_create_project)(?:@[A-Za-z0-9_]+)?(?:\s|$)/i.test(
    content.trim(),
  );
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
    'Update NANO.md, SOUL.md, and TODOS.md based on user responses. Promote durable facts and decisions into canonical/*.md.',
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
      return (
        parseTelegramTargetJid(HEARTBEAT_TARGET_TO) || findMainTelegramChatJid()
      );
    }
    return (
      heartbeatLastTargetByChannel.get('telegram') || findMainTelegramChatJid()
    );
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
    if (raw.startsWith('telegram:'))
      return parseTelegramTargetJid(raw) || mainChatJid;
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
    if (
      run.ok &&
      run.result?.trim() &&
      !/^BOOT_OK\b/i.test(run.result.trim())
    ) {
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
  const chatByJid = new Map(
    getAllChats().map((chat) => [chat.jid, chat] as const),
  );
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

function getTuiSessionHistory(
  chatJid: string,
  limit: number,
): SessionHistoryMessage[] {
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
  const createdAt = new Date().toISOString();
  hostEventBus.publish({
    kind: 'chat_state_changed',
    id: createHostEventId('chat'),
    createdAt,
    source: 'index',
    runId: payload.runId,
    sessionKey: payload.sessionKey,
    state: payload.state,
    ...(payload.message ? { message: payload.message } : {}),
    ...(payload.errorMessage ? { errorMessage: payload.errorMessage } : {}),
    ...(payload.usage ? { usage: payload.usage } : {}),
  });
}

function emitTuiAgentEvent(payload: {
  runId: string;
  sessionKey: string;
  phase: 'start' | 'end' | 'error';
  detail?: string;
}): void {
  hostEventBus.publish({
    kind: 'run_lifecycle_changed',
    id: createHostEventId('run'),
    createdAt: new Date().toISOString(),
    source: 'index',
    runId: payload.runId,
    sessionKey: payload.sessionKey,
    phase: payload.phase,
    detail: payload.detail,
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
  hostEventBus.publish({
    kind: 'tool_progress',
    id: createHostEventId('tool'),
    createdAt: new Date().toISOString(),
    source: 'index',
    runId: payload.runId,
    sessionKey: payload.sessionKey,
    index: payload.index,
    toolName: payload.toolName,
    status: payload.status,
    ...(payload.args ? { args: payload.args } : {}),
    ...(payload.output ? { output: payload.output } : {}),
    ...(payload.error ? { error: payload.error } : {}),
  });
}

function makeRunId(prefix = 'run'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function persistAssistantHistory(
  chatJid: string,
  text: string,
  runId?: string,
): string {
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

function persistTuiUserHistory(
  chatJid: string,
  text: string,
  runId: string,
): string {
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

function resetTuiSession(
  chatJid: string,
  reason: string,
): { ok: boolean; reason: string } {
  patchTuiSessionPrefs(chatJid, { noContinueNext: true });
  return { ok: true, reason };
}

function runPiListModels(searchText: string): { ok: boolean; text: string } {
  const loaded = loadPiModels(true);
  if (!loaded.ok) {
    return { ok: false, text: loaded.text };
  }

  const trimmed = searchText.trim().toLowerCase();
  const filtered = trimmed
    ? loaded.entries.filter(
        (e) =>
          e.provider.toLowerCase().includes(trimmed) ||
          e.model.toLowerCase().includes(trimmed),
      )
    : loaded.entries;

  if (filtered.length === 0) {
    return {
      ok: true,
      text: trimmed
        ? `No models matched "${trimmed}".`
        : 'No models were returned by pi.',
    };
  }

  const providerOrder: string[] = [];
  const providerModels = new Map<string, string[]>();
  for (const entry of filtered) {
    let list = providerModels.get(entry.provider);
    if (!list) {
      list = [];
      providerModels.set(entry.provider, list);
      providerOrder.push(entry.provider);
    }
    list.push(entry.model);
  }

  const totalModels = filtered.length;
  const lines: string[] = [
    `*Available Models* (${totalModels} across ${providerOrder.length} providers)`,
  ];

  if (trimmed) {
    lines[0] = `*Models matching "${trimmed}"* (${totalModels})`;
  }

  lines.push('');
  for (const provider of providerOrder) {
    const models = providerModels.get(provider) ?? [];
    const providerDef = getRuntimeProviderDefinitionByPiApi(provider);
    const providerLabel = providerDef ? `${providerDef.label}` : provider;
    lines.push(`*${providerLabel}* (${models.length})`);
    for (const m of models) {
      lines.push(`  \`${m}\``);
    }
    lines.push('');
  }

  lines.push(
    'Use /model to open the picker, or /model provider/name to set directly.',
  );

  const text = lines.join('\n');
  const bounded =
    text.length > 12000
      ? `${text.slice(0, 12000)}\n\n...output truncated...`
      : text;
  return { ok: true, text: bounded };
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

function loadPiModels(
  forceRefresh = false,
): { ok: true; entries: PiModelEntry[] } | { ok: false; text: string } {
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
      text: 'Model picker is unavailable because `pi` is not installed for the running service.',
    };
  }

  const result = spawnSync(piExecutable, ['--list-models'], {
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 4 * 1024 * 1024,
  });
  const entries =
    !result.error && result.status === 0
      ? parsePiModelListOutput(result.stdout || '')
      : [];
  const piFailureText = result.error
    ? `Failed to load models from ${piExecutable}: ${result.error.message}`
    : result.status !== 0
      ? (result.stderr || result.stdout || '').trim() ||
        `pi --list-models exited with code ${result.status ?? 'unknown'}`
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

function persistRuntimeConfigUpdates(
  updates: Record<string, string | undefined>,
): void {
  const envPath = getDefaultDotEnvPath(process.cwd());
  upsertDotEnv(envPath, updates);
  applyProcessEnvUpdates(updates);
  state.piModelsCache = null;
}

function setTelegramSetupInputState(
  chatJid: string,
  kind: TelegramSetupInputKind,
): void {
  telegramSetupInputStates.set(chatJid, {
    kind,
    expiresAt: Date.now() + TELEGRAM_SETUP_INPUT_TTL_MS,
  });
}

function setTelegramSetupInputProvider(
  chatJid: string,
  provider: string,
): void {
  const current = telegramSetupInputStates.get(chatJid);
  if (current) {
    current.provider = provider;
  }
}

function clearTelegramSetupInputState(chatJid: string): void {
  telegramSetupInputStates.delete(chatJid);
}

function getTelegramSetupInputState(
  chatJid: string,
): TelegramSetupInputState | null {
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
      callbackData: registerTelegramSettingsPanelAction(chatJid, {
        kind: 'show-setup-home',
      }),
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
  const totalPages = Math.max(
    1,
    Math.ceil(models.length / TELEGRAM_MODEL_PANEL_PAGE_SIZE),
  );
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const start = safePage * TELEGRAM_MODEL_PANEL_PAGE_SIZE;
  const pageModels = models.slice(
    start,
    start + TELEGRAM_MODEL_PANEL_PAGE_SIZE,
  );
  const rows: TelegramInlineKeyboard = [];
  for (let i = 0; i < pageModels.length; i += 2) {
    rows.push(
      pageModels.slice(i, i + 2).map((model) => ({
        text:
          snapshot.model === model
            ? `* ${truncateButtonLabel(model)}`
            : truncateButtonLabel(model),
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
          callbackData: registerTelegramSettingsPanelAction(chatJid, {
            kind: 'show-setup-home',
          }),
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
          callbackData: registerTelegramSettingsPanelAction(chatJid, {
            kind: 'show-setup-home',
          }),
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

async function sendTelegramCoderKeyboard(params: {
  chatJid: string;
  text: string;
  keyboard: TelegramInlineKeyboard;
  fallbackText?: string;
}): Promise<void> {
  if (
    isTelegramJid(params.chatJid) &&
    state.telegramBot?.sendMessageWithKeyboard
  ) {
    await state.telegramBot.sendMessageWithKeyboard(
      params.chatJid,
      params.text,
      params.keyboard,
    );
    return;
  }
  await sendMessage(params.chatJid, params.fallbackText || params.text);
}

function buildCoderCommand(
  command: '/coder' | '/coder-plan',
  taskText: string,
): string {
  const normalizedTask = taskText.replace(/\s+/g, ' ').trim();
  return `${command} ${normalizedTask}`.trim();
}

async function presentCoderSuggestion(params: {
  chatJid: string;
  taskText: string;
  requestId: string;
}): Promise<void> {
  await sendTelegramCoderKeyboard({
    chatJid: params.chatJid,
    text: [
      'This sounds like coding work.',
      'Recommended next step: run a coder plan first, then explicitly escalate to execute if it looks right.',
    ].join('\n'),
    fallbackText: [
      'This sounds like coding work.',
      `Reply with: ${buildCoderCommand('/coder-plan', params.taskText)}`,
      `Or execute directly with: ${buildCoderCommand('/coder', params.taskText)}`,
      'Reply with: cancel',
    ].join('\n'),
    keyboard: [
      [
        {
          text: 'Plan',
          callbackData: registerTelegramSettingsPanelAction(params.chatJid, {
            kind: 'coder-approve-plan',
            taskText: params.taskText,
          }),
        },
        {
          text: 'Execute',
          callbackData: registerTelegramSettingsPanelAction(params.chatJid, {
            kind: 'coder-approve-execute',
            taskText: params.taskText,
          }),
        },
      ],
      [
        {
          text: 'Cancel',
          callbackData: registerTelegramSettingsPanelAction(params.chatJid, {
            kind: 'coder-cancel-resume',
            taskText: params.taskText,
          }),
        },
      ],
    ],
  });
}

async function prepareCoderTarget(params: {
  chatJid: string;
  mode: 'plan' | 'execute';
  taskText: string;
  requestId: string;
}): Promise<
  | {
      status: 'ready';
      workspaceRoot: string;
      taskText: string;
      projectLabel: string;
    }
  | { status: 'handled' }
> {
  const resolved = resolveCoderProjectTarget({
    mainWorkspaceDir: MAIN_WORKSPACE_DIR,
    taskText: params.taskText,
  });

  if (resolved.status === 'resolved') {
    if (params.mode === 'execute' && !resolved.isGitRepo) {
      await sendTelegramCoderKeyboard({
        chatJid: params.chatJid,
        text: [
          `${resolved.projectLabel} is not a git-backed project, so execute mode cannot create an isolated worktree there.`,
          'Run a coder plan first or initialize git for that project.',
        ].join('\n'),
        fallbackText: [
          `${resolved.projectLabel} is not a git-backed project, so execute mode cannot create an isolated worktree there.`,
          `Reply with: ${buildCoderCommand('/coder-plan', `project:${resolved.projectLabel} ${resolved.taskText}`)}`,
          'Or initialize git for that project and retry execute mode.',
        ].join('\n'),
        keyboard: [
          [
            {
              text: 'Start Plan Instead',
              callbackData: registerTelegramSettingsPanelAction(
                params.chatJid,
                {
                  kind: 'coder-select-project',
                  mode: 'plan',
                  taskText: resolved.taskText,
                  projectPath: resolved.workspaceRoot,
                  projectLabel: resolved.projectLabel,
                  isGitRepo: resolved.isGitRepo,
                },
              ),
            },
            {
              text: 'Cancel',
              callbackData: registerTelegramSettingsPanelAction(
                params.chatJid,
                {
                  kind: 'coder-cancel',
                },
              ),
            },
          ],
        ],
      });
      return { status: 'handled' };
    }
    return {
      status: 'ready',
      workspaceRoot: resolved.workspaceRoot,
      taskText: resolved.taskText,
      projectLabel: resolved.projectLabel,
    };
  }

  if (resolved.status === 'ambiguous') {
    await sendTelegramCoderKeyboard({
      chatJid: params.chatJid,
      text: 'I found multiple likely projects. Pick the right one before coder continues.',
      fallbackText: [
        'I found multiple likely projects. Re-run your request with one of these project selectors:',
        ...resolved.candidates.map(
          (candidate) =>
            `${buildCoderCommand(
              params.mode === 'plan' ? '/coder-plan' : '/coder',
              `project:${candidate.projectLabel} ${resolved.taskText}`,
            )}`,
        ),
        'Reply with: cancel',
      ].join('\n'),
      keyboard: [
        ...resolved.candidates.map((candidate) => [
          {
            text: truncateButtonLabel(candidate.projectLabel),
            callbackData: registerTelegramSettingsPanelAction(params.chatJid, {
              kind: 'coder-select-project',
              mode: params.mode,
              taskText: resolved.taskText,
              projectPath: candidate.workspaceRoot,
              projectLabel: candidate.projectLabel,
              isGitRepo: candidate.isGitRepo,
            }),
          },
        ]),
        [
          {
            text: 'Cancel',
            callbackData: registerTelegramSettingsPanelAction(params.chatJid, {
              kind: 'coder-cancel',
            }),
          },
        ],
      ],
    });
    return { status: 'handled' };
  }

  if (resolved.projectHint && resolved.suggestedSlug) {
    await sendTelegramCoderKeyboard({
      chatJid: params.chatJid,
      text: [
        `I could not find a project matching "${resolved.projectHint}".`,
        'If that project does not exist yet, you can create it now.',
      ].join('\n'),
      fallbackText: [
        `I could not find a project matching "${resolved.projectHint}".`,
        `Reply with: /coder-create-project ${resolved.suggestedSlug} ${resolved.taskText}`.trim(),
        'That will create the project and start a coder plan there.',
        'Or reply with: cancel',
      ].join('\n'),
      keyboard: [
        [
          {
            text: `Create ${truncateButtonLabel(resolved.suggestedSlug)}`,
            callbackData: registerTelegramSettingsPanelAction(params.chatJid, {
              kind: 'coder-create-project',
              mode: params.mode,
              taskText: resolved.taskText,
              slug: resolved.suggestedSlug,
              projectLabel: resolved.projectHint,
            }),
          },
          {
            text: 'Cancel',
            callbackData: registerTelegramSettingsPanelAction(params.chatJid, {
              kind: 'coder-cancel',
            }),
          },
        ],
      ],
    });
  } else {
    await sendMessage(
      params.chatJid,
      'I could not map that request to a project. Re-run it with `project:<name>` so I can target the right workspace.',
    );
  }
  return { status: 'handled' };
}

async function createCoderProject(params: { slug: string }): Promise<{
  workspaceRoot: string;
  projectLabel: string;
  isGitRepo: boolean;
}> {
  const workspaceRoot = resolveCoderProjectWorkspace({
    mainWorkspaceDir: MAIN_WORKSPACE_DIR,
    slug: params.slug,
  });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  return {
    workspaceRoot,
    projectLabel: params.slug,
    isGitRepo: false,
  };
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
    `Delivery: ${prefs.telegramDeliveryMode || 'partial'}`,
    `Tool progress: ${getEffectiveVerboseMode(prefs.verboseMode)}`,
    `Next fresh run: ${prefs.nextRunNoContinue ? 'yes' : 'no'}`,
  ];
}

function buildTelegramSettingsHomePanel(chatJid: string): {
  text: string;
  keyboard: TelegramInlineKeyboard;
} {
  return {
    text: [
      'Runtime controls for this chat:',
      ...formatTelegramSettingsPanelSummary(chatJid),
    ].join('\n'),
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
          callbackData: registerTelegramSettingsPanelAction(chatJid, {
            kind: 'show-think',
          }),
        },
      ],
      [
        {
          text: 'Queue',
          callbackData: registerTelegramSettingsPanelAction(chatJid, {
            kind: 'show-queue',
          }),
        },
        {
          text: 'Delivery',
          callbackData: registerTelegramSettingsPanelAction(chatJid, {
            kind: 'show-delivery',
          }),
        },
      ],
      [
        {
          text: 'Fresh Next Run',
          callbackData: registerTelegramSettingsPanelAction(chatJid, {
            kind: 'trigger-new',
          }),
        },
        {
          text: 'Reasoning',
          callbackData: registerTelegramSettingsPanelAction(chatJid, {
            kind: 'show-reasoning',
          }),
        },
        {
          text: 'Verbose',
          callbackData: registerTelegramSettingsPanelAction(chatJid, {
            kind: 'show-verbose',
          }),
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
      keyboard: [
        [
          {
            text: 'Back',
            callbackData: registerTelegramSettingsPanelAction(chatJid, {
              kind: 'show-home',
            }),
          },
        ],
      ],
    };
  }

  const providerCounts = new Map<string, number>();
  for (const entry of loaded.entries) {
    providerCounts.set(
      entry.provider,
      (providerCounts.get(entry.provider) || 0) + 1,
    );
  }
  const providers = Array.from(providerCounts.entries()).sort((a, b) =>
    a[0].localeCompare(b[0]),
  );
  const rows: TelegramInlineKeyboard = [];
  for (let i = 0; i < providers.length; i += 2) {
    const slice = providers.slice(i, i + 2);
    rows.push(
      slice.map(([provider, count]) => {
        const providerDef = getRuntimeProviderDefinitionByPiApi(provider);
        const label = providerDef ? providerDef.label : provider;
        return {
          text: `${label} (${count})`,
          callbackData: registerTelegramSettingsPanelAction(chatJid, {
            kind: 'show-models-for-provider',
            provider,
            page: 0,
          }),
        };
      }),
    );
  }
  rows.push([
    {
      text: 'Home',
      callbackData: registerTelegramSettingsPanelAction(chatJid, {
        kind: 'show-home',
      }),
    },
  ]);
  return {
    text: [
      'Select a provider:',
      ...formatTelegramSettingsPanelSummary(chatJid),
    ].join('\n'),
    keyboard: rows,
  };
}

function buildAddModelForProviderPanel(
  chatJid: string,
  provider: string,
): {
  text: string;
  keyboard: TelegramInlineKeyboard;
} {
  const providerDef = getRuntimeProviderDefinitionByPiApi(provider);
  const providerLabel = providerDef ? providerDef.label : provider;
  return {
    text: [
      `Add a model to ${providerLabel}:`,
      '',
      'Tap "Type Model Name" below, then type the model id.',
      'Or use /model directly: /model provider/model-name',
      '',
      'The model will be set as your per-chat override.',
      'The model must already exist in your pi runtime.',
    ].join('\n'),
    keyboard: [
      [
        {
          text: 'Type Model Name',
          callbackData: registerTelegramSettingsPanelAction(chatJid, {
            kind: 'prompt-add-model-for-provider',
            provider,
          }),
        },
      ],
      [
        {
          text: 'Providers',
          callbackData: registerTelegramSettingsPanelAction(chatJid, {
            kind: 'show-model-providers',
          }),
        },
        {
          text: 'Home',
          callbackData: registerTelegramSettingsPanelAction(chatJid, {
            kind: 'show-home',
          }),
        },
      ],
    ],
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
      keyboard: [
        [
          {
            text: 'Back',
            callbackData: registerTelegramSettingsPanelAction(chatJid, {
              kind: 'show-home',
            }),
          },
        ],
      ],
    };
  }
  const models = loaded.entries
    .filter((entry) => entry.provider === provider)
    .map((entry) => entry.model)
    .sort((a, b) => a.localeCompare(b));

  const totalPages = Math.max(
    1,
    Math.ceil(models.length / TELEGRAM_MODEL_PANEL_PAGE_SIZE),
  );
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const start = safePage * TELEGRAM_MODEL_PANEL_PAGE_SIZE;
  const pageModels = models.slice(
    start,
    start + TELEGRAM_MODEL_PANEL_PAGE_SIZE,
  );
  const current = getEffectiveModelLabel(chatJid);

  const rows: TelegramInlineKeyboard = [];
  for (let i = 0; i < pageModels.length; i += 2) {
    rows.push(
      pageModels.slice(i, i + 2).map((model) => {
        const full = `${provider}/${model}`;
        const selected = current === full;
        return {
          text: selected
            ? `* ${truncateButtonLabel(model)}`
            : truncateButtonLabel(model),
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
      text: '+ Add Model',
      callbackData: registerTelegramSettingsPanelAction(chatJid, {
        kind: 'show-add-model-for-provider',
        provider,
      }),
    },
  ]);
  rows.push([
    {
      text: 'Providers',
      callbackData: registerTelegramSettingsPanelAction(chatJid, {
        kind: 'show-model-providers',
      }),
    },
    {
      text: 'Home',
      callbackData: registerTelegramSettingsPanelAction(chatJid, {
        kind: 'show-home',
      }),
    },
  ]);

  const providerDef = getRuntimeProviderDefinitionByPiApi(provider);
  const providerLabel = providerDef ? providerDef.label : provider;
  return {
    text: [
      `Select a model from ${providerLabel}:`,
      `Current: ${current}`,
      `Page ${safePage + 1} of ${totalPages}`,
    ].join('\n'),
    keyboard: rows,
  };
}

function buildThinkPanel(chatJid: string): {
  text: string;
  keyboard: TelegramInlineKeyboard;
} {
  const current = state.chatRunPreferences[chatJid]?.thinkLevel || 'off';
  const levels: ThinkLevel[] = [
    'off',
    'minimal',
    'low',
    'medium',
    'high',
    'xhigh',
  ];
  const rows: TelegramInlineKeyboard = [];
  for (let i = 0; i < levels.length; i += 2) {
    rows.push(
      levels.slice(i, i + 2).map((value) => ({
        text: value === current ? `* ${value}` : value,
        callbackData: registerTelegramSettingsPanelAction(chatJid, {
          kind: 'set-think',
          value,
        }),
      })),
    );
  }
  rows.push([
    {
      text: 'Home',
      callbackData: registerTelegramSettingsPanelAction(chatJid, {
        kind: 'show-home',
      }),
    },
  ]);
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
      [
        {
          text: 'Home',
          callbackData: registerTelegramSettingsPanelAction(chatJid, {
            kind: 'show-home',
          }),
        },
      ],
    ],
  };
}

function buildDeliveryPanel(chatJid: string): {
  text: string;
  keyboard: TelegramInlineKeyboard;
} {
  const current =
    state.chatRunPreferences[chatJid]?.telegramDeliveryMode || 'partial';
  const modes: TelegramDeliveryMode[] = ['partial', 'draft', 'off'];
  return {
    text: [
      'Select Telegram text delivery mode:',
      `Current: ${current}`,
      '',
      'partial: one in-flight message may be edited during the run',
      'draft: Telegram-native draft stream in all chats',
      'off: no visible preview, send only the completed final answer',
    ].join('\n'),
    keyboard: [
      modes.map((value) => ({
        text: value === current ? `* ${value}` : value,
        callbackData: registerTelegramSettingsPanelAction(chatJid, {
          kind: 'set-delivery',
          value,
        }),
      })),
      [
        {
          text: 'Home',
          callbackData: registerTelegramSettingsPanelAction(chatJid, {
            kind: 'show-home',
          }),
        },
      ],
    ],
  };
}

function buildVerbosePanel(chatJid: string): {
  text: string;
  keyboard: TelegramInlineKeyboard;
} {
  const current = getEffectiveVerboseMode(
    state.chatRunPreferences[chatJid]?.verboseMode,
  );
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
      callbackData: registerTelegramSettingsPanelAction(chatJid, {
        kind: 'show-home',
      }),
    },
  ]);
  return {
    text: [
      'Select tool progress mode:',
      `Current: ${current}`,
      'off = final only',
      'new = minimal updates (emoji reactions)',
      'all = concise separate progress message',
      'verbose = detailed separate progress message',
    ].join('\n'),
    keyboard: rows,
  };
}

function buildQueuePanel(chatJid: string): {
  text: string;
  keyboard: TelegramInlineKeyboard;
} {
  const prefs = state.chatRunPreferences[chatJid] || {};
  const current = prefs.queueMode || 'collect';
  const modes: QueueMode[] = [
    'collect',
    'followup',
    'interrupt',
    'steer',
    'steer-backlog',
  ];
  const rows: TelegramInlineKeyboard = [];
  for (let i = 0; i < modes.length; i += 2) {
    rows.push(
      modes.slice(i, i + 2).map((value) => ({
        text:
          value === current
            ? `* ${truncateButtonLabel(value, 24)}`
            : truncateButtonLabel(value, 24),
        callbackData: registerTelegramSettingsPanelAction(chatJid, {
          kind: 'set-queue-mode',
          value,
        }),
      })),
    );
  }
  rows.push([
    {
      text: 'Home',
      callbackData: registerTelegramSettingsPanelAction(chatJid, {
        kind: 'show-home',
      }),
    },
  ]);
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

function buildSubagentsPanel(chatJid: string): {
  text: string;
  keyboard: TelegramInlineKeyboard;
} {
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
          callbackData: registerTelegramSettingsPanelAction(chatJid, {
            kind: 'show-subagents',
          }),
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
          callbackData: registerTelegramSettingsPanelAction(chatJid, {
            kind: 'show-home',
          }),
        },
      ],
    ],
  };
}

function runGatewayServiceCommand(action: 'status' | 'restart' | 'doctor'): {
  ok: boolean;
  text: string;
} {
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
      output.length > 12000
        ? `${output.slice(0, 12000)}\n\n...output truncated...`
        : output;
    if (result.status !== 0 && result.status !== 1) {
      return {
        ok: false,
        text:
          bounded ||
          `Doctor command failed with exit code ${result.status ?? 'unknown'}.`,
      };
    }
    const warn = result.status === 1;
    return {
      ok: true,
      text:
        bounded ||
        (warn
          ? 'Doctor completed with warnings.'
          : 'Doctor command completed.'),
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
    const needsPrivileges =
      /root privileges|sudo|permission denied|operation not permitted|bootstrap failed|input\/output error/i.test(
        bounded,
      );
    const guidance = needsPrivileges
      ? '\n\nThis action likely needs interactive host privileges. Run ./scripts/service.sh <action> (or fft service <action>) directly in a shell with required permissions.'
      : '';
    return {
      ok: false,
      text: bounded
        ? `${bounded}${guidance}`
        : `Gateway service command failed with exit code ${result.status ?? 'unknown'}.${guidance}`,
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
  const chatActiveRun = chatJid ? activeChatRuns.get(chatJid) || null : null;
  return formatStatusReport({
    assistantName: ASSISTANT_NAME,
    runtime,
    serviceStartedAt: SERVICE_STARTED_AT,
    incidentWindowLabel: STATUS_INCIDENT_WINDOW_LABEL,
    stuckWarningSeconds: STATUS_STUCK_WARNING_SECONDS,
    telegramEnabled: Boolean(TELEGRAM_BOT_TOKEN),
    whatsappEnabled: WHATSAPP_ENABLED,
    whatsappConnected: Boolean(state.sock?.user),
    registeredGroupCount: Object.keys(state.registeredGroups).length,
    mainGroupName: mainGroup?.name,
    tasks: {
      active,
      paused,
      completed,
    },
    activeChatRuns: Array.from(activeChatRunsById.values()).map((run) => ({
      requestId: run.requestId,
      chatJid: run.chatJid,
      startedAt: run.startedAt,
    })),
    activeCoderRuns: Array.from(activeCoderRuns.values()).map((run) => ({
      requestId: run.requestId,
      mode: run.mode,
      chatJid: run.chatJid,
      groupName: run.groupName,
      startedAt: run.startedAt,
      parentRequestId: run.parentRequestId,
      backend: run.backend,
      route: run.route,
      state: run.state,
      worktreePath: run.worktreePath,
    })),
    telemetry: statusTelemetry.getSnapshot(),
    ...(chatJid
      ? {
          chatRuntimePreferenceLines: formatChatRuntimePreferences(chatJid),
          chatUsage: state.chatUsageStats[chatJid]
            ? {
                runs: state.chatUsageStats[chatJid].runs,
                totalTokens: state.chatUsageStats[chatJid].totalTokens,
              }
            : undefined,
          chatActiveRun: chatActiveRun
            ? {
                requestId: chatActiveRun.requestId,
                startedAt: chatActiveRun.startedAt,
              }
            : null,
        }
      : {}),
  });
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
  return [`Task runs for ${taskId} (latest ${safeLimit}):`, ...lines].join(
    '\n',
  );
}

function formatTasksText(mode: 'list' | 'due' = 'list'): string {
  const tasks = mode === 'due' ? getDueTasks() : getAllTasks();
  if (tasks.length === 0) {
    return mode === 'due'
      ? 'No due tasks right now.'
      : 'No scheduled tasks found.';
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
      return buildTelegramProviderModelPanel(
        chatJid,
        action.provider,
        action.page,
      );
    case 'show-think':
      return buildThinkPanel(chatJid);
    case 'show-reasoning':
      return buildReasoningPanel(chatJid);
    case 'show-delivery':
      return buildDeliveryPanel(chatJid);
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
    case 'show-add-model-for-provider':
      return buildAddModelForProviderPanel(chatJid, action.provider);
    case 'prompt-add-model-for-provider':
      return buildAddModelForProviderPanel(chatJid, action.provider);
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
  await state.telegramBot.sendMessageWithKeyboard(
    chatJid,
    panel.text,
    panel.keyboard,
  );
}

async function editTelegramSettingsPanel(
  chatJid: string,
  messageId: number,
  action: TelegramSettingsPanelAction,
): Promise<void> {
  if (!state.telegramBot) return;
  const panel = resolveTelegramSettingsPanel(chatJid, action);
  await state.telegramBot.editMessageWithKeyboard(
    chatJid,
    messageId,
    panel.text,
    panel.keyboard,
  );
}

async function promptTelegramSetupInput(
  chatJid: string,
  kind: TelegramSetupInputKind,
  prompt: string,
): Promise<void> {
  clearTelegramSetupInputState(chatJid);
  setTelegramSetupInputState(chatJid, kind);
  await sendMessage(
    chatJid,
    `${prompt}\n\nNext plain-text message will be captured. Send /setup cancel to abort.`,
  );
}

function formatActiveSubagentsText(): string {
  const runs: string[] = [];
  const now = Date.now();
  for (const run of Array.from(activeCoderRuns.values()).sort(
    (a, b) => a.startedAt - b.startedAt,
  )) {
    const age = Math.max(0, Math.floor((now - run.startedAt) / 1000));
    runs.push(
      `- request=${run.requestId} mode=${run.mode} state=${run.state || 'running'} backend=${run.backend || 'pi'} age=${age}s chat=${run.chatJid}${run.parentRequestId ? ` parent=${run.parentRequestId}` : ''}${run.worktreePath ? ` worktree=${run.worktreePath}` : ''}`,
    );
  }
  if (runs.length === 0) return 'No active subagent runs.';
  return ['Active subagent runs:', ...runs].join('\n');
}

let codingOrchestrator: ReturnType<typeof createCodingOrchestrator> | null =
  null;

function getCodingOrchestrator(): ReturnType<typeof createCodingOrchestrator> {
  if (!codingOrchestrator) {
    codingOrchestrator = createCodingOrchestrator({
      activeRuns: activeCoderRuns,
      runContainerAgent: (
        group,
        input,
        abortSignal,
        onRuntimeEvent,
        onExtensionUIRequest,
        onProgressEvent,
      ) =>
        runContainerAgent(
          group,
          input,
          abortSignal,
          onRuntimeEvent,
          onExtensionUIRequest ||
            ((request) => handlePermissionGateRequest(input.chatJid, request)),
          onProgressEvent,
        ),
      publishEvent: (event) => {
        hostEventBus.publish(event);
      },
    });
  }
  return codingOrchestrator;
}

async function runCodingTask(
  params: Omit<CodingWorkerRequest, 'workspaceRoot'> & {
    workspaceRoot?: string;
  },
) {
  const workspaceRoot =
    params.workspaceRoot ||
    (params.group.folder === MAIN_GROUP_FOLDER
      ? MAIN_WORKSPACE_DIR
      : resolveGroupFolderPath(params.group.folder));
  return getCodingOrchestrator().runTask({
    ...params,
    workspaceRoot,
  });
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
  const prefs: ChatRunPreferences = {
    ...(state.chatRunPreferences[chatJid] || {}),
  };
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

  const prefs: ChatRunPreferences = {
    ...(state.chatRunPreferences[chatJid] || {}),
  };
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

    const preview =
      summary.length > 1200
        ? `${summary.slice(0, 1200)}\n\n...truncated...`
        : summary;
    return [
      `Compaction complete (${compactRequestId}).`,
      `Saved summary to /workspace/group/${resolveCompactionMemoryRelativePath(ts)} and scheduled fresh next session.`,
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
    const downloaded = await state.telegramBot.downloadFile(
      message.media.fileId,
    );
    if (downloaded.data.length > TELEGRAM_MEDIA_MAX_BYTES) {
      const mb = (downloaded.data.length / (1024 * 1024)).toFixed(1);
      const maxMb = TELEGRAM_MEDIA_MAX_MB.toFixed(0);
      await sendMessage(
        message.chatJid,
        `Attachment rejected (${mb} MB). Max allowed is ${maxMb} MB.`,
      );
      logger.warn(
        {
          chatJid: message.chatJid,
          type: message.media.type,
          size: downloaded.data.length,
        },
        'Telegram media rejected by downloaded size',
      );
      return `${message.content}\n[Attachment rejected: size exceeds limit]`;
    }

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
    const storagePaths = buildTelegramMediaStoragePaths({
      groupFolder: group.folder,
      mainGroupFolder: MAIN_GROUP_FOLDER,
      mainWorkspaceDir: MAIN_WORKSPACE_DIR,
      groupsDir: GROUPS_DIR,
      fileName,
    });
    fs.mkdirSync(storagePaths.inboxDir, { recursive: true });
    const hostPath = storagePaths.hostPath;
    fs.writeFileSync(hostPath, downloaded.data);
    logger.info(
      {
        chatJid: message.chatJid,
        type: message.media.type,
        size: downloaded.data.length,
        promptPath: storagePaths.promptPath,
      },
      'Telegram media stored',
    );

    return [
      message.content,
      `[Attachment type=${message.media.type} path=${storagePaths.promptPath} size=${downloaded.data.length}]`,
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
    const mainChatId = mainTelegramJid
      ? parseTelegramChatId(mainTelegramJid)
      : null;

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

    if (
      state.lastTelegramMenuMainChatId &&
      state.lastTelegramMenuMainChatId !== mainChatId
    ) {
      try {
        await state.telegramBot.setCommands(common, {
          type: 'chat',
          chatId: state.lastTelegramMenuMainChatId,
        });
      } catch (err) {
        logger.debug(
          { err },
          'Failed resetting previous main Telegram command scope',
        );
      }
    }

    if (mainChatId) {
      try {
        await state.telegramBot.setCommands(admin, {
          type: 'chat',
          chatId: mainChatId,
        });
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
  logger.info({ chatJid, command, allowed, reason }, 'Telegram command audit');
}

const telegramCommandHandlers = createTelegramCommandHandlers({
  state,
  constants: {
    assistantName: ASSISTANT_NAME,
    mainGroupFolder: MAIN_GROUP_FOLDER,
    telegramAdminSecret: TELEGRAM_ADMIN_SECRET,
    telegramSettingsPanelPrefix: TELEGRAM_SETTINGS_PANEL_PREFIX,
    runtimeProviderPresetEnv: RUNTIME_PROVIDER_PRESET_ENV,
  },
  activeChatRuns,
  activeChatRunsById,
  activeCoderRuns,
  sendMessage,
  sendTelegramSettingsPanel,
  editTelegramSettingsPanel,
  promptTelegramSetupInput,
  clearTelegramSetupInputState,
  setTelegramSetupInputProvider,
  getTelegramSetupInputState,
  getTelegramSettingsPanelAction,
  updateChatRunPreferences,
  isMainChat,
  formatTasksText,
  formatGroupsText,
  formatStatusText,
  formatHelpText,
  formatUsageText,
  formatActiveSubagentsText,
  summarizeTask,
  formatTaskRunsText,
  runPiListModels,
  normalizeThinkLevel,
  normalizeReasoningLevel,
  normalizeTelegramDeliveryMode,
  parseQueueArgs,
  parseVerboseDirective,
  describeVerboseMode,
  getEffectiveVerboseMode,
  getEffectiveModelLabel,
  resolveMainOnboardingGate,
  onboardingCommandBlockedText,
  runCompactionForChat,
  parseTelegramChatId,
  parseTelegramTargetJid,
  normalizeTelegramCommandToken,
  promoteChatToMain,
  refreshTelegramCommandMenus,
  hasMainGroup,
  runGatewayServiceCommand,
  buildRuntimeProviderPresetUpdates,
  getRuntimeConfigEnv,
  persistRuntimeConfigUpdates,
  resolveRuntimeConfigSnapshot,
  registerTelegramSettingsPanelAction,
  buildAdminPanelKeyboard,
  getTaskById,
  updateTask,
  deleteTask,
  emitTuiChatEvent,
  emitTuiAgentEvent,
  getSessionKeyForChat,
  runAgent,
  runCodingTask,
  prepareCoderTarget,
  createCoderProject,
  setTyping,
  persistAssistantHistory,
  sendAgentResultMessage,
  updateChatUsage,
  logTelegramCommandAudit,
  whatsappEnabled: WHATSAPP_ENABLED,
  hasWhatsAppSocket: () => !!state.sock,
  syncGroupMetadata,
  saveState,
  resumeDirectSessionTurn: (chatJid, text, deliver) =>
    messageDispatcher.runDirectSessionTurn({
      chatJid,
      text,
      runId: `resume-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      deliver,
    }),
});

async function handleTelegramCallbackQuery(
  q: TelegramInboundCallbackQuery,
): Promise<void> {
  const pgRequestId = parsePermissionGateCallback(q.data);
  if (pgRequestId) {
    const confirmed = q.data.startsWith('pg_allow:');
    resolvePendingConfirmation(pgRequestId, { confirmed });
    const bot = state.telegramBot;
    if (bot) {
      try {
        await bot.answerCallbackQuery?.(q.id);
      } catch {
        // Ignore duplicate callback acknowledgements.
      }
      try {
        await bot.editMessageWithKeyboard(
          q.chatJid,
          q.messageId,
          `${confirmed ? '✅ Allowed' : '❌ Blocked'}`,
          [],
        );
      } catch {
        // Message may have been deleted already.
      }
    }
    return;
  }

  await telegramCommandHandlers.handleTelegramCallbackQuery(q);
}

async function handlePermissionGateRequest(
  chatJid: string,
  request: ExtensionUIRequest,
): Promise<ExtensionUIResponse> {
  const timeoutMs = request.timeout ?? 60_000;

  if (
    shouldPromptPermissionGate(request) &&
    isTelegramJid(chatJid) &&
    state.telegramBot
  ) {
    const { promise } = createPendingConfirmation(
      request.id,
      chatJid,
      timeoutMs,
    );
    await state.telegramBot.sendMessageWithKeyboard(
      chatJid,
      `⚠️ *Permission Required*\n\n${request.title ?? 'Action'}\n${request.message ?? ''}\n\n_Reply within ${Math.round(timeoutMs / 1000)}s or it will be auto-denied._`,
      [
        [
          { text: '✅ Allow', callbackData: `pg_allow:${request.id}` },
          { text: '❌ Block', callbackData: `pg_block:${request.id}` },
        ],
      ],
    );
    return promise;
  }

  logger.warn(
    { requestId: request.id, method: request.method, chatJid },
    'Permission gate: no UI available, auto-denying',
  );
  if (request.method === 'confirm') {
    return { confirmed: false };
  }
  return { cancelled: true };
}

async function handleTelegramSetupInput(m: {
  chatJid: string;
  content: string;
}): Promise<boolean> {
  return telegramCommandHandlers.handleTelegramSetupInput(m);
}

async function handleTelegramCommand(m: {
  chatJid: string;
  chatName: string;
  content: string;
}): Promise<boolean> {
  return telegramCommandHandlers.handleTelegramCommand(m);
}

const messageDispatcher = createMessageDispatcher({
  state,
  constants: {
    assistantName: ASSISTANT_NAME,
    mainGroupFolder: MAIN_GROUP_FOLDER,
    triggerPattern: TRIGGER_PATTERN,
    tuiSenderName: TUI_SENDER_NAME,
    mainWorkspaceDir: MAIN_WORKSPACE_DIR,
  },
  activeChatRuns,
  activeChatRunsById,
  activeCoderRuns,
  tuiMessageQueue,
  sendMessage,
  setTyping,
  getMessagesSince,
  getRecentConversation: getPromptTranscriptMessages,
  getSessionKeyForChat,
  resolveMainOnboardingGate,
  buildOnboardingInterviewPrompt,
  extractOnboardingCompletion,
  completeMainWorkspaceOnboarding,
  rememberHeartbeatTarget,
  runAgent,
  runCodingTask,
  consumeNextRunNoContinue,
  updateChatUsage,
  persistAssistantHistory,
  deleteTelegramPreviewMessage,
  finalizeTelegramPreviewMessage,
  sendAgentResultMessage,
  emitTuiChatEvent,
  emitTuiAgentEvent,
  isTelegramJid,
  prepareTelegramCompletionState,
  consumeTelegramHostCompletedRun,
  consumeTelegramHostStreamState,
  resolveTelegramStreamCompletionState,
  finalizeCompletedRun,
  parseDelegationTrigger,
  isSubstantialCodingTask,
  presentCoderSuggestion,
  prepareCoderTarget,
  createCoderProject,
  isCoderDelegationCommand,
  onboardingCommandBlockedText,
  makeRunId,
  logger,
  persistTuiUserHistory,
  writePromptInputLog: (entry: PromptInputLogEntry) => {
    try {
      writePromptInputLogFile(entry);
    } catch (err) {
      logger.warn(
        {
          err,
          groupFolder: entry.groupFolder,
          requestId: entry.requestId,
        },
        'Failed to write prompt input log',
      );
    }
  },
});

const appRuntime = createAppRuntime({
  state,
  constants: {
    telegramBotToken: TELEGRAM_BOT_TOKEN,
    telegramApiBaseUrl: TELEGRAM_API_BASE_URL,
    assistantName: ASSISTANT_NAME,
    triggerPattern: TRIGGER_PATTERN,
    storeDir: STORE_DIR,
    groupSyncIntervalMs: GROUP_SYNC_INTERVAL_MS,
    pollInterval: POLL_INTERVAL,
    heartbeatActiveHoursRaw: HEARTBEAT_ACTIVE_HOURS_RAW,
    heartbeatActiveHours: HEARTBEAT_ACTIVE_HOURS,
    dataDir: DATA_DIR,
    fftProfile: FFT_PROFILE,
    featureFarm: FEATURE_FARM,
    farmStateEnabled: FARM_STATE_ENABLED,
    profileDetection: PROFILE_DETECTION,
    whatsappEnabled: WHATSAPP_ENABLED,
    mainWorkspaceDir: MAIN_WORKSPACE_DIR,
  },
  createTelegramBot,
  refreshTelegramCommandMenus,
  handleTelegramCallbackQuery,
  handleTelegramSetupInput,
  handleTelegramCommand,
  storeChatMetadata,
  maybeRegisterTelegramChat,
  isMainChat,
  persistTelegramMedia,
  storeTextMessage,
  logger,
  useMultiFileAuthState,
  makeWASocket,
  makeCacheableSignalKeyStore,
  browsers: Browsers,
  disconnectReason: DisconnectReason,
  sendMessage,
  maybeRegisterWhatsAppMainChat,
  syncGroupMetadata,
  startSchedulerLoop,
  startIpcWatcher,
  startMessageLoop: () => appRuntime.startMessageLoop(),
  requestHeartbeatNow,
  storeMessage,
  translateJid,
  processMessage: (msg) => messageDispatcher.processMessage(msg),
  getNewMessages,
  lastTimestamp: () => state.lastTimestamp,
  setLastTimestamp: (value) => {
    state.lastTimestamp = value;
  },
  saveState,
  isWithinHeartbeatActiveHoursInvalid: !!(
    HEARTBEAT_ACTIVE_HOURS_RAW?.trim() && !HEARTBEAT_ACTIVE_HOURS
  ),
  acquireSingletonLock,
  ensureContainerSystemRunning: () => appRuntime.ensureContainerSystemRunning(),
  initDatabase,
  loadState,
  migrateLegacyClaudeMemoryFiles,
  migrateCompactionSummariesFromSoul,
  maybePromoteConfiguredTelegramMain,
  startTuiGatewayService,
  startWebControlCenterService,
  stopTuiGatewayService,
  stopWebControlCenterService,
  startFarmStateCollector,
  stopFarmStateCollector,
  startHeartbeatLoop,
  maybeRunBootMdOnce,
  getContainerRuntime,
});

async function startTelegram(): Promise<void> {
  await appRuntime.startTelegram();
}

async function processMessage(msg: NewMessage): Promise<boolean> {
  return messageDispatcher.processMessage(msg);
}

async function runDirectSessionTurn(params: {
  chatJid: string;
  text: string;
  runId: string;
  deliver: boolean;
}): Promise<{
  runId: string;
  status: 'started' | 'queued' | 'already_running';
}> {
  return messageDispatcher.runDirectSessionTurn(params);
}

async function runAgent(
  group: RegisteredGroup,
  prompt: string,
  chatJid: string,
  codingHint: CodingHint = 'none',
  requestId?: string,
  runtimePrefs: ChatRunPreferences = {},
  options: { suppressErrorReply?: boolean; isHeartbeatTask?: boolean } = {},
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
            telegram_delivery_mode:
              runtimePrefs.telegramDeliveryMode || 'partial',
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
      isHeartbeatTask: options.isHeartbeatTask === true,
      extraSystemPrompt,
      provider: runtimePrefs.provider,
      model: runtimePrefs.model,
      thinkLevel: runtimePrefs.thinkLevel,
      reasoningLevel: runtimePrefs.reasoningLevel,
      verboseMode: runtimePrefs.verboseMode,
      noContinue: runtimePrefs.nextRunNoContinue === true,
      suppressPreviewStreaming: runtimePrefs.telegramDeliveryMode === 'off',
      showReasoning:
        runtimePrefs.showReasoning === true ||
        runtimePrefs.reasoningLevel === 'stream',
    };

    const sessionKey = getSessionKeyForChat(chatJid);
    const executeRun = async (
      runPrefs: ChatRunPreferences,
    ): Promise<{
      status: 'success' | 'error';
      result: string | null;
      error?: string;
      streamed?: boolean;
      hadToolSideEffects?: boolean;
      usage?: {
        inputTokens?: number;
        outputTokens?: number;
        totalTokens?: number;
        provider?: string;
        model?: string;
      };
    }> => {
      let hadToolSideEffects = false;
      const output = await runContainerAgent(
        group,
        {
          ...input,
          verboseMode: runPrefs.verboseMode,
          noContinue: runPrefs.nextRunNoContinue === true,
        },
        abortSignal,
        (event) => {
          if (event.kind !== 'tool' || !requestId) return;
          hadToolSideEffects = true;
          if (isTelegramJid(chatJid)) {
            queueTelegramToolProgressUpdate(
              chatJid,
              requestId,
              runPrefs.telegramDeliveryMode || 'partial',
              runPrefs.verboseMode,
              {
                toolName: event.toolName,
                status: event.status,
                ...(event.args ? { args: event.args } : {}),
                ...(event.output ? { output: event.output } : {}),
                ...(event.error ? { error: event.error } : {}),
              },
            );
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
        (request) => handlePermissionGateRequest(chatJid, request),
      );
      return {
        ...output,
        hadToolSideEffects,
      };
    };

    let output = await executeRun(runtimePrefs);

    if (output.status === 'error') {
      if (
        requestId &&
        typeof output.error === 'string' &&
        output.error.trim() &&
        !isUserAbortedErrorMessage(output.error)
      ) {
        statusTelemetry.noteRuntimeError({
          runId: requestId,
          chatJid,
          errorMessage: output.error,
        });
      }
      if (isUserAbortedErrorMessage(output.error)) {
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
        hadToolSideEffects: output.hadToolSideEffects,
        usage: output.usage,
      },
      retryRun: async () => {
        const retryOutput = await executeRun({
          ...runtimePrefs,
          nextRunNoContinue: true,
        });
        if (retryOutput.status === 'error') {
          if (
            requestId &&
            typeof retryOutput.error === 'string' &&
            retryOutput.error.trim() &&
            !isUserAbortedErrorMessage(retryOutput.error)
          ) {
            statusTelemetry.noteRuntimeError({
              runId: requestId,
              chatJid,
              errorMessage: retryOutput.error,
            });
          }
          if (isUserAbortedErrorMessage(retryOutput.error)) {
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
            hadToolSideEffects: retryOutput.hadToolSideEffects,
          };
        }
        return {
          result: retryOutput.result,
          streamed: !!retryOutput.streamed,
          ok: true,
          hadToolSideEffects: retryOutput.hadToolSideEffects,
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
    if (requestId) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      if (!isUserAbortedErrorMessage(errorMessage)) {
        statusTelemetry.noteRuntimeError({
          runId: requestId,
          chatJid,
          errorMessage,
        });
      }
    }
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
    resolveChatJid: (sessionKey: string) =>
      resolveChatJidForSessionKey(sessionKey),
    getSessionKeyForChat: (chatJid: string) => getSessionKeyForChat(chatJid),
    getSessionPrefs: (chatJid: string) => getTuiSessionPrefs(chatJid),
    patchSessionPrefs: (chatJid: string, patch: TuiSessionPrefs) =>
      patchTuiSessionPrefs(chatJid, patch),
    resetSession: (chatJid: string, reason: string) =>
      resetTuiSession(chatJid, reason),
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
      hostEventBus,
      {
        host: FFT_NANO_TUI_HOST,
        port: FFT_NANO_TUI_PORT,
        authToken: FFT_NANO_TUI_AUTH_TOKEN || undefined,
      },
    );
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    logger.error(
      { err: error },
      'TUI gateway failed to start; continuing without TUI surface',
    );
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

async function sendTelegramAgentReply(
  chatJid: string,
  text: string,
): Promise<boolean> {
  if (!state.telegramBot) {
    return await sendMessage(chatJid, text);
  }

  const extracted = extractTelegramAttachmentHintsFromReply(text);
  if (extracted.hints.length === 0) {
    return await sendMessage(chatJid, text);
  }

  const group = state.registeredGroups[chatJid];
  if (!group) {
    return await sendMessage(chatJid, text);
  }

  const resolved = resolveTelegramAttachmentsFromReply({
    groupFolder: group.folder,
    mainGroupFolder: MAIN_GROUP_FOLDER,
    mainWorkspaceDir: MAIN_WORKSPACE_DIR,
    groupsDir: GROUPS_DIR,
    projectRoot: process.cwd(),
    maxBytes: TELEGRAM_MEDIA_MAX_BYTES,
    hints: extracted.hints,
  });
  if (resolved.attachments.length === 0) {
    return await sendMessage(chatJid, text);
  }

  let textSent = true;
  if (extracted.cleanedText) {
    textSent = await sendMessage(chatJid, extracted.cleanedText);
  }

  const outcomes = await sendResolvedTelegramAttachments({
    bot: state.telegramBot,
    chatJid,
    attachments: resolved.attachments,
  });

  let failedSends = 0;
  for (const outcome of outcomes) {
    if (!outcome.error) {
      logger.info(
        {
          chatJid,
          requestedKind: outcome.attachment.kind,
          deliveredKind: outcome.deliveredKind,
          fileName: outcome.attachment.fileName,
          path: outcome.attachment.hostPath,
          usedFallback: outcome.usedFallback,
        },
        'Telegram attachment sent',
      );
      continue;
    }

    failedSends += 1;
    logger.error(
      {
        chatJid,
        err: outcome.error,
        fileName: outcome.attachment.fileName,
        path: outcome.attachment.hostPath,
        requestedKind: outcome.attachment.kind,
        usedFallback: outcome.usedFallback,
      },
      'Failed to send Telegram attachment',
    );
  }

  const failedTotal = failedSends + resolved.skipped;
  if (failedTotal > 0) {
    await sendMessage(
      chatJid,
      `Note: ${failedTotal} attachment${failedTotal === 1 ? '' : 's'} could not be delivered.`,
    );
  }

  return textSent && failedTotal === 0;
}

async function sendAgentResultMessage(
  chatJid: string,
  text: string,
  opts: { prefixWhatsApp?: boolean } = {},
): Promise<boolean> {
  if (isTelegramJid(chatJid)) {
    return await sendTelegramAgentReply(chatJid, text);
  }

  const outgoing = opts.prefixWhatsApp ? `${ASSISTANT_NAME}: ${text}` : text;
  return await sendMessage(chatJid, outgoing);
}

async function sendMessage(jid: string, text: string): Promise<boolean> {
  if (isTelegramJid(jid)) {
    if (!state.telegramBot) {
      logger.error(
        { jid },
        'Telegram message send requested but Telegram is not configured',
      );
      return false;
    }
    try {
      await state.telegramBot.sendMessage(jid, text);
      logger.info({ jid, length: text.length }, 'Telegram message sent');
      return true;
    } catch (err) {
      logger.error({ jid, err }, 'Failed to send Telegram message');
      return false;
    }
  }

  if (!state.sock) {
    logger.error(
      { jid },
      'WhatsApp message send requested but WhatsApp is not connected',
    );
    return false;
  }
  try {
    await state.sock.sendMessage(jid, { text });
    logger.info({ jid, length: text.length }, 'Message sent');
    return true;
  } catch (err) {
    logger.error({ jid, err }, 'Failed to send message');
    return false;
  }
}

function queueTelegramToolProgressReaction(
  chatJid: string,
  requestId: string,
  event: { toolName: string; status: 'start' | 'ok' | 'error' },
): void {
  const bot = state.telegramBot;
  if (!bot) return;

  const streamKey = getTelegramHostStreamKey(chatJid, requestId);
  const preview = telegramPreviewRegistry.getPreviewState(streamKey);

  const emoji =
    event.status === 'start'
      ? getTelegramToolEmoji(event.toolName)
      : event.status === 'error'
        ? '💔'
        : null;

  if (!preview) {
    logger.debug(
      { chatJid, requestId, streamKey, toolName: event.toolName, emoji },
      'No preview yet — queuing pending reaction',
    );
    telegramPreviewRegistry.setPendingReaction(streamKey, emoji);
    return;
  }

  logger.debug(
    { chatJid, requestId, messageId: preview.messageId, emoji },
    'Applying tool reaction to preview message',
  );
  bot.setMessageReaction(chatJid, preview.messageId, emoji).catch((err) => {
    logger.warn(
      { chatJid, messageId: preview.messageId, emoji, err },
      'setMessageReaction failed',
    );
  });
}

function queueTelegramToolProgressUpdate(
  chatJid: string,
  requestId: string,
  deliveryMode: TelegramDeliveryMode,
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

  if (effectiveMode === 'new') {
    queueTelegramToolProgressReaction(chatJid, requestId, event);
    return;
  }

  if (effectiveMode === 'all' && deliveryMode === 'partial') {
    queueTelegramToolProgressReaction(chatJid, requestId, event);
  }

  if (
    shouldUseTelegramPreviewToolTrail({
      deliveryMode,
      verboseMode: effectiveMode,
    })
  ) {
    const trailEntry = buildTelegramPreviewToolTrailEntry(event, effectiveMode);
    if (trailEntry) {
      telegramPreviewRegistry.appendToolTrail(
        getTelegramHostStreamKey(chatJid, requestId),
        trailEntry,
      );
    }
    return;
  }

  if (
    shouldUseStandaloneTelegramToolProgress({
      deliveryMode,
      verboseMode: effectiveMode,
    })
  ) {
    enqueueTelegramToolProgressMessage({
      bot,
      runs: telegramToolProgressRuns,
      chatJid,
      requestId,
      mode: effectiveMode,
      event,
    });
  }
}

async function finalizeTelegramToolProgress(
  chatJid: string,
  requestId: string,
): Promise<void> {
  await awaitTelegramToolProgressRun(
    telegramToolProgressRuns,
    getTelegramToolProgressKey(chatJid, requestId),
  );
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

  const extracted = extractTelegramAttachmentHintsFromReply(text);
  if (extracted.hints.length > 0) {
    await deleteTelegramPreviewMessage(chatJid, messageId);
    const sent = await sendTelegramAgentReply(chatJid, text);
    logger.info(
      { chatJid, messageId, finalizeMode: 'delete-then-send' },
      'Telegram streaming preview finalized',
    );
    return sent;
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
    // Fallback: send the full text as a plain message
    return await sendMessage(chatJid, text);
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
  return getTelegramPreviewRunKey(chatJid, requestId);
}

function noteTelegramHostCompletedRun(
  chatJid: string,
  requestId: string,
): void {
  telegramPreviewRegistry.noteCompleted(
    getTelegramHostStreamKey(chatJid, requestId),
  );
}

function consumeTelegramHostCompletedRun(
  chatJid: string,
  requestId: string,
): boolean {
  return telegramPreviewRegistry.consumeCompleted(
    getTelegramHostStreamKey(chatJid, requestId),
  );
}

function consumeTelegramHostStreamState(
  chatJid: string,
  requestId: string,
): TelegramMessagePreviewState | null {
  return telegramPreviewRegistry.consumePreviewState(
    getTelegramHostStreamKey(chatJid, requestId),
  );
}

function pruneTelegramHostStreamedRuns(): void {
  telegramPreviewRegistry.prune();
}

function getTelegramDeliveryMode(chatJid: string): TelegramDeliveryMode {
  return state.chatRunPreferences[chatJid]?.telegramDeliveryMode || 'partial';
}

function canUseTelegramNativeDraft(_chatJid: string): boolean {
  return Boolean(state.telegramBot);
}

async function deliverRuntimeAgentMessage(params: {
  chatJid: string;
  text: string;
  requestId?: string;
  prefixWhatsApp?: boolean;
}): Promise<void> {
  const requestId =
    typeof params.requestId === 'string' && params.requestId.trim()
      ? params.requestId.trim()
      : undefined;

  if (isTelegramJid(params.chatJid) && requestId) {
    const previewState = consumeTelegramHostStreamState(
      params.chatJid,
      requestId,
    );
    noteTelegramHostCompletedRun(params.chatJid, requestId);
    if (previewState) {
      const finalized = await finalizeTelegramPreviewMessage(
        params.chatJid,
        previewState.messageId,
        params.text,
      );
      if (!finalized) {
        await sendTelegramAgentReply(params.chatJid, params.text);
      }
      return;
    }
  }

  await sendAgentResultMessage(params.chatJid, params.text, {
    prefixWhatsApp: params.prefixWhatsApp,
  });
}

async function prepareTelegramCompletionState(params: {
  chatJid: string;
  runId: string;
  result: string | null;
}): Promise<{
  externallyCompleted: boolean;
  previewState: TelegramMessagePreviewState | null;
}> {
  const deliveryMode = getTelegramDeliveryMode(params.chatJid);
  if (deliveryMode === 'draft' && canUseTelegramNativeDraft(params.chatJid)) {
    telegramPreviewRegistry.consumeDraftState(
      getTelegramHostStreamKey(params.chatJid, params.runId),
    );
    return {
      externallyCompleted: consumeTelegramHostCompletedRun(
        params.chatJid,
        params.runId,
      ),
      previewState: null,
    };
  }

  return {
    externallyCompleted: consumeTelegramHostCompletedRun(
      params.chatJid,
      params.runId,
    ),
    previewState: consumeTelegramHostStreamState(params.chatJid, params.runId),
  };
}

async function processHostEvent(event: HostEvent): Promise<void> {
  switch (event.kind) {
    case 'telegram_preview_requested': {
      if (!state.telegramBot) return;
      if (!isTelegramJid(event.chatJid)) return;
      if (!state.registeredGroups[event.chatJid]) return;

      const deliveryMode = getTelegramDeliveryMode(event.chatJid);
      if (deliveryMode === 'off') return;

      const streamKey = getTelegramPreviewRunKey(
        event.chatJid,
        event.requestId,
      );

      if (
        deliveryMode === 'draft' &&
        canUseTelegramNativeDraft(event.chatJid)
      ) {
        const sendResult = await updateTelegramDraftPreview({
          bot: state.telegramBot,
          registry: telegramPreviewRegistry,
          chatJid: event.chatJid,
          requestId: event.requestId,
          draftId: deriveTelegramDraftId(streamKey),
          text: event.text,
          toolTrailFooter:
            telegramPreviewRegistry.getToolTrailFooter(streamKey),
        });
        if (sendResult.error) {
          logger.warn(
            {
              chatJid: event.chatJid,
              requestId: event.requestId,
              runKey: sendResult.runKey,
              err: sendResult.error,
            },
            'Telegram draft preview update failed; falling back to normal completion only for this run',
          );
        }
        return;
      }

      const toolTrailFooter =
        telegramPreviewRegistry.getToolTrailFooter(streamKey);
      const sendResult = await updateTelegramPreview({
        bot: state.telegramBot,
        registry: telegramPreviewRegistry,
        chatJid: event.chatJid,
        requestId: event.requestId,
        text: event.text,
        toolTrailFooter,
      });
      if (sendResult.error) {
        logger.warn(
          {
            chatJid: event.chatJid,
            requestId: event.requestId,
            runKey: sendResult.runKey,
            err: sendResult.error,
          },
          'Telegram preview update failed; disabling preview updates for this run',
        );
      }
      if (sendResult.pendingReaction !== undefined && sendResult.messageId) {
        state.telegramBot
          .setMessageReaction(
            event.chatJid,
            sendResult.messageId,
            sendResult.pendingReaction,
          )
          .catch(() => {});
      }
      return;
    }
    case 'chat_delivery_requested':
      await deliverRuntimeAgentMessage({
        chatJid: event.chatJid,
        text: event.text,
        requestId: event.requestId,
        prefixWhatsApp: event.prefixWhatsApp,
      });
      return;
    case 'task_requested':
      await processTaskIpc(
        event.request as Parameters<typeof processTaskIpc>[0],
        event.sourceGroup,
        event.isMain,
      );
      return;
    case 'action_requested': {
      const result =
        event.request.type === 'farm_action'
          ? FEATURE_FARM
            ? await executeFarmAction(event.request, event.isMain)
            : {
                requestId: event.request.requestId,
                status: 'error' as const,
                error:
                  'farm_action is disabled in core profile (set FFT_PROFILE=farm or FEATURE_FARM=1)',
                executedAt: new Date().toISOString(),
              }
          : await executeMemoryAction(event.request, {
              sourceGroup: event.sourceGroup,
              isMain: event.isMain,
              registeredGroups: state.registeredGroups,
            });
      fs.writeFileSync(event.resultPath, JSON.stringify(result, null, 2));
      return;
    }
    case 'action_result_ready':
      fs.writeFileSync(event.resultPath, JSON.stringify(event.result, null, 2));
      return;
    case 'host_error':
      logger.warn(
        {
          scope: event.scope,
          detail: event.detail,
          sourceGroup: event.sourceGroup,
          requestId: event.requestId,
          err: event.errorMessage,
        },
        'Host event reported error',
      );
      return;
    case 'tool_progress': {
      if (!event.chatJid) return;
      if (!isTelegramJid(event.chatJid)) return;
      if (!state.telegramBot) return;

      const deliveryMode = getTelegramDeliveryMode(event.chatJid);
      const verboseMode = getEffectiveVerboseMode(
        state.chatRunPreferences[event.chatJid]?.verboseMode,
      );
      if (
        !shouldUseStandaloneTelegramToolProgress({
          deliveryMode,
          verboseMode,
        })
      ) {
        return;
      }
      enqueueTelegramToolProgressMessage({
        bot: state.telegramBot,
        runs: telegramToolProgressRuns,
        chatJid: event.chatJid,
        requestId: event.runId,
        mode: verboseMode as 'all' | 'verbose',
        event: {
          toolName: event.toolName,
          status: event.status,
          args: event.args,
          output: event.output,
          error: event.error,
        },
      });
      return;
    }
    case 'run_progress': {
      statusTelemetry.noteRunProgress({
        runId: event.runId,
        phase: event.phase,
        text: event.text,
        detail: event.detail,
        chatJid: event.chatJid,
        createdAt: event.createdAt,
      });
      if (!event.chatJid) return;
      if (!isTelegramJid(event.chatJid)) return;
      if (!state.telegramBot) return;
      if (!state.registeredGroups[event.chatJid]) return;

      const deliveryMode = getTelegramDeliveryMode(event.chatJid);
      if (deliveryMode === 'off') return;

      const streamKey = getTelegramPreviewRunKey(event.chatJid, event.runId);
      const existingState = telegramPreviewRegistry.getStreamState(streamKey);
      if (
        existingState &&
        existingState.lastText.trim() &&
        !existingState.lastText.startsWith('Coder status:')
      ) {
        return;
      }

      if (
        deliveryMode === 'draft' &&
        canUseTelegramNativeDraft(event.chatJid)
      ) {
        const sendResult = await updateTelegramDraftPreview({
          bot: state.telegramBot,
          registry: telegramPreviewRegistry,
          chatJid: event.chatJid,
          requestId: event.runId,
          draftId: deriveTelegramDraftId(streamKey),
          text: event.text,
          toolTrailFooter:
            telegramPreviewRegistry.getToolTrailFooter(streamKey),
        });
        if (sendResult.error) {
          logger.warn(
            {
              chatJid: event.chatJid,
              requestId: event.runId,
              runKey: sendResult.runKey,
              err: sendResult.error,
            },
            'Telegram draft run-progress update failed; continuing without status draft updates for this run',
          );
        }
        return;
      }

      const sendResult = await updateTelegramPreview({
        bot: state.telegramBot,
        registry: telegramPreviewRegistry,
        chatJid: event.chatJid,
        requestId: event.runId,
        text: event.text,
        toolTrailFooter: telegramPreviewRegistry.getToolTrailFooter(streamKey),
      });
      if (sendResult.error) {
        logger.warn(
          {
            chatJid: event.chatJid,
            requestId: event.runId,
            runKey: sendResult.runKey,
            err: sendResult.error,
          },
          'Telegram run-progress update failed; disabling status preview updates for this run',
        );
      }
      return;
    }
    case 'run_failed':
      statusTelemetry.noteRunFailed({
        runId: event.runId,
        errorMessage: event.errorMessage,
        detail: event.detail,
        chatJid: event.chatJid,
        createdAt: event.createdAt,
      });
      return;
    case 'run_finished':
    case 'run_aborted':
      statusTelemetry.clearRun(event.runId);
      return;
    case 'run_started':
      return;
    default:
      return;
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
  const processHostEventOrdered = createOrderedHostEventProcessor(
    processHostEvent,
    (err, event) => {
      logger.error(
        { err, kind: event.kind },
        'Unhandled host event delivery failure',
      );
    },
  );
  hostEventBus.subscribe((event) => {
    processHostEventOrdered(event);
  });

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
              const envelope = wrapLegacyMessageEnvelope(data, sourceGroup);
              if (envelope) {
                const outcome = await dispatchLegacyMessageEnvelope(
                  envelope,
                  state.registeredGroups,
                  isMain,
                  processHostEventOrdered,
                );
                if (outcome === 'delivered') {
                  logger.info(
                    { sourceGroup, requestId: envelope.requestId },
                    'IPC message translated to host event',
                  );
                } else {
                  logger.warn(
                    { sourceGroup, file },
                    'Ignoring unauthorized or invalid IPC message envelope',
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
              const envelope = wrapLegacyTaskEnvelope(data, sourceGroup);
              if (envelope) {
                await processHostEventOrdered({
                  kind: 'task_requested',
                  id: envelope.id,
                  createdAt: envelope.createdAt,
                  source: 'ipc-boundary',
                  sourceGroup,
                  isMain,
                  request: envelope.payload,
                });
              }
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

              if (
                request.type === 'farm_action' ||
                request.type === 'memory_action'
              ) {
                const resultPath = path.join(
                  resultDir,
                  `${request.requestId}.json`,
                );
                const envelope = wrapLegacyActionEnvelope(
                  request,
                  sourceGroup,
                  resultPath,
                );
                await processHostEventOrdered({
                  kind: 'action_requested',
                  id: envelope.id,
                  createdAt: envelope.createdAt,
                  source: 'ipc-boundary',
                  sourceGroup,
                  isMain,
                  request,
                  resultPath: envelope.resultPath,
                });
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
  await appRuntime.connectWhatsApp();
}

async function startMessageLoop(): Promise<void> {
  await appRuntime.startMessageLoop();
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
    logHeartbeatSkip('main-group-not-registered', {
      chatJid: mainChatJid,
      reason,
    });
    return;
  }
  if (
    !shouldBypassEmptyHeartbeatSkip(reason) &&
    isHeartbeatFileEffectivelyEmpty(
      path.join(MAIN_WORKSPACE_DIR, 'HEARTBEAT.md'),
    )
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
      { suppressErrorReply: true, isHeartbeatTask: true },
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
        const sent = await sendMessage(destination, 'HEARTBEAT_OK');
        if (!sent) {
          logger.error(
            { chatJid: mainChatJid, destination, reason },
            'Heartbeat HEARTBEAT_OK delivery failed',
          );
        } else {
          rememberHeartbeatTarget(destination);
        }
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
    const sent = await sendMessage(destination, normalized.text);
    if (!sent) {
      logger.error(
        { chatJid: mainChatJid, destination, reason },
        'Heartbeat alert delivery failed; user did not receive the heartbeat notification',
      );
      return;
    }
    rememberHeartbeatTarget(destination);
    if (HEARTBEAT_INCLUDE_REASONING) {
      const match =
        run.result.match(/<reasoning>([\s\S]*?)<\/reasoning>/i) ||
        run.result.match(/<thinking>([\s\S]*?)<\/thinking>/i);
      const reasoning = match?.[1]?.trim();
      if (reasoning) {
        const reasonSent = await sendMessage(
          destination,
          `Reasoning:\n${reasoning}`,
        );
        if (!reasonSent) {
          logger.warn(
            { chatJid: mainChatJid, destination, reason },
            'Heartbeat reasoning delivery failed (alert was sent)',
          );
        }
      }
    }
    heartbeatLastSent.set(mainChatJid, {
      text: normalized.text,
      sentAt: nowMs,
    });
  } catch (err) {
    logger.error(
      { err, chatJid: mainChatJid, reason },
      'Heartbeat run failed; agent threw an exception',
    );
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
  appRuntime.ensureContainerSystemRunning();
}

function stopFarmServicesForShutdown(signal: string): void {
  appRuntime.stopFarmServicesForShutdown(signal);
}

async function shutdownAndExit(
  signal: string,
  exitCode: number,
): Promise<void> {
  await appRuntime.shutdownAndExit(signal, exitCode);
}

function registerShutdownHandlers(): void {
  appRuntime.registerShutdownHandlers();
}

async function main(): Promise<void> {
  await appRuntime.main();
}

main().catch(async (err) => {
  stopFarmServicesForShutdown('startup_error');
  await stopWebControlCenterService();
  await stopTuiGatewayService();
  logger.error({ err }, 'Failed to start FFT_nano');
  process.exit(1);
});
