import { randomBytes } from 'crypto';
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
  FFT_NANO_CODER_GATE_MODE,
  FFT_NANO_ONBOARDING_MODE,
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
  type ContainerInput,
  type ContainerProgressEvent,
  writeGroupsSnapshot,
  writeTasksSnapshot,
} from './pi-runner.js';
import {
  createPendingConfirmation,
  cancelPendingConfirmationsForChat,
  getExpiredConfirmation,
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
  listActiveAgentRuns,
  getTaskById,
  getTaskRunLogs,
  getNextDueTaskTime,
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
  SkillActionRequest,
} from './types.js';
import { loadJson, saveJson } from './utils.js';
import { logger } from './logger.js';
import { attachActionRequestAudit } from './action-result-audit.js';
import { getContainerRuntime } from './container-runtime.js';
import { acquireSingletonLock } from './singleton-lock.js';
import {
  runUpdateCommand,
  startDetachedUpdateCommand,
} from './update-command.js';
import {
  startUpdateNotificationLoop,
  stopUpdateNotificationLoop,
} from './update-service.js';
import {
  createTelegramBot,
  isTelegramJid,
  isTelegramPrivateChatJid,
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
import { parsePiListModelsResult } from './pi-models.js';
import { ensureOpenCodeGoModels } from './opencode-go-models.js';
import { ensureLocalProviderModels } from './local-provider-models.js';
import {
  applyProcessEnvUpdates,
  buildRuntimeProviderPresetUpdates,
  getDefaultDotEnvPath,
  getRuntimeProviderDefinitionByPreset,
  getRuntimeProviderDefinitionByPiApi,
  hasMeaningfulSecret,
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
  shouldSuggestCodingEscalation,
  type CodingHint,
} from './coding-delegation.js';
import {
  createCodingOrchestrator,
  type CodingWorkerRequest,
} from './coding-orchestrator.js';
import { resolveCoderProjectTarget } from './coder-project-resolver.js';
import { executeFarmAction } from './farm-action-gateway.js';
import {
  normalizeFileDeliveryRequest,
  processFileDeliveryRequest,
} from './file-delivery.js';
import {
  startFarmStateCollector,
  stopFarmStateCollector,
} from './farm-state-collector.js';
import { executeMemoryAction } from './memory-action-gateway.js';
import {
  applySkillManagerTransitions,
  executeSkillAction,
  formatSkillManagerStatus,
  loadSkillManagerState,
  resolveGroupSkillsDir,
  saveSkillManagerState,
  setSkillManagerPaused,
  shouldRunSkillManager,
  snapshotSkills,
  writeSkillManagerReport,
  type SkillManagerConfig,
} from './skill-lifecycle.js';
import {
  isValidGroupFolder,
  resolveGroupFolderPath,
  resolveGroupIpcPath,
} from './group-folder.js';
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
import { computeTaskNextRun } from './task-schedule.js';
import { buildSystemPrompt } from './system-prompt.js';
import type { CronV2Schedule } from './cron/types.js';
import {
  isHeartbeatFileEffectivelyEmpty,
  parseHeartbeatActiveHours,
} from './heartbeat-policy.js';
import {
  HEARTBEAT_ENABLED,
  rememberHeartbeatTarget,
  resolveHeartbeatActiveHoursRaw,
  runHeartbeatTurn,
  startHeartbeatLoop,
  stopHeartbeatLoop,
  requestHeartbeatNow,
} from './heartbeat-service.js';
import {
  completeMainWorkspaceOnboarding,
  computeBootFileHash,
  ensureMainWorkspaceBootstrap,
  getMainWorkspaceOnboardingStatus,
  markMainWorkspaceBootExecuted,
  readMainWorkspaceState,
} from './workspace-bootstrap.js';
import {
  captureKnowledgeRawNote,
  ensureKnowledgeWikiScaffold,
  formatKnowledgeWikiStatusText,
  readKnowledgeWikiStatus,
  runKnowledgeWikiLint,
} from './knowledge-wiki.js';
import {
  ensureKnowledgeNightlyTask,
  KNOWLEDGE_NIGHTLY_TASK_ID,
} from './knowledge-wiki-task.js';
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
  isTelegramRunStatusPreviewText,
  resolveTelegramStreamCompletionState,
  type TelegramMessagePreviewState,
  updateTelegramDraftPreview,
  updateTelegramPreview,
} from './telegram-streaming.js';
import { StreamConsumer } from './streaming/stream-consumer.js';
import { createTelegramAdapter } from './streaming/telegram-adapter.js';
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
} from './runtime/boundary-ipc.js';
import { createAppRuntime } from './app.js';
import {
  consumeTelegramHostCompletedRun as hcConsumeHostCompletedRun,
  consumeTelegramHostStreamState as hcConsumeHostStreamState,
  deliverRuntimeAgentMessage as hcDeliverRuntimeAgentMessage,
  getTelegramDeliveryMode as hcGetTelegramDeliveryMode,
  getTelegramHostStreamKey as hcGetTelegramHostStreamKey,
  prepareTelegramCompletionState as hcPrepareTelegramCompletionState,
  processHostEvent as hcProcessHostEvent,
  processTaskIpc as hcProcessTaskIpc,
  pruneTelegramHostStreamedRuns as hcPruneTelegramHostStreamedRuns,
  startIpcWatcher as hcStartIpcWatcher,
  type HostCoordinationDeps,
} from './host-coordination.js';
import { isActionfulChatTask } from './evaluator.js';
import {
  createMessageDispatcher,
  finalizeCompletedRun,
  type PromptInputLogEntry,
} from './message-dispatch.js';
import { writePromptInputLogFile } from './prompt-input-log.js';
import {
  initAgentRunner,
  setHostEventBusPublish,
  runAgent as runAgentImpl,
  runCodingTask as runCodingTaskImpl,
  runCompactionForChat as runCompactionForChatImpl,
  maybeRunCompactionMemoryFlush as maybeRunCompactionMemoryFlushImpl,
  getCodingOrchestrator as getCodingOrchestratorImpl,
  isCoderDelegationCommand as isCoderDelegationCommandImpl,
  onboardingCommandBlockedText as onboardingCommandBlockedTextImpl,
  buildOnboardingInterviewPrompt as buildOnboardingInterviewPromptImpl,
  makeRunId as makeRunIdImpl,
  getContinuityLedgerEntry,
  summarizeObjective,
  noteContinuityRunStarted,
  noteContinuityRunSettled,
  noteDeliveryPending,
  noteDeliverySettled,
  buildUnresolvedWorkSummary,
} from './agent-runner.js';
import {
  handleSkillManagerCommand as handleSkillManagerCommandImpl,
  handleLibrarianCommand as handleLibrarianCommandImpl,
  formatActiveSubagentsText as formatActiveSubagentsTextImpl,
  maybeRunSkillSelfImprovement,
  maybeRunSkillManager,
  toSkillManagerConfig,
  skillSelfImproveStatePath,
  readSkillSelfImproveState,
  writeSkillSelfImproveState,
  shouldTriggerSkillSelfImprove,
  runQuietSkillAgent,
} from './skill-service.js';
import { createTelegramCommandHandlers } from './telegram-commands.js';
import { createLongRunService } from './long-run-service.js';
import {
  getSessionKeyForChat as tuiGetSessionKeyForChat,
  resolveChatJidForSessionKey as tuiResolveChatJidForSessionKey,
  buildTuiSessionList as tuiBuildSessionList,
  normalizeAssistantHistoryContent as tuiNormalizeAssistantHistoryContent,
  getTuiSessionHistory as tuiGetSessionHistory,
  emitTuiChatEvent as tuiEmitChatEvent,
  emitTuiAgentEvent as tuiEmitAgentEvent,
  emitTuiToolEvent as tuiEmitToolEvent,
  persistAssistantHistory as tuiPersistAssistantHistory,
  persistTuiUserHistory as tuiPersistUserHistory,
  resetTuiSession as tuiResetSession,
  createTuiGatewayAdapters as tuiCreateGatewayAdapters,
  startTuiGatewayService as tuiStartGatewayService,
  stopTuiGatewayService as tuiStopGatewayService,
  type TuiCoordinationDeps,
} from './tui-coordination.js';
import {
  PROVIDER_SETUP_URLS as webProviderSetupUrls,
  getControlCenterProviderSetup as webGetProviderSetup,
  getControlCenterRuntimeSettings as webGetRuntimeSettings,
  applyControlCenterRuntimeSettings as webApplyRuntimeSettings,
  buildControlCenterSystemPromptPreview as webBuildSystemPromptPreview,
  listControlCenterTasks as webListTasks,
  performControlCenterTaskAction as webPerformTaskAction,
  getControlCenterPipelines as webGetPipelines,
  getControlCenterMemoryOverview as webGetMemoryOverview,
  getControlCenterKnowledgeStatus as webGetKnowledgeStatus,
  createWebControlCenterAdapters as webCreateAdapters,
  startWebControlCenterService as webStartService,
  stopWebControlCenterService as webStopService,
  type WebControlCenterDeps,
} from './web-control-center.js';
import {
  GIT_INFO,
  loadState,
  saveState,
  registerGroup as registerGroupImpl,
  migrateCompactionSummariesFromSoul,
  migrateLegacyClaudeMemoryFiles,
  maybeRegisterWhatsAppMainChat as maybeRegisterWhatsAppMainChatImpl,
  syncGroupMetadata,
  getAvailableGroups,
  writeJsonAtomic,
  listPendingDeliveryFiles,
} from './state-persistence.js';
import {
  TELEGRAM_GROUP_APPROVALS_PATH,
  TELEGRAM_GROUP_APPROVAL_NOTIFY_EVERY_MS,
  type TelegramGroupApprovalRecord,
  type TelegramGroupApprovalState,
  emptyTelegramGroupApprovalState,
  loadTelegramGroupApprovals,
  saveTelegramGroupApprovals,
  isTelegramGroupChatJid,
  buildTelegramGroupFolder,
  findAvailableGroup,
  clipTelegramButtonLabel,
  buildTelegramGroupApprovalRecord,
  buildTelegramGroupApprovalSnapshot,
  handleTelegramUnknownGroup as handleTelegramUnknownGroupImpl,
  approveTelegramGroup as approveTelegramGroupImpl,
  ignoreTelegramGroup,
  unignoreTelegramGroup,
  maybeRegisterTelegramChat as maybeRegisterTelegramChatImpl,
  hasMainGroup,
  ensureKnowledgeRuntimeSetup,
  promoteChatToMain as promoteChatToMainImpl,
  maybePromoteConfiguredTelegramMain as maybePromoteConfiguredTelegramMainImpl,
  isMainChat,
  resolveMainOnboardingGate,
  parseTelegramTargetJid,
  findMainTelegramChatJid,
  findMainChatJid,
  formatGroupsText,
  buildTelegramGroupsPanel as buildTelegramGroupsPanelImpl,
} from './telegram-group-mgmt.js';
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
import {
  sendMessage as tdSendMessage,
  sendTelegramAgentReply as tdSendTelegramAgentReply,
  sendAgentResultMessage as tdSendAgentResultMessage,
  queueTelegramToolProgressReaction as tdQueueTelegramToolProgressReaction,
  queueTelegramToolProgressUpdate as tdQueueTelegramToolProgressUpdate,
  finalizeTelegramToolProgress as tdFinalizeTelegramToolProgress,
  deleteTelegramPreviewMessage as tdDeleteTelegramPreviewMessage,
  finalizeTelegramPreviewMessage as tdFinalizeTelegramPreviewMessage,
  sanitizeFileName as tdSanitizeFileName,
  defaultExtensionForMedia as tdDefaultExtensionForMedia,
  persistTelegramMedia as tdPersistTelegramMedia,
  refreshTelegramCommandMenus as tdRefreshTelegramCommandMenus,
  logTelegramCommandAudit as tdLogTelegramCommandAudit,
  handlePermissionGateRequest as tdHandlePermissionGateRequest,
  handleTelegramCallbackQuery as tdHandleTelegramCallbackQuery,
  formatStatusText as tdFormatStatusText,
  summarizeTask as tdSummarizeTask,
  formatTaskRunsText as tdFormatTaskRunsText,
  formatTasksText as tdFormatTasksText,
  runGatewayServiceCommand as tdRunGatewayServiceCommand,
  resolveKnowledgeRuntimeSnapshot as tdResolveKnowledgeRuntimeSnapshot,
  handleKnowledgeCommand as tdHandleKnowledgeCommand,
  type FormatStatusDeps,
} from './telegram-delivery.js';
import {
  getRuntimeConfigEnv as tsGetRuntimeConfigEnv,
  getRuntimeConfigSummaryLines as tsGetRuntimeConfigSummaryLines,
  buildOnboardingStatus as tsBuildOnboardingStatus,
  ensureWebOnboardingAdminSecret as tsEnsureWebOnboardingAdminSecret,
  applyWebOnboardingConfig as tsApplyWebOnboardingConfig,
  persistRuntimeConfigUpdates as tsPersistRuntimeConfigUpdates,
  loadPiModels as tsLoadPiModels,
  runPiListModels as tsRunPiListModels,
  providerExistsInPiModels as tsProviderExistsInPiModels,
  modelExistsInPiModels as tsModelExistsInPiModels,
  providerAllowsCustomModelId as tsProviderAllowsCustomModelId,
  parseProviderFromModelLabel as tsParseProviderFromModelLabel,
  validateProviderModelRef as tsValidateProviderModelRef,
  sanitizeRunPreferencesModelOverride as tsSanitizeRunPreferencesModelOverride,
  pruneTelegramSettingsPanelActions as tsPruneTelegramSettingsPanelActions,
  registerTelegramSettingsPanelAction as tsRegisterTelegramSettingsPanelAction,
  getTelegramSettingsPanelAction as tsGetTelegramSettingsPanelAction,
  setTelegramSetupInputState as tsSetTelegramSetupInputState,
  setTelegramSetupInputProvider as tsSetTelegramSetupInputProvider,
  clearTelegramSetupInputState as tsClearTelegramSetupInputState,
  getTelegramSetupInputState as tsGetTelegramSetupInputState,
  truncateButtonLabel as tsTruncateButtonLabel,
  formatTelegramSettingsPanelSummary as tsFormatTelegramSettingsPanelSummary,
  buildTelegramSetupHomePanel as tsBuildTelegramSetupHomePanel,
  buildTelegramSetupProviderPanel as tsBuildTelegramSetupProviderPanel,
  buildTelegramSetupModelPanel as tsBuildTelegramSetupModelPanel,
  buildTelegramSetupEndpointPanel as tsBuildTelegramSetupEndpointPanel,
  buildTelegramSetupApiKeyPanel as tsBuildTelegramSetupApiKeyPanel,
  buildTelegramSettingsHomePanel as tsBuildTelegramSettingsHomePanel,
  buildTelegramModelProviderPanel as tsBuildTelegramModelProviderPanel,
  buildAddModelForProviderPanel as tsBuildAddModelForProviderPanel,
  buildTelegramProviderModelPanel as tsBuildTelegramProviderModelPanel,
  buildThinkPanel as tsBuildThinkPanel,
  buildReasoningPanel as tsBuildReasoningPanel,
  buildDeliveryPanel as tsBuildDeliveryPanel,
  buildVerbosePanel as tsBuildVerbosePanel,
  buildQueuePanel as tsBuildQueuePanel,
  buildSubagentsPanel as tsBuildSubagentsPanel,
  buildAdminPanelKeyboard as tsBuildAdminPanelKeyboard,
  resolveTelegramSettingsPanel as tsResolveTelegramSettingsPanel,
  sendTelegramSettingsPanel as tsSendTelegramSettingsPanel,
  editTelegramSettingsPanel as tsEditTelegramSettingsPanel,
  promptTelegramSetupInput as tsPromptTelegramSetupInput,
  sendTelegramCoderKeyboard as tsSendTelegramCoderKeyboard,
  buildCoderCommand as tsBuildCoderCommand,
  presentCoderSuggestion as tsPresentCoderSuggestion,
  prepareCoderTarget as tsPrepareCoderTarget,
  createCoderProject as tsCreateCoderProject,
  type ResolvePanelDeps,
} from './telegram-settings.js';

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
const HEARTBEAT_ACTIVE_HOURS_RAW = resolveHeartbeatActiveHoursRaw();
const HEARTBEAT_ACTIVE_HOURS = parseHeartbeatActiveHours(
  HEARTBEAT_ACTIVE_HOURS_RAW,
);
const STATUS_INCIDENT_WINDOW_MS = 30 * 60 * 1000;
const STATUS_INCIDENT_WINDOW_LABEL = '30m';
const STATUS_STUCK_WARNING_SECONDS = 120;

const TELEGRAM_MEDIA_MAX_BYTES = TELEGRAM_MEDIA_MAX_MB * 1024 * 1024;


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

// loadState, saveState, registerGroup, migrateCompactionSummariesFromSoul, migrateLegacyClaudeMemoryFiles, syncGroupMetadata, getAvailableGroups are imported from ./state-persistence.js

// Telegram group management functions are imported from ./telegram-group-mgmt.js

function registerGroup(jid: string, group: RegisteredGroup): void {
  registerGroupImpl(jid, group, () => void maybeRunBootMdOnce());
}

function maybeRegisterWhatsAppMainChat(): void {
  maybeRegisterWhatsAppMainChatImpl({ registerGroup, hasMainGroup });
}

function maybeRegisterTelegramChat(chatJid: string, chatName: string): boolean {
  return maybeRegisterTelegramChatImpl(chatJid, chatName, {
    registerGroup,
    hasMainGroup,
  });
}

function promoteChatToMain(chatJid: string, chatName: string): void {
  promoteChatToMainImpl(chatJid, chatName, { registerGroup });
}

function maybePromoteConfiguredTelegramMain(): void {
  maybePromoteConfiguredTelegramMainImpl({
    registerGroup,
    promoteChatToMain,
  });
}

async function handleTelegramUnknownGroup(event: {
  chatJid: string;
  chatName?: string;
  content?: string;
}): Promise<void> {
  return handleTelegramUnknownGroupImpl(event, {
    sendMessage,
    findMainTelegramChatJid,
    buildTelegramGroupsPanel,
  });
}

async function approveTelegramGroup(
  chatJid: string,
): Promise<{ ok: boolean; text: string }> {
  return approveTelegramGroupImpl(chatJid, {
    registerGroup,
    sendMessage,
    refreshTelegramCommandMenus,
  });
}

function buildTelegramGroupsPanel(chatJid: string): {
  text: string;
  keyboard: TelegramInlineKeyboard;
} {
  return buildTelegramGroupsPanelImpl(chatJid, {
    registerTelegramSettingsPanelAction,
  });
}


function isCoderDelegationCommand(content: string): boolean {
  return isCoderDelegationCommandImpl(content);
}

function onboardingCommandBlockedText(): string {
  return onboardingCommandBlockedTextImpl();
}

function buildOnboardingInterviewPrompt(params: {
  prompt: string;
  latestUserText: string;
}): string {
  return buildOnboardingInterviewPromptImpl(params);
}


async function maybeRunBootMdOnce(): Promise<void> {
  if (state.bootRunInFlight) return;
  const mainChatJid = findMainChatJid();
  const knowledgeSetup = ensureKnowledgeRuntimeSetup(mainChatJid);
  if (knowledgeSetup.createdPaths.length > 0) {
    logger.info(
      { created: knowledgeSetup.createdPaths },
      'Initialized knowledge wiki scaffold in main workspace',
    );
  }
  if (knowledgeSetup.nightlyTask.created) {
    logger.info(
      {
        taskId: knowledgeSetup.nightlyTask.taskId,
        schedule: knowledgeSetup.nightlyTask.schedule,
        nextRun: knowledgeSetup.nightlyTask.nextRun,
      },
      'Created nightly knowledge task at startup',
    );
  }
  if (!PARITY_CONFIG.workspace.enableBootMd) return;
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

function getTuiCoordinationDeps(): TuiCoordinationDeps {
  return {
    isMainChat,
    findMainChatJid,
    getTuiSessionPrefs,
    patchTuiSessionPrefs,
    runDirectSessionTurn,
    runGatewayServiceCommand,
  };
}

function getSessionKeyForChat(chatJid: string): string {
  return tuiGetSessionKeyForChat(chatJid, getTuiCoordinationDeps());
}

function resolveChatJidForSessionKey(sessionKey: string): string | null {
  return tuiResolveChatJidForSessionKey(sessionKey, getTuiCoordinationDeps());
}

function buildTuiSessionList(): TuiSessionSummary[] {
  return tuiBuildSessionList(getTuiCoordinationDeps());
}

function normalizeAssistantHistoryContent(content: string): string {
  return tuiNormalizeAssistantHistoryContent(content);
}

function getTuiSessionHistory(
  chatJid: string,
  limit: number,
): SessionHistoryMessage[] {
  return tuiGetSessionHistory(chatJid, limit);
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
  tuiEmitChatEvent(hostEventBus, payload);
}

function emitTuiAgentEvent(payload: {
  runId: string;
  sessionKey: string;
  phase: 'start' | 'end' | 'error';
  detail?: string;
}): void {
  tuiEmitAgentEvent(hostEventBus, payload);
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
  tuiEmitToolEvent(hostEventBus, payload);
}

function makeRunId(prefix = 'run'): string {
  return makeRunIdImpl(prefix);
}

function persistAssistantHistory(
  chatJid: string,
  text: string,
  runId?: string,
): string {
  return tuiPersistAssistantHistory(chatJid, text, runId);
}

function persistTuiUserHistory(
  chatJid: string,
  text: string,
  runId: string,
): string {
  return tuiPersistUserHistory(chatJid, text, runId);
}

function resetTuiSession(
  chatJid: string,
  reason: string,
): { ok: boolean; reason: string } {
  return tuiResetSession(chatJid, reason, getTuiCoordinationDeps());
}

function runPiListModels(searchText: string): { ok: boolean; text: string } {
  return tsRunPiListModels(searchText);
}

function loadPiModels(
  forceRefresh = false,
): { ok: true; entries: PiModelEntry[] } | { ok: false; text: string } {
  return tsLoadPiModels(forceRefresh);
}

function providerExistsInPiModels(
  entries: PiModelEntry[],
  provider: string,
): boolean {
  return tsProviderExistsInPiModels(entries, provider);
}

function modelExistsInPiModels(
  entries: PiModelEntry[],
  provider: string,
  model: string,
): boolean {
  return tsModelExistsInPiModels(entries, provider, model);
}

function providerAllowsCustomModelId(provider: string): boolean {
  return tsProviderAllowsCustomModelId(provider);
}

function parseProviderFromModelLabel(label: string): string | null {
  return tsParseProviderFromModelLabel(label);
}

function validateProviderModelRef(
  provider: string,
  model: string,
): { ok: true } | { ok: false; text: string } {
  return tsValidateProviderModelRef(provider, model);
}

function sanitizeRunPreferencesModelOverride(
  chatJid: string,
  runPreferences: Record<string, any>,
): { runPreferences: Record<string, any>; noticeText?: string } {
  return tsSanitizeRunPreferencesModelOverride(chatJid, runPreferences, {
    getEffectiveModelLabel,
    updateChatRunPreferences,
    isTelegramJid,
  });
}

function getRuntimeConfigEnv(): Record<string, string | undefined> {
  return tsGetRuntimeConfigEnv();
}

function getRuntimeConfigSummaryLines(): string[] {
  return tsGetRuntimeConfigSummaryLines();
}

function buildOnboardingStatus() {
  return tsBuildOnboardingStatus();
}

function ensureWebOnboardingAdminSecret(
  updates: Record<string, string | undefined>,
  source: Record<string, string | undefined>,
): string | null {
  return tsEnsureWebOnboardingAdminSecret(updates, source);
}

function applyWebOnboardingConfig(payload: {
  providerPreset?: string;
  model?: string;
  apiKey?: string;
  telegramBotToken?: string;
  whatsappEnabled?: boolean;
}): { ok: boolean; requiresRestart: boolean; adminSecret?: string } {
  return tsApplyWebOnboardingConfig(payload);
}

function persistRuntimeConfigUpdates(
  updates: Record<string, string | undefined>,
): void {
  tsPersistRuntimeConfigUpdates(updates);
}

function setTelegramSetupInputState(
  chatJid: string,
  kind: TelegramSetupInputKind,
): void {
  tsSetTelegramSetupInputState(chatJid, kind);
}

function setTelegramSetupInputProvider(
  chatJid: string,
  provider: string,
): void {
  tsSetTelegramSetupInputProvider(chatJid, provider);
}

function clearTelegramSetupInputState(chatJid: string): void {
  tsClearTelegramSetupInputState(chatJid);
}

function getTelegramSetupInputState(
  chatJid: string,
): TelegramSetupInputState | null {
  return tsGetTelegramSetupInputState(chatJid);
}

function buildTelegramSetupHomePanel(chatJid: string): {
  text: string;
  keyboard: TelegramInlineKeyboard;
} {
  return tsBuildTelegramSetupHomePanel(chatJid);
}

function buildTelegramSetupProviderPanel(chatJid: string): {
  text: string;
  keyboard: TelegramInlineKeyboard;
} {
  return tsBuildTelegramSetupProviderPanel(chatJid);
}

function buildTelegramSetupModelPanel(
  chatJid: string,
  preset: RuntimeProviderPreset,
  page = 0,
): { text: string; keyboard: TelegramInlineKeyboard } {
  return tsBuildTelegramSetupModelPanel(chatJid, preset, page);
}

function buildTelegramSetupEndpointPanel(chatJid: string): {
  text: string;
  keyboard: TelegramInlineKeyboard;
} {
  return tsBuildTelegramSetupEndpointPanel(chatJid);
}

function buildTelegramSetupApiKeyPanel(chatJid: string): {
  text: string;
  keyboard: TelegramInlineKeyboard;
} {
  return tsBuildTelegramSetupApiKeyPanel(chatJid);
}

function pruneTelegramSettingsPanelActions(): void {
  tsPruneTelegramSettingsPanelActions();
}

function registerTelegramSettingsPanelAction(
  chatJid: string,
  action: TelegramSettingsPanelAction,
): string {
  return tsRegisterTelegramSettingsPanelAction(chatJid, action);
}

function getTelegramSettingsPanelAction(
  chatJid: string,
  callbackData: string,
): TelegramSettingsPanelAction | null {
  return tsGetTelegramSettingsPanelAction(chatJid, callbackData);
}

async function sendTelegramCoderKeyboard(params: {
  chatJid: string;
  text: string;
  keyboard: TelegramInlineKeyboard;
  fallbackText?: string;
}): Promise<void> {
  return tsSendTelegramCoderKeyboard(params, { isTelegramJid, sendMessage });
}

function buildCoderCommand(
  command: '/coder' | '/coder-plan',
  taskText: string,
): string {
  return tsBuildCoderCommand(command, taskText);
}

async function presentCoderSuggestion(params: {
  chatJid: string;
  taskText: string;
  requestId: string;
}): Promise<void> {
  return tsPresentCoderSuggestion(params, { isTelegramJid, sendMessage });
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
  return tsPrepareCoderTarget(
    { ...params, mainWorkspaceDir: MAIN_WORKSPACE_DIR },
    { isTelegramJid, sendMessage },
  );
}

async function createCoderProject(params: { slug: string }): Promise<{
  workspaceRoot: string;
  projectLabel: string;
  isGitRepo: boolean;
}> {
  return tsCreateCoderProject({ slug: params.slug, mainWorkspaceDir: MAIN_WORKSPACE_DIR });
}

function truncateButtonLabel(text: string, max = 28): string {
  return tsTruncateButtonLabel(text, max);
}

function formatTelegramSettingsPanelSummary(chatJid: string): string[] {
  return tsFormatTelegramSettingsPanelSummary(chatJid, { getEffectiveModelLabel });
}

function buildTelegramSettingsHomePanel(chatJid: string): {
  text: string;
  keyboard: TelegramInlineKeyboard;
} {
  return tsBuildTelegramSettingsHomePanel(chatJid, { getEffectiveModelLabel });
}

function buildTelegramModelProviderPanel(chatJid: string): {
  text: string;
  keyboard: TelegramInlineKeyboard;
} {
  return tsBuildTelegramModelProviderPanel(chatJid, { getEffectiveModelLabel });
}

function buildAddModelForProviderPanel(
  chatJid: string,
  provider: string,
): {
  text: string;
  keyboard: TelegramInlineKeyboard;
} {
  return tsBuildAddModelForProviderPanel(chatJid, provider);
}

function buildTelegramProviderModelPanel(
  chatJid: string,
  provider: string,
  page = 0,
): { text: string; keyboard: TelegramInlineKeyboard } {
  return tsBuildTelegramProviderModelPanel(chatJid, provider, page, { getEffectiveModelLabel });
}

function buildThinkPanel(chatJid: string): {
  text: string;
  keyboard: TelegramInlineKeyboard;
} {
  return tsBuildThinkPanel(chatJid);
}

function buildReasoningPanel(chatJid: string): {
  text: string;
  keyboard: TelegramInlineKeyboard;
} {
  return tsBuildReasoningPanel(chatJid);
}

function buildDeliveryPanel(chatJid: string): {
  text: string;
  keyboard: TelegramInlineKeyboard;
} {
  return tsBuildDeliveryPanel(chatJid);
}

function buildVerbosePanel(chatJid: string): {
  text: string;
  keyboard: TelegramInlineKeyboard;
} {
  return tsBuildVerbosePanel(chatJid);
}

function buildQueuePanel(chatJid: string): {
  text: string;
  keyboard: TelegramInlineKeyboard;
} {
  return tsBuildQueuePanel(chatJid);
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

function resolveKnowledgeRuntimeSnapshot(): {
  status: ReturnType<typeof readKnowledgeWikiStatus>;
  nightlyTaskStatus: string;
  nightlyTaskNextRun: string | null;
} {
  const status = readKnowledgeWikiStatus({ workspaceDir: MAIN_WORKSPACE_DIR });
  const nightlyTask = getTaskById(KNOWLEDGE_NIGHTLY_TASK_ID);
  return {
    status,
    nightlyTaskStatus: nightlyTask?.status || 'missing',
    nightlyTaskNextRun: nightlyTask?.next_run || null,
  };
}

function handleKnowledgeCommand(params: {
  action: string;
  input: string;
  chatJid: string;
}): string {
  const action = params.action.trim().toLowerCase();
  if (!action || action === 'status') {
    const snapshot = resolveKnowledgeRuntimeSnapshot();
    return formatKnowledgeWikiStatusText({
      status: snapshot.status,
      nightlyTaskStatus: snapshot.nightlyTaskStatus,
      nightlyTaskNextRun: snapshot.nightlyTaskNextRun,
    });
  }

  if (action === 'help') {
    return [
      'Usage: /knowledge <status|init|task|ingest|lint|help>',
      '',
      '- /knowledge status',
      '- /knowledge init',
      '- /knowledge task',
      '- /knowledge ingest <note text>',
      '- /knowledge lint',
    ].join('\n');
  }

  if (action === 'init') {
    const setup = ensureKnowledgeRuntimeSetup(params.chatJid);
    const snapshot = resolveKnowledgeRuntimeSnapshot();
    const lines = [
      'Knowledge wiki initialized.',
      `- created_paths: ${setup.createdPaths.length}`,
      `- nightly_task: ${setup.nightlyTask.status}`,
      `- nightly_next_run: ${setup.nightlyTask.nextRun || 'n/a'}`,
    ];
    if (setup.createdPaths.length > 0) {
      lines.push(
        '',
        'Created paths:',
        ...setup.createdPaths.map((entry) => `- ${entry}`),
      );
    }
    if (setup.nightlyTask.skippedReason) {
      lines.push('', `Task setup skipped: ${setup.nightlyTask.skippedReason}`);
    }
    lines.push(
      '',
      formatKnowledgeWikiStatusText({
        status: snapshot.status,
        nightlyTaskStatus: snapshot.nightlyTaskStatus,
        nightlyTaskNextRun: snapshot.nightlyTaskNextRun,
      }),
    );
    return lines.join('\n');
  }

  if (action === 'task') {
    const result = ensureKnowledgeNightlyTask({ mainChatJid: params.chatJid });
    if (!result.ensured) {
      return `Knowledge nightly task not created: ${result.skippedReason || 'unknown reason'}`;
    }
    return [
      `Knowledge nightly task ${result.created ? 'created' : 'already present'}.`,
      `- task_id: ${result.taskId}`,
      `- status: ${result.status}`,
      `- schedule: ${result.schedule}`,
      `- next_run: ${result.nextRun || 'n/a'}`,
    ].join('\n');
  }

  if (action === 'ingest' || action === 'capture') {
    if (!params.input.trim()) {
      return 'Usage: /knowledge ingest <note text>';
    }
    const capture = captureKnowledgeRawNote({
      workspaceDir: MAIN_WORKSPACE_DIR,
      text: params.input,
      source: params.chatJid,
    });
    return [
      'Knowledge raw capture saved.',
      `- path: ${capture.relativePath}`,
      `- captured_at: ${capture.capturedAt}`,
    ].join('\n');
  }

  if (action === 'lint') {
    const report = runKnowledgeWikiLint({ workspaceDir: MAIN_WORKSPACE_DIR });
    return [
      `Knowledge lint ${report.ok ? 'passed' : 'failed'}.`,
      `- report: ${report.reportRelativePath}`,
      `- errors: ${report.errors.length}`,
      `- warnings: ${report.warnings.length}`,
      '',
      report.text,
    ].join('\n');
  }

  return 'Usage: /knowledge <status|init|task|ingest|lint|help>';
}

function formatStatusText(chatJid?: string): string {
  const runtime = getContainerRuntime();
  const version = [
    APP_VERSION || 'unknown',
    GIT_INFO.branch && GIT_INFO.commit
      ? `${GIT_INFO.branch}@${GIT_INFO.commit}`
      : GIT_INFO.branch || GIT_INFO.commit || '',
  ]
    .filter(Boolean)
    .join(' ');
  const mainGroup = Object.values(state.registeredGroups).find(
    (group) => group.folder === MAIN_GROUP_FOLDER,
  );
  const tasks = getAllTasks();
  const active = tasks.filter((task) => task.status === 'active').length;
  const paused = tasks.filter((task) => task.status === 'paused').length;
  const completed = tasks.filter((task) => task.status === 'completed').length;
  const knowledgeSnapshot = resolveKnowledgeRuntimeSnapshot();
  const chatActiveRun = chatJid ? activeChatRuns.get(chatJid) || null : null;
  const durableActiveRuns = listActiveAgentRuns(chatJid);
  const agentRunning = chatJid
    ? chatActiveRun !== null ||
      durableActiveRuns.length > 0 ||
      Array.from(activeCoderRuns.values()).some(
        (run) =>
          run.chatJid === chatJid &&
          run.state !== 'completed' &&
          run.state !== 'failed' &&
          run.state !== 'aborted',
      )
    : activeChatRunsById.size > 0 ||
      durableActiveRuns.length > 0 ||
      activeCoderRuns.size > 0;
  return formatStatusReport({
    assistantName: ASSISTANT_NAME,
    version,
    runtime,
    coderGateMode: FFT_NANO_CODER_GATE_MODE,
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
    knowledge: {
      ready: knowledgeSnapshot.status.ready,
      rawCaptures: knowledgeSnapshot.status.rawCaptureCount,
      wikiDocs: knowledgeSnapshot.status.wikiDocCount,
      lastProgressUpdateAt: knowledgeSnapshot.status.lastProgressUpdateAt,
      nightlyTaskStatus: knowledgeSnapshot.nightlyTaskStatus,
      nightlyTaskNextRun: knowledgeSnapshot.nightlyTaskNextRun,
    },
    activeChatRuns: Array.from(activeChatRunsById.values()).map((run) => ({
      requestId: run.requestId,
      chatJid: run.chatJid,
      startedAt: run.startedAt,
    })),
    activeLongRuns: durableActiveRuns.map((run) => ({
      id: run.id,
      chatJid: run.chat_jid,
      status: run.status as 'queued' | 'running',
      createdAt: Date.parse(run.created_at),
      startedAt: run.started_at ? Date.parse(run.started_at) : null,
      lastProgressAt: run.last_progress_at
        ? Date.parse(run.last_progress_at)
        : null,
      phase: run.current_phase,
      detail: run.current_detail,
    })),
    activeCoderRuns: Array.from(activeCoderRuns.values()).map((run) => ({
      requestId: run.requestId,
      mode: run.mode,
      chatJid: run.chatJid,
      groupName: run.groupName,
      startedAt: run.startedAt,
      parentRequestId: run.parentRequestId,
      backend: run.backend,
      config: run.config,
      state: run.state,
      worktreePath: run.worktreePath,
    })),
    telemetry: statusTelemetry.getSnapshot(),
    agentRunning,
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
    case 'show-groups':
      return buildTelegramGroupsPanel(chatJid);
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
  return formatActiveSubagentsTextImpl();
}

const longRunService = createLongRunService({
  getGroupForChat: (chatJid) => state.registeredGroups[chatJid],
  isMainChat,
  getSessionKeyForChat,
  sendMessage,
  sendAgentResultMessage,
  setTyping,
  persistAssistantHistory,
  updateChatUsage,
  emitRunProgress: (payload) => {
    hostEventBus.publish({
      kind: 'run_progress',
      id: createHostEventId('progress'),
      createdAt: new Date().toISOString(),
      source: 'long-run-service',
      runId: payload.requestId,
      sessionKey: getSessionKeyForChat(payload.chatJid),
      chatJid: payload.chatJid,
      phase: payload.phase,
      text: payload.text,
      ...(payload.detail ? { detail: payload.detail } : {}),
    });
  },
  emitTuiChatEvent,
  emitTuiAgentEvent,
  runAgent,
  getRuntimePrefs: (chatJid) => state.chatRunPreferences[chatJid] || {},
  noteRunSettled: noteContinuityRunSettled,
  logger,
});

function getCodingOrchestrator(): ReturnType<typeof createCodingOrchestrator> {
  return getCodingOrchestratorImpl();
}

async function runCodingTask(
  params: Omit<CodingWorkerRequest, 'workspaceRoot'> & {
    workspaceRoot?: string;
  },
) {
  return runCodingTaskImpl(params);
}

async function maybeRunCompactionMemoryFlush(
  chatJid: string,
  group: RegisteredGroup,
): Promise<void> {
  return maybeRunCompactionMemoryFlushImpl(chatJid, group);
}

async function runCompactionForChat(
  chatJid: string,
  instructions: string,
): Promise<string> {
  return runCompactionForChatImpl(chatJid, instructions);
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

async function handleSkillManagerCommand(params: {
  action: string;
  input: string;
  chatJid: string;
}): Promise<string> {
  return handleSkillManagerCommandImpl(params);
}

function handleLibrarianCommand(params: {
  action: string;
  input: string;
  chatJid: string;
}): string {
  return handleLibrarianCommandImpl(params, {
    resolveKnowledgeRuntimeSnapshot,
    handleKnowledgeCommand,
  });
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
  handleLongRunCommand: (chatJid, content) =>
    longRunService.handleCommand(chatJid, content),
  summarizeTask,
  formatTaskRunsText,
  handleKnowledgeCommand,
  handleSkillManagerCommand,
  handleLibrarianCommand,
  runPiListModels,
  validateProviderModelRef,
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
  approveTelegramGroup,
  ignoreTelegramGroup,
  unignoreTelegramGroup,
  runGatewayServiceCommand,
  runUpdateCommand,
  startUpdateCommand: (chatJid) =>
    startDetachedUpdateCommand({
      cwd: process.cwd(),
      chatJid,
    }),
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
  emitRunProgress: (payload) => {
    hostEventBus.publish({
      kind: 'run_progress',
      id: createHostEventId('progress'),
      createdAt: new Date().toISOString(),
      source: 'telegram-command',
      runId: payload.requestId,
      sessionKey: getSessionKeyForChat(payload.chatJid),
      chatJid: payload.chatJid,
      phase: payload.phase,
      text: payload.text,
      ...(payload.detail ? { detail: payload.detail } : {}),
    });
  },
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
    const resolved = resolvePendingConfirmation(pgRequestId, { confirmed });
    const expired = resolved ? null : getExpiredConfirmation(pgRequestId);
    const bot = state.telegramBot;
    if (bot) {
      try {
        await bot.answerCallbackQuery?.(
          q.id,
          resolved
            ? undefined
            : expired
              ? 'This approval request has expired.'
              : 'This approval request is no longer active.',
        );
      } catch {
        // Ignore duplicate callback acknowledgements.
      }
      if (!resolved) {
        logger.warn(
          {
            requestId: pgRequestId,
            chatJid: q.chatJid,
            expiredReason: expired?.reason,
          },
          'Ignoring stale permission gate callback',
        );
        return;
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
    const response = await promise;
    const expired = getExpiredConfirmation(request.id);
    if (response.confirmed === false && expired?.reason === 'timeout') {
      await state.telegramBot.sendMessage(
        chatJid,
        `Permission request timed out and was auto-denied: ${request.title ?? 'Action'}`,
      );
    }
    return response;
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

// ContinuityLedgerEntry, continuityLedger, getContinuityLedgerEntry,
// summarizeObjective, noteContinuityRunStarted, noteContinuityRunSettled,
// noteDeliveryPending, noteDeliverySettled, buildUnresolvedWorkSummary
// — moved to agent-runner.ts (imported above)

// writeJsonAtomic is imported from ./state-persistence.js

const messageDispatcher = createMessageDispatcher({
  state,
  constants: {
    assistantName: ASSISTANT_NAME,
    mainGroupFolder: MAIN_GROUP_FOLDER,
    triggerPattern: TRIGGER_PATTERN,
    tuiSenderName: TUI_SENDER_NAME,
    mainWorkspaceDir: MAIN_WORKSPACE_DIR,
    coderGateMode: FFT_NANO_CODER_GATE_MODE,
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
  handleLongRunCommand: (chatJid, content) =>
    longRunService.handleCommand(chatJid, content),
  startLongRun: (chatJid, prompt, options) =>
    longRunService.startRun(chatJid, prompt, options),
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
  sanitizeRunPreferences: sanitizeRunPreferencesModelOverride,
  parseDelegationTrigger,
  isSubstantialCodingTask,
  shouldSuggestCodingEscalation,
  presentCoderSuggestion,
  prepareCoderTarget,
  createCoderProject,
  isCoderDelegationCommand,
  onboardingCommandBlockedText,
  makeRunId,
  logger,
  persistTuiUserHistory,
  getUnresolvedWorkSummary: buildUnresolvedWorkSummary,
  noteRunStarted: noteContinuityRunStarted,
  noteRunSettled: noteContinuityRunSettled,
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
    groupSyncIntervalMs: 24 * 60 * 60 * 1000,
    pollInterval: POLL_INTERVAL,
    heartbeatActiveHoursRaw: HEARTBEAT_ACTIVE_HOURS_RAW,
    heartbeatActiveHours: HEARTBEAT_ACTIVE_HOURS,
    dataDir: DATA_DIR,
    fftProfile: FFT_PROFILE,
    featureFarm: FEATURE_FARM,
    farmStateEnabled: FARM_STATE_ENABLED,
    profileDetection: PROFILE_DETECTION,
    whatsappEnabled: WHATSAPP_ENABLED,
    onboardingMode: FFT_NANO_ONBOARDING_MODE,
    mainWorkspaceDir: MAIN_WORKSPACE_DIR,
  },
  createTelegramBot,
  refreshTelegramCommandMenus,
  handleTelegramCallbackQuery,
  handleTelegramSetupInput,
  handleTelegramCommand,
  handleTelegramUnknownGroup,
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
  startHeartbeatLoop: () =>
    startHeartbeatLoop({
      findMainChatJid,
      findMainTelegramChatJid,
      parseTelegramTargetJid,
      runAgent,
      setTyping,
      sendMessage,
      updateChatUsage,
    }),
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

// toSkillManagerConfig, skillSelfImproveStatePath, readSkillSelfImproveState,
// writeSkillSelfImproveState, shouldTriggerSkillSelfImprove, runQuietSkillAgent,
// maybeRunSkillSelfImprovement, maybeRunSkillManager — moved to skill-service.ts

async function runAgent(
  group: RegisteredGroup,
  prompt: string,
  chatJid: string,
  codingHint: CodingHint = 'none',
  requestId?: string,
  runtimePrefs: ChatRunPreferences = {},
  options: {
    suppressErrorReply?: boolean;
    isHeartbeatTask?: boolean;
    suppressPreviewStreaming?: boolean;
    skipSkillMaintenance?: boolean;
    lifecyclePolicyOverride?: ContainerInput['lifecyclePolicyOverride'];
    onProgressEvent?: (event: ContainerProgressEvent) => void;
  } = {},
  abortSignal?: AbortSignal,
) {
  return runAgentImpl(group, prompt, chatJid, codingHint, requestId, runtimePrefs, options, abortSignal);
}

function createTuiGatewayAdapters(): TuiGatewayAdapters {
  return tuiCreateGatewayAdapters(hostEventBus, getTuiCoordinationDeps());
}

function getWebControlCenterDeps(): WebControlCenterDeps {
  return {
    getRuntimeConfigEnv,
    persistRuntimeConfigUpdates,
    ensureWebOnboardingAdminSecret,
    buildOnboardingStatus,
    applyWebOnboardingConfig,
    loadPiModels,
    resolveChatJidForSessionKey,
    getTuiSessionPrefs,
    buildTuiSessionList,
    getSessionKeyForChat,
    gitInfo: GIT_INFO,
  };
}

const PROVIDER_SETUP_URLS = webProviderSetupUrls;

function getControlCenterProviderSetup() {
  return webGetProviderSetup();
}

function getControlCenterRuntimeSettings() {
  return webGetRuntimeSettings(getWebControlCenterDeps());
}

function applyControlCenterRuntimeSettings(payload: {
  providerPreset?: string;
  model?: string;
  apiKey?: string;
  endpoint?: string;
  clearEndpoint?: boolean;
  telegramBotToken?: string;
  whatsappEnabled?: boolean;
  heartbeatEnabled?: boolean;
  heartbeatEvery?: string;
}): { ok: boolean; requiresRestart: boolean; adminSecret?: string } {
  return webApplyRuntimeSettings(payload, getWebControlCenterDeps());
}

function buildControlCenterSystemPromptPreview(payload: {
  sessionKey?: string;
  mode?: 'normal' | 'scheduled' | 'heartbeat' | 'evaluator';
}) {
  return webBuildSystemPromptPreview(payload, getWebControlCenterDeps());
}

function listControlCenterTasks() {
  return webListTasks();
}

function performControlCenterTaskAction(payload: {
  id?: string;
  action?: 'pause' | 'resume' | 'cancel' | 'trigger';
}) {
  return webPerformTaskAction(payload);
}

function getControlCenterPipelines() {
  return webGetPipelines();
}

function getControlCenterMemoryOverview() {
  return webGetMemoryOverview();
}

function getControlCenterKnowledgeStatus() {
  return webGetKnowledgeStatus();
}

function createWebControlCenterAdapters(): WebControlCenterAdapters {
  return webCreateAdapters(getWebControlCenterDeps());
}
async function startTuiGatewayService(): Promise<void> {
  return tuiStartGatewayService(hostEventBus, getTuiCoordinationDeps());
}

async function stopTuiGatewayService(): Promise<void> {
  return tuiStopGatewayService();
}

async function startWebControlCenterService(): Promise<void> {
  return webStartService(getWebControlCenterDeps());
}

async function stopWebControlCenterService(): Promise<void> {
  return webStopService();
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

  if (
    shouldUseTelegramPreviewToolTrail({
      deliveryMode,
      verboseMode: effectiveMode,
    })
  ) {
    const key = getTelegramToolProgressKey(chatJid, requestId);
    const trailEntry = buildTelegramPreviewToolTrailEntry(
      event,
      effectiveMode,
      telegramToolProgressRuns.get(key)?.lastToolName,
    );
    if (trailEntry) {
      telegramPreviewRegistry.appendToolTrail(
        getTelegramHostStreamKey(chatJid, requestId),
        trailEntry,
      );
    }
  }

  if (effectiveMode === 'new') return;

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
    const sent = await sendTelegramAgentReply(chatJid, text);
    logger.info(
      {
        chatJid,
        messageId,
        finalizeMode: 'send-full-reply',
        textLength: text.length,
      },
      'Telegram streaming preview finalized',
    );
    return sent;
  }

  const chunks = splitTelegramText(text);
  if (chunks.length === 0) {
    logger.info(
      { chatJid, messageId, finalizeMode: 'leave-existing-empty-final' },
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
      textLength: text.length,
    },
    'Telegram streaming preview finalized',
  );
  return true;
}

function buildHostCoordinationDeps(): HostCoordinationDeps {
  return {
    sendTelegramAgentReply,
    finalizeTelegramPreviewMessage,
    sendAgentResultMessage,
    noteDeliveryPending,
    noteDeliverySettled,
    statusTelemetry,
    getSessionKeyForChat,
    registerGroup,
    syncGroupMetadata,
    getAvailableGroups,
  };
}

// Wire agent-runner module with its dependencies
initAgentRunner({
  statusTelemetry,
  getSessionKeyForChat,
  emitTuiToolEvent,
  handlePermissionGateRequest,
  finalizeTelegramToolProgress,
  updateChatRunPreferences,
  updateChatUsage,
  setTyping,
  sendMessage,
});
setHostEventBusPublish((event) => hostEventBus.publish(event as HostEvent));

function getTelegramHostStreamKey(chatJid: string, requestId: string): string {
  return hcGetTelegramHostStreamKey(chatJid, requestId);
}

function consumeTelegramHostCompletedRun(
  chatJid: string,
  requestId: string,
): boolean {
  return hcConsumeHostCompletedRun(chatJid, requestId);
}

function consumeTelegramHostStreamState(
  chatJid: string,
  requestId: string,
) {
  return hcConsumeHostStreamState(chatJid, requestId);
}

function pruneTelegramHostStreamedRuns(): void {
  hcPruneTelegramHostStreamedRuns();
}

function getTelegramDeliveryMode(chatJid: string) {
  return hcGetTelegramDeliveryMode(chatJid);
}

async function deliverRuntimeAgentMessage(params: {
  chatJid: string;
  text: string;
  requestId?: string;
  prefixWhatsApp?: boolean;
}): Promise<void> {
  return hcDeliverRuntimeAgentMessage(params, buildHostCoordinationDeps());
}

async function prepareTelegramCompletionState(params: {
  chatJid: string;
  runId: string;
  result: string | null;
}) {
  return hcPrepareTelegramCompletionState(params);
}

async function processHostEvent(event: HostEvent): Promise<void> {
  return hcProcessHostEvent(event, buildHostCoordinationDeps());
}

function startIpcWatcher(): void {
  hcStartIpcWatcher(buildHostCoordinationDeps());
}

async function processTaskIpc(
  data: Parameters<typeof hcProcessTaskIpc>[0],
  sourceGroup: string,
  isMain: boolean,
): Promise<void> {
  return hcProcessTaskIpc(data, sourceGroup, isMain, buildHostCoordinationDeps());
}

async function connectWhatsApp(): Promise<void> {
  await appRuntime.connectWhatsApp();
}

async function startMessageLoop(): Promise<void> {
  await appRuntime.startMessageLoop();
}


function ensureContainerSystemRunning(): void {
  appRuntime.ensureContainerSystemRunning();
}

function stopFarmServicesForShutdown(signal: string): void {
  stopUpdateNotificationLoop();
  stopHeartbeatLoop();
  appRuntime.stopFarmServicesForShutdown(signal);
}

async function shutdownAndExit(
  signal: string,
  exitCode: number,
): Promise<void> {
  stopUpdateNotificationLoop();
  stopHeartbeatLoop();
  await appRuntime.shutdownAndExit(signal, exitCode);
}

function registerShutdownHandlers(): void {
  appRuntime.registerShutdownHandlers();
}

async function main(): Promise<void> {
  await appRuntime.main();
  startUpdateNotificationLoop({ sendMessage });
}

main().catch(async (err) => {
  stopFarmServicesForShutdown('startup_error');
  await stopWebControlCenterService();
  await stopTuiGatewayService();
  logger.error({ err }, 'Failed to start FFT_nano');
  process.exit(1);
});
