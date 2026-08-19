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
  FFT_NANO_ACP_ENABLED,
  FFT_NANO_ACP_STDIO,
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
import { recordTaskAuditEvent, type TaskAuditKind } from './task-audit.js';
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
  getRuntimeProviderDefinitionByPreset as tsGetRuntimeProviderDefinitionByPreset,
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
import { ensureDefaultMaintenanceTasks } from './scheduled-maintenance.js';
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
import { createAppRuntime, runLearningPauseBootWitness } from './app.js';
import {
  createAcpAgentApp,
  routePermissionRequestToAcp,
} from './acp/acp-gateway.js';
import { connectAcpStdio } from './acp/acp-stdio-transport.js';
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
import { createOutboxDeliverer } from './outbox.js';
import { initSelfImproveWitness } from './self-improve-signals.js';
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
  deleteTelegramPreviewMessage as tdDeleteTelegramPreviewMessage,
  finalizeTelegramPreviewMessage as tdFinalizeTelegramPreviewMessage,
  sanitizeFileName as tdSanitizeFileName,
  defaultExtensionForMedia as tdDefaultExtensionForMedia,
  persistTelegramMedia as tdPersistTelegramMedia,
  refreshTelegramCommandMenus as tdRefreshTelegramCommandMenus,
  logTelegramCommandAudit as tdLogTelegramCommandAudit,
  handlePermissionGateRequest as tdHandlePermissionGateRequest,
  handleAskUserRequest as tdHandleAskUserRequest,
  handleTelegramCallbackQuery as tdHandleTelegramCallbackQuery,
  formatStatusText as tdFormatStatusText,
  summarizeTask as tdSummarizeTask,
  formatTaskRunsText as tdFormatTaskRunsText,
  formatTasksText as tdFormatTasksText,
  formatPendingTasksText as tdFormatPendingTasksText,
  formatLearningDigest as tdFormatLearningDigest,
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
  registerPendingTaskToken as tsRegisterPendingTaskToken,
  getPendingTaskToken as tsGetPendingTaskToken,
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
  // SPEC-06: reconcile the default maintenance task list (nightly-lint +
  // weekly-librarian + weekly-reflect) at boot, in addition to the
  // knowledge-wiki-task idempotent constructor. Idempotent: a no-op when
  // every default task already exists, never overwrites consecutive_errors
  // / status on existing rows.
  const maintenanceSeed = ensureDefaultMaintenanceTasks({
    mainChatJid,
  });
  if (maintenanceSeed.created > 0) {
    logger.info(
      {
        created: maintenanceSeed.created,
        existing: maintenanceSeed.existing,
        taskIds: maintenanceSeed.taskIds,
      },
      'Seeded default maintenance tasks at boot',
    );
  } else if (maintenanceSeed.skippedReason) {
    logger.debug(
      { reason: maintenanceSeed.skippedReason },
      'Default maintenance reconciliation skipped at boot',
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
    executeOperatorCommand,
  };
}

function formatTuiSessionTitleCommand(chatJid: string, args: string): string {
  const argText = args.trim();
  const currentTitle = (
    state.chatRunPreferences[chatJid]?.sessionTitle || ''
  ).trim();
  if (!argText) {
    return currentTitle
      ? `Session title: ${currentTitle}`
      : 'Session title is not set for this chat.';
  }

  const lowered = argText.toLowerCase();
  if (['reset', 'clear', 'default', 'off'].includes(lowered)) {
    updateChatRunPreferences(chatJid, (prefs) => {
      delete prefs.sessionTitle;
      return prefs;
    });
    return 'Session title cleared.';
  }

  const normalized = argText.replace(/\s+/g, ' ').trim();
  const maxSessionTitleLength = 120;
  const truncationSuffix = '...';
  const bounded =
    normalized.length > maxSessionTitleLength
      ? `${normalized
          .slice(0, maxSessionTitleLength - truncationSuffix.length)
          .trimEnd()}${truncationSuffix}`
      : normalized;
  updateChatRunPreferences(chatJid, (prefs) => {
    prefs.sessionTitle = bounded;
    return prefs;
  });
  return `Session title set: ${bounded}`;
}

function formatTuiRefreshModelsCommand(): { ok: boolean; text: string } {
  const refreshed = loadPiModels(true);
  if (!refreshed.ok) {
    return { ok: false, text: `Refresh failed: ${refreshed.text}` };
  }

  const providerCounts = new Map<string, number>();
  for (const entry of refreshed.entries) {
    providerCounts.set(
      entry.provider,
      (providerCounts.get(entry.provider) || 0) + 1,
    );
  }
  const providerSummary = Array.from(providerCounts.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([provider, count]) => `${provider}: ${count}`)
    .join(', ');
  const warningText = refreshed.warnings?.length
    ? `\nWarnings:\n${refreshed.warnings.map((warning) => `- ${warning}`).join('\n')}`
    : '';
  return {
    ok: true,
    text: `Model list refreshed. ${refreshed.entries.length} models across ${providerCounts.size} providers.\n${providerSummary}${warningText}`,
  };
}

async function handleTuiLongRunCommand(
  chatJid: string,
  normalized: string,
  args: string,
): Promise<{ ok: boolean; text: string }> {
  if (!isMainChat(chatJid)) {
    return {
      ok: false,
      text: 'Long runs are only available in the main/admin session.',
    };
  }

  if (normalized === 'run') {
    const task = args.trim();
    if (!task) return { ok: false, text: 'Usage: /run <task>' };
    try {
      const run = await longRunService.startRun(chatJid, task);
      return {
        ok: true,
        text: `Started long run ${run.id}. Use /run_status ${run.id} to inspect it.`,
      };
    } catch (err) {
      const diagnostic = err instanceof Error ? err.message : String(err);
      return { ok: false, text: `Could not start long run: ${diagnostic}` };
    }
  }

  if (normalized === 'runs') {
    const recent = longRunService.listRunsText(chatJid);
    const active = listActiveAgentRuns(chatJid);
    if (active.length === 0) return { ok: true, text: recent };
    return {
      ok: true,
      text: [
        recent,
        '',
        'Active durable runs:',
        ...active.map(
          (run) =>
            `- ${run.id} [${run.status}] ${run.current_phase || 'running'}`,
        ),
      ].join('\n'),
    };
  }

  if (normalized === 'run_status') {
    const id = args.trim().split(/\s+/)[0];
    return {
      ok: Boolean(id),
      text: id
        ? longRunService.statusText(chatJid, id)
        : 'Usage: /run_status <id>',
    };
  }

  if (normalized === 'cancel_run') {
    const id = args.trim().split(/\s+/)[0];
    return {
      ok: Boolean(id),
      text: id
        ? await longRunService.cancelRun(chatJid, id)
        : 'Usage: /cancel_run <id>',
    };
  }

  return { ok: false, text: `Unsupported long run command: /${normalized}` };
}

function buildTuiReflectionAgentPrompt(
  action: 'run' | 'dry-run',
  input: string,
): string {
  const dryRun = action === 'dry-run';
  return [
    dryRun
      ? 'Operator-triggered self-reflection (dry-run). Review the recent conversation in this chat and report what - if anything - you would save as durable learning, but do not write memory or mutate any skill.'
      : 'Operator-triggered self-reflection. Review the recent conversation in this chat and save only genuinely durable, reusable learning.',
    '',
    'Being asked to reflect is permission to look - it is NOT evidence that there is anything to save. Be exactly as selective as an automatic post-turn review. If there is no durable, reusable lesson, say so plainly and change nothing; a clean no-op is the correct and expected outcome.',
    '',
    'How to classify what you find:',
    '- Durable facts, preferences, environment details, project/farm state -> write to memory (MEMORY.md / memory files).',
    '- Reusable procedures, pitfalls with a reusable recovery, command sequences, troubleshooting recipes, or task-class behavior -> create or patch an agent-owned runtime skill via skill_action.',
    '- Prefer patching an existing relevant agent-created skill over creating a near-duplicate. Create broad class-level skills, not narrow one-offs.',
    '- A user correction that changes how future work should be done is durable - capture it as procedural guidance.',
    '',
    'Do NOT save:',
    '- One-off task narratives, raw transcripts, or "remember that this happened" notes.',
    '- Transient or environment outages without a reusable recovery path.',
    '- Speculation or anything you are not confident is reusable.',
    '',
    'Safety:',
    '- All skill writes go through skill_action. Never edit skill files directly.',
    '- Never mutate source-owned project skills or personal override skills; report those gaps in your summary instead.',
    dryRun
      ? '- Dry-run: do not call mutating skill actions (skill_patch/skill_archive/skill_restore/skill_pin/skill_unpin) and do not write memory; describe what you would save and why.'
      : '- Live: use memory writes and skill_action for anything genuinely durable, and summarize each write with its rationale.',
    '',
    'Final answer: a concise summary of what you saved and why, or an explicit "nothing durable to save" with a one-line reason.',
    input ? ['', 'Operator focus:', input] : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function formatElapsedSeconds(startedAt: number): string {
  return `${Math.max(0, Math.round((Date.now() - startedAt) / 1000))}s`;
}

function startTuiReflectionCommand(
  chatJid: string,
  args: string,
): { ok: boolean; text: string } {
  if (!isMainChat(chatJid)) {
    return { ok: false, text: 'Reflection requires the main session.' };
  }
  const [firstRaw = '', ...rest] = args.trim().split(/\s+/);
  const first = firstRaw.toLowerCase();
  if (first === 'help') {
    return {
      ok: true,
      text: [
        'Usage: /reflect [dry-run] [focus]',
        '',
        'Runs deliberate self-reflection on recent conversation and saves only genuinely durable learning.',
        '- /reflect',
        '- /reflect <focus>',
        '- /reflect dry-run [focus]',
      ].join('\n'),
    };
  }

  const isDryRun = first === 'dry-run' || first === 'dry';
  const action: 'run' | 'dry-run' = isDryRun ? 'dry-run' : 'run';
  if (action === 'run' && state.learningPaused) {
    return {
      ok: false,
      text: 'Learning is paused. Run /learning resume first, or use /reflect dry-run.',
    };
  }
  const focus = (isDryRun ? rest : args.trim().split(/\s+/)).join(' ').trim();
  const group = state.registeredGroups[chatJid];
  if (!group) return { ok: false, text: 'Chat is not registered.' };
  const existingRun = activeChatRuns.get(chatJid);
  if (existingRun) {
    return {
      ok: false,
      text: `Cannot start reflection while another run is active (${existingRun.requestId || 'unknown'}). Use /stop first.`,
    };
  }

  const requestId = makeRunId('reflect');
  const abortController = new AbortController();
  const activeRun = {
    chatJid,
    startedAt: Date.now(),
    requestId,
    abortController,
  };
  activeChatRuns.set(chatJid, activeRun);
  activeChatRunsById.set(requestId, activeRun);
  const sessionKey = getSessionKeyForChat(chatJid);
  emitTuiChatEvent({
    runId: requestId,
    sessionKey,
    state: 'message',
    message: {
      role: 'system',
      content: `Starting reflection ${action} (${requestId})...`,
    },
  });
  emitTuiAgentEvent({
    runId: requestId,
    sessionKey,
    phase: 'start',
    detail: `reflection ${action}`,
  });

  void (async () => {
    await setTyping(chatJid, true);
    try {
      const run = await runAgent(
        group,
        buildTuiReflectionAgentPrompt(action, focus),
        chatJid,
        'none',
        requestId,
        state.chatRunPreferences[chatJid] || {},
        { dryRun: action === 'dry-run', suppressPreviewStreaming: true },
        abortController.signal,
      );
      updateChatUsage(chatJid, run.usage);
      const elapsed = formatElapsedSeconds(activeRun.startedAt);
      if (!run.ok) {
        emitTuiChatEvent({
          runId: requestId,
          sessionKey,
          state: 'error',
          errorMessage: `Reflection ${action} failed (${requestId}, ${elapsed}).`,
        });
        emitTuiAgentEvent({
          runId: requestId,
          sessionKey,
          phase: 'error',
          detail: 'reflection failed',
        });
        return;
      }
      if (run.result) {
        persistAssistantHistory(chatJid, run.result, requestId);
        emitTuiChatEvent({
          runId: requestId,
          sessionKey,
          state: 'final',
          message: { role: 'assistant', content: run.result },
          usage: run.usage,
        });
      } else {
        emitTuiChatEvent({
          runId: requestId,
          sessionKey,
          state: 'final',
          message: {
            role: 'system',
            content: `Reflection ${action} complete (${requestId}, ${elapsed}) with no final text.`,
          },
          usage: run.usage,
        });
      }
      emitTuiAgentEvent({
        runId: requestId,
        sessionKey,
        phase: 'end',
        detail: run.streamed ? 'streamed' : 'complete',
      });
    } catch (err) {
      const diagnostic = err instanceof Error ? err.message : String(err);
      emitTuiChatEvent({
        runId: requestId,
        sessionKey,
        state: 'error',
        errorMessage: `Reflection ${action} failed: ${diagnostic}`,
      });
      emitTuiAgentEvent({
        runId: requestId,
        sessionKey,
        phase: 'error',
        detail: diagnostic,
      });
    } finally {
      if (activeChatRuns.get(chatJid) === activeRun) {
        activeChatRuns.delete(chatJid);
      }
      activeChatRunsById.delete(requestId);
      await setTyping(chatJid, false);
    }
  })();

  return {
    ok: true,
    text: `Started reflection ${action} (${requestId}).`,
  };
}

async function startTuiCoderPlanCommand(
  chatJid: string,
  args: string,
): Promise<{ ok: boolean; text: string }> {
  if (!isMainChat(chatJid)) {
    return {
      ok: false,
      text: `${ASSISTANT_NAME}: coder delegation is only available in the main/admin session for safety.`,
    };
  }
  if (resolveMainOnboardingGate(chatJid).active) {
    return { ok: false, text: onboardingCommandBlockedText() };
  }
  const taskText = args.trim();
  if (!taskText) return { ok: false, text: 'Usage: /coder_plan <task>' };
  const existingRun = activeChatRuns.get(chatJid);
  if (existingRun) {
    return {
      ok: false,
      text: `Cannot start coder plan while another run is active (${existingRun.requestId || 'unknown'}). Use /stop first.`,
    };
  }
  const group = state.registeredGroups[chatJid];
  if (!group) return { ok: false, text: 'Chat is not registered.' };

  const prepareRequestId = makeRunId('coder');
  const prepared = await prepareCoderTarget({
    chatJid,
    mode: 'plan',
    taskText,
    requestId: prepareRequestId,
  });
  if (prepared.status === 'handled') {
    return {
      ok: true,
      text: 'Coder plan needs a project selection before it can continue.',
    };
  }

  const requestId = makeRunId('coder');
  const abortController = new AbortController();
  const activeRun = {
    chatJid,
    startedAt: Date.now(),
    requestId,
    abortController,
  };
  activeChatRuns.set(chatJid, activeRun);
  activeChatRunsById.set(requestId, activeRun);
  const sessionKey = getSessionKeyForChat(chatJid);
  emitTuiChatEvent({
    runId: requestId,
    sessionKey,
    state: 'message',
    message: {
      role: 'system',
      content: `Starting coder plan run (${requestId}) for ${prepared.projectLabel}...`,
    },
  });
  emitTuiAgentEvent({
    runId: requestId,
    sessionKey,
    phase: 'start',
    detail: 'coder plan',
  });

  void (async () => {
    await setTyping(chatJid, true);
    try {
      const run = await runCodingTask({
        requestId,
        mode: 'plan',
        config: {
          toolMode: 'read_only',
          isSubagent: false,
          workspaceMode: 'read_only',
        },
        originChatJid: chatJid,
        originGroupFolder: group.folder,
        taskText: prepared.taskText,
        timeoutSeconds: 1800,
        allowFanout: false,
        sessionContext: `[APPROVED CODER PLAN REQUEST]\n${prepared.taskText}`,
        assistantName: ASSISTANT_NAME,
        sessionKey,
        group,
        workspaceRoot: prepared.workspaceRoot,
        runtimePrefs: state.chatRunPreferences[chatJid] || {},
        abortController,
      });
      updateChatUsage(chatJid, run.usage);
      if (!run.ok) {
        emitTuiChatEvent({
          runId: requestId,
          sessionKey,
          state: 'error',
          errorMessage: run.result || 'Coder plan failed.',
        });
        emitTuiAgentEvent({
          runId: requestId,
          sessionKey,
          phase: 'error',
          detail: 'coder plan failed',
        });
        return;
      }
      if (run.result) {
        persistAssistantHistory(chatJid, run.result, requestId);
        emitTuiChatEvent({
          runId: requestId,
          sessionKey,
          state: 'final',
          message: { role: 'assistant', content: run.result },
          usage: run.usage,
        });
      } else {
        emitTuiChatEvent({
          runId: requestId,
          sessionKey,
          state: 'final',
          message: {
            role: 'system',
            content: `Coder plan complete (${requestId}, ${formatElapsedSeconds(activeRun.startedAt)}) with no final text.`,
          },
          usage: run.usage,
        });
      }
      emitTuiAgentEvent({
        runId: requestId,
        sessionKey,
        phase: 'end',
        detail: run.streamed ? 'streamed' : 'complete',
      });
    } catch (err) {
      const diagnostic = err instanceof Error ? err.message : String(err);
      emitTuiChatEvent({
        runId: requestId,
        sessionKey,
        state: 'error',
        errorMessage: `Coder plan failed: ${diagnostic}`,
      });
      emitTuiAgentEvent({
        runId: requestId,
        sessionKey,
        phase: 'error',
        detail: diagnostic,
      });
    } finally {
      if (activeChatRuns.get(chatJid) === activeRun) {
        activeChatRuns.delete(chatJid);
      }
      activeChatRunsById.delete(requestId);
      await setTyping(chatJid, false);
    }
  })();

  return {
    ok: true,
    text: `Started coder plan run (${requestId}) for ${prepared.projectLabel}.`,
  };
}

async function executeOperatorCommand(
  chatJid: string,
  command: string,
  args: string,
): Promise<{ ok: boolean; text: string }> {
  const normalized = command
    .replace(/^\//, '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_');
  if (normalized === 'settings') {
    return {
      ok: true,
      text: [
        'Runtime controls:',
        ...formatChatRuntimePreferences(chatJid),
      ].join('\n'),
    };
  }
  if (normalized === 'status') {
    return { ok: true, text: formatStatusText(chatJid) };
  }
  if (normalized === 'title') {
    return { ok: true, text: formatTuiSessionTitleCommand(chatJid, args) };
  }
  if (normalized === 'models') {
    const listed = runPiListModels(args.trim());
    return { ok: listed.ok, text: listed.text };
  }
  if (normalized === 'refresh_models') {
    if (!isMainChat(chatJid)) {
      return { ok: false, text: 'Model refresh requires the main session.' };
    }
    return formatTuiRefreshModelsCommand();
  }
  if (normalized === 'usage') {
    return {
      ok: true,
      text: formatUsageText(chatJid, args.trim() === 'all' ? 'all' : 'chat'),
    };
  }
  if (normalized === 'queue') {
    if (!args.trim()) {
      return {
        ok: true,
        text:
          formatChatRuntimePreferences(chatJid).find((line) =>
            line.startsWith('- chat_queue:'),
          ) || 'Queue settings unavailable.',
      };
    }
    const parsed = parseQueueArgs(args);
    updateChatRunPreferences(chatJid, (prefs) => {
      if (parsed.reset) {
        delete prefs.queueMode;
        delete prefs.queueDebounceMs;
        delete prefs.queueCap;
        delete prefs.queueDrop;
      }
      if (parsed.mode) prefs.queueMode = parsed.mode;
      if (parsed.debounceMs !== undefined) {
        prefs.queueDebounceMs = parsed.debounceMs;
      }
      if (parsed.cap !== undefined) prefs.queueCap = parsed.cap;
      if (parsed.drop) prefs.queueDrop = parsed.drop;
      return prefs;
    });
    return {
      ok: true,
      text:
        formatChatRuntimePreferences(chatJid).find((line) =>
          line.startsWith('- chat_queue:'),
        ) || 'Queue settings updated.',
    };
  }
  if (normalized === 'compact') {
    return { ok: true, text: await runCompactionForChat(chatJid, args) };
  }
  if (normalized === 'tasks') {
    if (!isMainChat(chatJid)) {
      return { ok: false, text: 'Task controls require the main session.' };
    }
    const [action = 'list', taskId] = args.trim().split(/\s+/);
    if (action === 'list' || !args.trim()) {
      return { ok: true, text: formatTasksText('list') };
    }
    if (action === 'due') return { ok: true, text: formatTasksText('due') };
    if (action === 'detail' && taskId) {
      return { ok: true, text: summarizeTask(taskId) };
    }
    if (action === 'runs' && taskId) {
      return { ok: true, text: formatTaskRunsText(taskId) };
    }
    if (['pause', 'resume', 'cancel'].includes(action) && taskId) {
      if (!getTaskById(taskId)) {
        return { ok: false, text: `Task not found: ${taskId}` };
      }
      if (action === 'cancel') deleteTask(taskId);
      else
        updateTask(taskId, {
          status: action === 'pause' ? 'paused' : 'active',
        });
      return { ok: true, text: `${action}d task: ${taskId}` };
    }
    return {
      ok: false,
      text: 'Usage: /tasks [list|due|detail|runs|pause|resume|cancel] [taskId]',
    };
  }
  if (normalized === 'learning') {
    if (!isMainChat(chatJid)) {
      return { ok: false, text: 'Learning controls require the main session.' };
    }
    return { ok: true, text: formatLearningDigest() };
  }
  if (
    normalized === 'run' ||
    normalized === 'runs' ||
    normalized === 'run_status' ||
    normalized === 'cancel_run'
  ) {
    return handleTuiLongRunCommand(chatJid, normalized, args);
  }
  if (normalized === 'reflect') {
    return startTuiReflectionCommand(chatJid, args);
  }
  if (normalized === 'coder_plan') {
    return startTuiCoderPlanCommand(chatJid, args);
  }
  if (normalized === 'subagents') {
    return { ok: true, text: formatActiveSubagentsText() };
  }
  if (normalized === 'groups') {
    if (!isMainChat(chatJid)) {
      return { ok: false, text: 'Group controls require the main session.' };
    }
    return { ok: true, text: formatGroupsText() };
  }
  if (normalized === 'setup') {
    if (!isMainChat(chatJid)) {
      return { ok: false, text: 'Runtime setup requires the main session.' };
    }
    return {
      ok: true,
      text: ['Runtime setup:', ...getRuntimeConfigSummaryLines()].join('\n'),
    };
  }
  if (normalized === 'approvals') {
    if (!isMainChat(chatJid)) {
      return { ok: false, text: 'Approvals require the main session.' };
    }
    const pending = tdFormatPendingTasksText({
      registerToken: () => 'tui-read-only',
    });
    return { ok: true, text: pending.text };
  }
  if (normalized === 'skill_manager') {
    if (!isMainChat(chatJid)) {
      return {
        ok: false,
        text: 'Skill manager controls require the main session.',
      };
    }
    const [action = 'status', ...rest] = args.trim().split(/\s+/);
    return {
      ok: true,
      text: await handleSkillManagerCommand({
        action,
        input: rest.join(' '),
        chatJid,
      }),
    };
  }
  if (normalized === 'reload') {
    if (!isMainChat(chatJid)) {
      return { ok: false, text: 'Reload requires the main session.' };
    }
    await refreshTelegramCommandMenus();
    return { ok: true, text: 'Command menus and metadata refreshed.' };
  }
  if (normalized === 'knowledge') {
    if (!isMainChat(chatJid)) {
      return {
        ok: false,
        text: 'Knowledge controls require the main session.',
      };
    }
    const [action = 'status', ...rest] = args.trim().split(/\s+/);
    return {
      ok: true,
      text: handleKnowledgeCommand({
        action,
        input: rest.join(' '),
        chatJid,
      }),
    };
  }
  return {
    ok: false,
    text: `Unsupported TUI operator command: /${normalized}`,
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
):
  | { ok: true; entries: PiModelEntry[]; warnings?: string[] }
  | { ok: false; text: string } {
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

function parseProviderFromModelLabel(label: string): string | null {
  return tsParseProviderFromModelLabel(label);
}

function validateProviderModelRef(
  provider: string,
  model: string,
): { ok: true; warning?: string } | { ok: false; text: string } {
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
  return tsCreateCoderProject({
    slug: params.slug,
    mainWorkspaceDir: MAIN_WORKSPACE_DIR,
  });
}

function truncateButtonLabel(text: string, max = 28): string {
  return tsTruncateButtonLabel(text, max);
}

function formatTelegramSettingsPanelSummary(chatJid: string): string[] {
  return tsFormatTelegramSettingsPanelSummary(chatJid, {
    getEffectiveModelLabel,
  });
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
  return tsBuildTelegramProviderModelPanel(chatJid, provider, page, {
    getEffectiveModelLabel,
  });
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
  return tsBuildSubagentsPanel(chatJid, { formatActiveSubagentsText });
}

function runGatewayServiceCommand(action: 'status' | 'restart' | 'doctor'): {
  ok: boolean;
  text: string;
} {
  return tdRunGatewayServiceCommand(action);
}

function resolveKnowledgeRuntimeSnapshot(): {
  status: ReturnType<typeof readKnowledgeWikiStatus>;
  nightlyTaskStatus: string;
  nightlyTaskNextRun: string | null;
} {
  return tdResolveKnowledgeRuntimeSnapshot();
}

function handleKnowledgeCommand(params: {
  action: string;
  input: string;
  chatJid: string;
}): string {
  return tdHandleKnowledgeCommand(params);
}

function formatStatusText(chatJid?: string): string {
  return tdFormatStatusText(chatJid, {
    formatChatRuntimePreferences,
    statusTelemetry,
    coderGateMode: FFT_NANO_CODER_GATE_MODE,
    whatsappEnabled: WHATSAPP_ENABLED,
  });
}

function summarizeTask(taskId: string): string {
  return tdSummarizeTask(taskId);
}

function formatTaskRunsText(taskId: string, limit = 10): string {
  return tdFormatTaskRunsText(taskId, limit);
}

function formatTasksText(mode: 'list' | 'due' = 'list'): string {
  return tdFormatTasksText(mode);
}

function formatLearningDigest(): string {
  return tdFormatLearningDigest();
}

function buildAdminPanelKeyboard(): TelegramInlineKeyboard {
  return tsBuildAdminPanelKeyboard();
}

function resolveTelegramSettingsPanel(
  chatJid: string,
  action: TelegramSettingsPanelAction,
): { text: string; keyboard: TelegramInlineKeyboard } {
  return tsResolveTelegramSettingsPanel(chatJid, action, {
    getEffectiveModelLabel,
    formatActiveSubagentsText,
    buildTelegramGroupsPanel,
    isMainChat,
  });
}

async function sendTelegramSettingsPanel(
  chatJid: string,
  action: TelegramSettingsPanelAction = { kind: 'show-home' },
): Promise<void> {
  return tsSendTelegramSettingsPanel(chatJid, action, {
    getEffectiveModelLabel,
    formatActiveSubagentsText,
    buildTelegramGroupsPanel,
  });
}

async function editTelegramSettingsPanel(
  chatJid: string,
  messageId: number,
  action: TelegramSettingsPanelAction,
): Promise<void> {
  return tsEditTelegramSettingsPanel(chatJid, messageId, action, {
    getEffectiveModelLabel,
    formatActiveSubagentsText,
    buildTelegramGroupsPanel,
  });
}

async function promptTelegramSetupInput(
  chatJid: string,
  kind: TelegramSetupInputKind,
  prompt: string,
): Promise<void> {
  return tsPromptTelegramSetupInput(chatJid, kind, prompt, sendMessage);
}

function formatActiveSubagentsText(): string {
  return formatActiveSubagentsTextImpl();
}

const longRunService = createLongRunService({
  getGroupForChat: (chatJid) => state.registeredGroups[chatJid],
  resolveWorkspacePath: (group) =>
    group.folder === MAIN_GROUP_FOLDER
      ? MAIN_WORKSPACE_DIR
      : resolveGroupFolderPath(group.folder),
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

// Durable at-least-once delivery for non-interactive outputs (cron announces).
// Shares the delivery_outbox table, so the startup flush and the cron path see
// the same pending entries.
const outboxDeliverer = createOutboxDeliverer({ sendMessage, logger });

// SPEC-02 witness #3: gives recordSelfImproveEvent a way to notify the main
// chat after 10 consecutive learning-paused no-ops without self-improve-
// signals.ts importing the transport layer directly.
initSelfImproveWitness({ outbox: outboxDeliverer, findMainChatJid });

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
  return tdSanitizeFileName(value);
}

function defaultExtensionForMedia(message: TelegramInboundMessage): string {
  return tdDefaultExtensionForMedia(message);
}

async function persistTelegramMedia(
  message: TelegramInboundMessage,
): Promise<string> {
  return tdPersistTelegramMedia(message);
}

async function refreshTelegramCommandMenus(): Promise<void> {
  return tdRefreshTelegramCommandMenus();
}

function logTelegramCommandAudit(
  chatJid: string,
  command: string,
  allowed: boolean,
  reason: string,
  updateId?: number,
  messageId?: number,
): void {
  tdLogTelegramCommandAudit(chatJid, command, allowed, reason, updateId, messageId);
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
  setTelegramSetupInputState: tsSetTelegramSetupInputState,
  setTelegramSetupInputProvider,
  getTelegramSetupInputState,
  getTelegramSettingsPanelAction,
  updateChatRunPreferences,
  isMainChat,
  formatTasksText,
  formatGroupsText,
  formatStatusText,
  formatLearningDigest,
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
  loadPiModels,
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
  getRuntimeProviderDefinitionByPreset: tsGetRuntimeProviderDefinitionByPreset as any,
  getRuntimeConfigEnv,
  hasMeaningfulSecret,
  persistRuntimeConfigUpdates,
  resolveRuntimeConfigSnapshot,
  registerTelegramSettingsPanelAction,
  buildAdminPanelKeyboard,
  getTaskById,
  updateTask,
  deleteTask,
  formatPendingTasksText: tdFormatPendingTasksText,
  registerPendingTaskToken: tsRegisterPendingTaskToken,
  getPendingTaskToken: tsGetPendingTaskToken,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  recordTaskAuditEvent: recordTaskAuditEvent as any,
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
  return tdHandleTelegramCallbackQuery(q, { telegramCommandHandlers });
}

async function handlePermissionGateRequest(
  chatJid: string,
  request: ExtensionUIRequest,
): Promise<ExtensionUIResponse> {
  return tdHandlePermissionGateRequest(chatJid, request);
}

async function handleTelegramSetupInput(m: {
  chatJid: string;
  content: string;
  messageId?: number;
}): Promise<boolean> {
  return telegramCommandHandlers.handleTelegramSetupInput(m);
}

async function handleTelegramCommand(m: {
  chatJid: string;
  chatName: string;
  content: string;
  updateId?: number;
  messageId?: number;
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
  markTriggerHintSent: (chatJid: string) => {
    updateChatRunPreferences(chatJid, (prefs) => {
      prefs.triggerHintSent = true;
      return prefs;
    });
  },
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
  startSchedulerLoop: (schedulerDeps) =>
    startSchedulerLoop({ ...schedulerDeps, outbox: outboxDeliverer }),
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
  startAcpGatewayService,
  startTuiGatewayService,
  startWebControlCenterService,
  stopTuiGatewayService,
  stopAcpGatewayService,
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
  resumeRecoverableLongRuns: () => longRunService.resumeRecoverableRuns(),
  flushDeliveryOutbox: () => outboxDeliverer.flushPending(),
  runLearningPauseBootWitness: () =>
    runLearningPauseBootWitness({
      state,
      outbox: outboxDeliverer,
      findMainChatJid,
      logger,
    }),
  runCuratorTick: () => {
    try {
      const mainChatJid = findMainChatJid();
      if (!mainChatJid) return;
      const group = state.registeredGroups[mainChatJid];
      if (!group) return;
      // SPEC-06: hourly reconciliation — a default task that an operator
      // cancelled via /tasks cancel will reappear within one curator tick.
      ensureDefaultMaintenanceTasks({ mainChatJid });
      maybeRunSkillManager({
        group,
        chatJid: mainChatJid,
        runtimePrefs: state.chatRunPreferences[mainChatJid] || {},
        requestId: `curator-loop-${Date.now()}`,
      });
    } catch (err) {
      logger.warn({ err }, 'Curator loop tick failed');
    }
  },
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
    dryRun?: boolean;
  } = {},
  abortSignal?: AbortSignal,
) {
  return runAgentImpl(
    group,
    prompt,
    chatJid,
    codingHint,
    requestId,
    runtimePrefs,
    options,
    abortSignal,
  );
}

function createTuiGatewayAdapters(): TuiGatewayAdapters {
  return tuiCreateGatewayAdapters(hostEventBus, getTuiCoordinationDeps());
}

let acpConnection: ReturnType<typeof connectAcpStdio> | null = null;

async function startAcpGatewayService(): Promise<boolean> {
  if (!FFT_NANO_ACP_ENABLED) return false;
  if (!FFT_NANO_ACP_STDIO) {
    throw new Error('Stable ACP currently requires FFT_NANO_ACP_STDIO=1');
  }
  if (acpConnection) return true;

  const tuiAdapters = createTuiGatewayAdapters();
  const agent = createAcpAgentApp(
    {
      findMainChatJid,
      sendPrompt: async ({ chatJid, text, requestId }) => {
        state.lastInboundAt = Date.now();
        await tuiAdapters.sendChat({
          chatJid,
          sessionKey: getSessionKeyForChat(chatJid),
          message: text,
          runId: requestId,
          deliver: false,
        });
      },
      abortChat: ({ chatJid, runId }) => {
        const active = activeChatRunsById.get(runId);
        if (active?.chatJid === chatJid) {
          active.abortController.abort(new Error('Aborted via ACP'));
          return true;
        }
        const queue = tuiMessageQueue.get(chatJid);
        const queuedIndex =
          queue?.findIndex((item) => item.runId === runId) ?? -1;
        if (!queue || queuedIndex < 0) return false;
        queue.splice(queuedIndex, 1);
        if (queue.length === 0) tuiMessageQueue.delete(chatJid);
        return true;
      },
      getHistory: async (chatJid) => {
        const history = getTuiSessionHistory(chatJid, 200);
        const messages: Array<{
          role: 'user' | 'assistant';
          text: string;
        }> = [];
        for (const message of history) {
          if (message.role === 'system') continue;
          messages.push({ role: message.role, text: message.text });
        }
        return messages;
      },
    },
    hostEventBus,
  );
  const connection = connectAcpStdio(agent);
  acpConnection = connection;
  void connection.closed.then(
    () => handleAcpConnectionClosed(connection, connection.transportError),
    (err) =>
      handleAcpConnectionClosed(connection, connection.transportError || err),
  );
  logger.info('ACP stdio gateway started');
  return true;
}

function handleAcpConnectionClosed(
  connection: NonNullable<typeof acpConnection>,
  error?: unknown,
): void {
  if (acpConnection !== connection) return;
  acpConnection = null;
  if (error) {
    logger.error({ err: error }, 'ACP stdio connection closed with an error');
  }
  if (state.shuttingDown) return;
  void shutdownAndExit('ACP_STDIO_CLOSED', error ? 1 : 0).catch(
    (shutdownError) => {
      logger.error({ err: shutdownError }, 'ACP stdio shutdown failed');
      process.exit(1);
    },
  );
}

async function stopAcpGatewayService(): Promise<void> {
  if (!acpConnection) return;
  const connection = acpConnection;
  acpConnection = null;
  connection.close();
  await connection.closed;
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
async function startTuiGatewayService(): Promise<boolean> {
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
  return tdSendTelegramAgentReply(chatJid, text);
}

async function sendAgentResultMessage(
  chatJid: string,
  text: string,
  opts: { prefixWhatsApp?: boolean } = {},
): Promise<boolean> {
  return tdSendAgentResultMessage(chatJid, text, opts);
}

async function sendMessage(jid: string, text: string): Promise<boolean> {
  return tdSendMessage(jid, text);
}

export async function deleteTelegramPreviewMessage(
  chatJid: string,
  messageId: number,
  messageIds?: number[],
): Promise<void> {
  return tdDeleteTelegramPreviewMessage(chatJid, messageId, messageIds);
}

export async function finalizeTelegramPreviewMessage(
  chatJid: string,
  messageId: number,
  text: string,
  messageIds?: number[],
): Promise<boolean> {
  return tdFinalizeTelegramPreviewMessage(chatJid, messageId, text, messageIds);
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
    runCodingTask,
  };
}

// Dispatch extension UI requests by method. The agent-runner always calls
// a single onExtensionUIRequest callback regardless of request.method, so
// the host picks the right concrete handler here. Today the only methods
// are 'confirm' (permission gate) and 'select' (ask_user); unknown methods
// fall through to a logged no-op.
async function dispatchExtensionUIRequest(
  chatJid: string,
  request: ExtensionUIRequest,
): Promise<ExtensionUIResponse> {
  const activeRunId = activeChatRuns.get(chatJid)?.requestId;
  if (activeRunId) {
    const acpResponse = await routePermissionRequestToAcp(
      chatJid,
      activeRunId,
      request,
    );
    if (acpResponse) return acpResponse;
  }
  if (request.method === 'select') {
    return tdHandleAskUserRequest(chatJid, request);
  }
  return tdHandlePermissionGateRequest(chatJid, request);
}

// Wire agent-runner module with its dependencies
initAgentRunner({
  statusTelemetry,
  getSessionKeyForChat,
  emitTuiToolEvent,
  handlePermissionGateRequest: dispatchExtensionUIRequest,
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

function consumeTelegramHostStreamState(chatJid: string, requestId: string) {
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
  return hcProcessTaskIpc(
    data,
    sourceGroup,
    isMain,
    buildHostCoordinationDeps(),
  );
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

export async function main(): Promise<void> {
  await appRuntime.main();
  // Emit ready signal for CLI fft start command
  const readyMessage = `FFT_NANO_READY port=${FFT_NANO_TUI_PORT}`;
  if (FFT_NANO_ACP_ENABLED && FFT_NANO_ACP_STDIO) {
    console.error(readyMessage);
  } else {
    console.log(readyMessage);
    startUpdateNotificationLoop({ sendMessage });
  }
}

export async function handleStartupFailure(err: unknown): Promise<never> {
  stopFarmServicesForShutdown('startup_error');
  await stopWebControlCenterService();
  await stopTuiGatewayService();
  await stopAcpGatewayService();
  logger.error({ err }, 'Failed to start FFT_nano');
  process.exit(1);
}
