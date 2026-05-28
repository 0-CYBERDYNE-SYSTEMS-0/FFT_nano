import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

import {
  ASSISTANT_NAME,
  MAIN_GROUP_FOLDER,
  MAIN_WORKSPACE_DIR,
  GROUPS_DIR,
  TELEGRAM_MEDIA_MAX_MB,
} from './config.js';
import { logger } from './logger.js';
import {
  isTelegramJid,
  splitTelegramText,
  parseTelegramChatId,
} from './telegram.js';
import type { TelegramInboundMessage } from './telegram.js';
import {
  buildTelegramMediaStoragePaths,
  extractTelegramAttachmentHints as extractTelegramAttachmentHintsFromReply,
  resolveTelegramAttachments as resolveTelegramAttachmentsFromReply,
  sendResolvedTelegramAttachments,
} from './telegram-attachments.js';
import {
  TELEGRAM_COMMON_COMMANDS,
  TELEGRAM_ADMIN_COMMANDS,
} from './telegram-command-spec.js';
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
  state,
  telegramPreviewRegistry,
  telegramToolProgressRuns,
  activeChatRuns,
  activeChatRunsById,
  activeCoderRuns,
  type TelegramDeliveryMode,
} from './app-state.js';
import { getEffectiveVerboseMode } from './verbose-mode.js';
import type { VerboseMode } from './verbose-mode.js';
import {
  getAllTasks,
  getDueTasks,
  getTaskById,
  getTaskRunLogs,
  listActiveAgentRuns,
} from './db.js';
import { APP_VERSION, SERVICE_STARTED_AT } from './app-state.js';
import { GIT_INFO } from './state-persistence.js';
import { getContainerRuntime } from './container-runtime.js';
import { formatStatusReport } from './status-report.js';
import {
  readKnowledgeWikiStatus,
  formatKnowledgeWikiStatusText,
  captureKnowledgeRawNote,
  runKnowledgeWikiLint,
} from './knowledge-wiki.js';
import {
  ensureKnowledgeNightlyTask,
  KNOWLEDGE_NIGHTLY_TASK_ID,
} from './knowledge-wiki-task.js';
import { ensureKnowledgeRuntimeSetup } from './telegram-group-mgmt.js';
import { findMainTelegramChatJid } from './telegram-group-mgmt.js';
import { resolveTelegramStreamCompletionState } from './telegram-streaming.js';
import {
  parsePermissionGateCallback,
  createPendingConfirmation,
  resolvePendingConfirmation,
  getExpiredConfirmation,
  shouldPromptPermissionGate,
} from './permission-gate-ui.js';
import type { ExtensionUIRequest, ExtensionUIResponse } from './pi-runner.js';
import type { TelegramInboundCallbackQuery } from './telegram.js';

const TELEGRAM_MEDIA_MAX_BYTES = TELEGRAM_MEDIA_MAX_MB * 1024 * 1024;

// --- sendMessage ---

export async function sendMessage(jid: string, text: string): Promise<boolean> {
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

// --- Telegram agent reply ---

export async function sendTelegramAgentReply(
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

export async function sendAgentResultMessage(
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

// --- Tool progress ---

export function queueTelegramToolProgressReaction(
  chatJid: string,
  requestId: string,
  event: { toolName: string; status: 'start' | 'ok' | 'error' },
  getTelegramHostStreamKey: (chatJid: string, requestId: string) => string,
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

export function queueTelegramToolProgressUpdate(
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
  getTelegramHostStreamKey: (chatJid: string, requestId: string) => string,
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

export async function finalizeTelegramToolProgress(
  chatJid: string,
  requestId: string,
): Promise<void> {
  await awaitTelegramToolProgressRun(
    telegramToolProgressRuns,
    getTelegramToolProgressKey(chatJid, requestId),
  );
}

// --- Preview message management ---

export async function deleteTelegramPreviewMessage(
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

export async function finalizeTelegramPreviewMessage(
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

// --- Media ---

export function sanitizeFileName(value: string): string {
  const base = value.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_');
  return base.slice(0, 80) || 'file';
}

export function defaultExtensionForMedia(
  message: TelegramInboundMessage,
): string {
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

export async function persistTelegramMedia(
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

// --- Command menus ---

export async function refreshTelegramCommandMenus(): Promise<void> {
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

export function logTelegramCommandAudit(
  chatJid: string,
  command: string,
  allowed: boolean,
  reason: string,
): void {
  logger.info({ chatJid, command, allowed, reason }, 'Telegram command audit');
}

// --- Permission gate ---

export async function handlePermissionGateRequest(
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

// --- Status / task text formatters ---

export interface FormatStatusDeps {
  formatChatRuntimePreferences: (chatJid: string) => string[];
  statusTelemetry: { getSnapshot: () => any };
  coderGateMode?: 'explicit' | 'autosuggest';
  whatsappEnabled: boolean;
}

export function formatStatusText(
  chatJid: string | undefined,
  deps: FormatStatusDeps,
): string {
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
  const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  return formatStatusReport({
    assistantName: ASSISTANT_NAME,
    version,
    runtime,
    coderGateMode: deps.coderGateMode,
    serviceStartedAt: SERVICE_STARTED_AT,
    incidentWindowLabel: '30m',
    stuckWarningSeconds: 120,
    telegramEnabled: Boolean(TELEGRAM_BOT_TOKEN),
    whatsappEnabled: deps.whatsappEnabled,
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
    telemetry: deps.statusTelemetry.getSnapshot(),
    agentRunning,
    ...(chatJid
      ? {
          chatRuntimePreferenceLines:
            deps.formatChatRuntimePreferences(chatJid),
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

export function summarizeTask(taskId: string): string {
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

export function formatTaskRunsText(taskId: string, limit = 10): string {
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

export function formatTasksText(mode: 'list' | 'due' = 'list'): string {
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

// --- Gateway service command ---

export function runGatewayServiceCommand(
  action: 'status' | 'restart' | 'doctor',
): {
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

// --- Knowledge runtime snapshot + command ---

export function resolveKnowledgeRuntimeSnapshot(): {
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

export function handleKnowledgeCommand(params: {
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

// --- Callback query handler ---

export async function handleTelegramCallbackQuery(
  q: TelegramInboundCallbackQuery,
  deps: {
    telegramCommandHandlers: {
      handleTelegramCallbackQuery: (
        q: TelegramInboundCallbackQuery,
      ) => Promise<void>;
    };
  },
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

  await deps.telegramCommandHandlers.handleTelegramCallbackQuery(q);
}
