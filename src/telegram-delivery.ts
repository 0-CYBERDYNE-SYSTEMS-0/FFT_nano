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
  isTelegramRichMessageWithinLimit,
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
  getPendingTasks,
  getTaskById,
  getTaskRunLogs,
  getEvaluatorStats,
  getRecentLearningInjections,
  listActiveAgentRuns,
} from './db.js';
import { resolveGroupFolderPath } from './group-folder.js';
import { APP_VERSION, SERVICE_STARTED_AT } from './app-state.js';
import { GIT_INFO } from './state-persistence.js';
import { getContainerRuntime } from './container-runtime.js';
import { formatStatusReport } from './status-report.js';
import { readMutationAuditEventsLast7Days } from './mutation-audit.js';
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
  if (jid.startsWith('tui:')) {
    logger.warn({ jid }, 'External delivery requested for local TUI session');
    return false;
  }
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
  messageIds?: number[],
): Promise<void> {
  if (!state.telegramBot) return;
  const ids = messageIds && messageIds.length ? messageIds : [messageId];
  for (const id of ids) {
    try {
      await state.telegramBot.deleteMessage(chatJid, id);
      logger.info(
        { chatJid, messageId: id },
        'Telegram streaming preview deleted',
      );
    } catch (err) {
      logger.warn(
        { chatJid, messageId: id, err },
        'Failed to delete Telegram streaming preview',
      );
    }
  }
}

export async function finalizeTelegramPreviewMessage(
  chatJid: string,
  messageId: number,
  text: string,
  messageIds?: number[],
): Promise<boolean> {
  if (!state.telegramBot) return false;

  const ids = messageIds && messageIds.length ? messageIds : [messageId];

  const extracted = extractTelegramAttachmentHintsFromReply(text);
  // Attachments must still be delivered as fresh messages. Bot API 10.1 lets
  // the first persistent preview bubble become the final rich message in place.
  const richEligible =
    text.length > 0 && isTelegramRichMessageWithinLimit(text);
  if (extracted.hints.length > 0) {
    const sent = await sendTelegramAgentReply(chatJid, text);
    await deleteTelegramPreviewMessage(chatJid, ids[0], ids);
    logger.info(
      {
        chatJid,
        messageId,
        previewCount: ids.length,
        finalizeMode: 'send-full-reply',
        textLength: text.length,
      },
      'Telegram streaming preview finalized',
    );
    return sent;
  }

  if (richEligible) {
    try {
      await state.telegramBot.editStreamMessage(chatJid, ids[0], text, {
        rich: true,
      });
      for (const staleId of ids.slice(1)) {
        await deleteTelegramPreviewMessage(chatJid, staleId);
      }
      logger.info(
        {
          chatJid,
          messageId,
          previewCount: ids.length,
          finalizeMode: 'edit-rich',
          textLength: text.length,
        },
        'Telegram streaming preview finalized',
      );
      return true;
    } catch (err) {
      logger.warn(
        { chatJid, messageId, err },
        'Failed to finalize Telegram rich preview in place',
      );
      const sent = await sendTelegramAgentReply(chatJid, text);
      if (sent) {
        await deleteTelegramPreviewMessage(chatJid, ids[0], ids);
      }
      return sent;
    }
  }

  const chunks = splitTelegramText(text);
  if (chunks.length === 0) {
    logger.info(
      { chatJid, messageId, finalizeMode: 'leave-existing-empty-final' },
      'Telegram streaming preview finalized',
    );
    return true;
  }

  // Reconcile final chunks against the existing preview bubbles: edit each
  // bubble in place, send extra chunks as new messages, and delete any preview
  // bubbles left over when the final has fewer chunks than the live preview.
  try {
    const reconcileCount = Math.max(chunks.length, ids.length);
    for (let i = 0; i < reconcileCount; i++) {
      if (i < chunks.length && i < ids.length) {
        await state.telegramBot.editStreamMessage(chatJid, ids[i], chunks[i]);
      } else if (i < chunks.length) {
        await state.telegramBot.sendMessage(chatJid, chunks[i]);
      } else {
        await deleteTelegramPreviewMessage(chatJid, ids[i]);
      }
    }
  } catch (err) {
    logger.warn(
      { chatJid, messageId, err },
      'Failed to finalize Telegram streaming preview in place',
    );
    return await sendMessage(chatJid, text);
  }

  logger.info(
    {
      chatJid,
      messageId,
      previewCount: ids.length,
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

// WS2.3: Format pending agent-created tasks for the operator approval surface.
// Returns an object with the rendered text and inline keyboard rows, one row per
// pending task with Approve/Reject buttons. Uses the registerToken callback to
// generate non-guessable callback_data tokens.
export interface PendingTasksDeps {
  registerToken: (
    taskId: string,
    groupFolder: string,
    action: 'approve' | 'reject',
  ) => string;
}

export function formatPendingTasksText(deps: PendingTasksDeps): {
  text: string;
  keyboard: Array<Array<{ text: string; callbackData: string }>>;
} {
  const tasks = getPendingTasks();
  if (tasks.length === 0) {
    return {
      text: 'No pending tasks requiring approval.',
      keyboard: [],
    };
  }

  const lines: string[] = ['Pending agent-created tasks:'];
  const keyboard: Array<Array<{ text: string; callbackData: string }>> = [];

  for (const task of tasks.slice(0, 30)) {
    const taskText = formatPendingTaskRow(task);
    lines.push(taskText);

    const approveCallbackData = `task:approve:${deps.registerToken(
      task.id,
      task.group_folder,
      'approve',
    )}`;
    const rejectCallbackData = `task:reject:${deps.registerToken(
      task.id,
      task.group_folder,
      'reject',
    )}`;

    keyboard.push([
      { text: `✅ Approve`, callbackData: approveCallbackData },
      { text: `❌ Reject`, callbackData: rejectCallbackData },
    ]);
  }

  if (tasks.length > 30) {
    lines.push(`... ${tasks.length - 30} more pending tasks`);
  }

  return { text: lines.join('\n'), keyboard };
}

function formatPendingTaskRow(
  task: ReturnType<typeof getPendingTasks>[0],
): string {
  const promptPreview =
    task.prompt.length > 60 ? `${task.prompt.slice(0, 60)}…` : task.prompt;
  const schedule = `${task.schedule_type} ${task.schedule_value}`;
  const deliveryTo = task.delivery_to || 'n/a';
  const deliveryMode = task.delivery_mode || 'none';
  const deleteAfterRun = task.delete_after_run ? 'true' : 'false';
  const createdAt = task.created_at
    ? new Date(task.created_at).toLocaleString()
    : 'n/a';

  return [
    `  ID: ${task.id}`,
    `  Prompt: ${promptPreview}`,
    `  Schedule: ${schedule}`,
    `  Delivery: ${deliveryMode} → ${deliveryTo}`,
    `  Delete after run: ${deleteAfterRun}`,
    `  Created: ${createdAt}`,
  ].join('\n');
}

// --- Learning digest ---
// WS6.2: /learning digest command - single operator surface summarizing learning
// activity, pause state, recent skips, and pending approvals.

/**
 * Read self-improve events from the JSONL file for the given group.
 * Returns parsed lines from the last 7 days.
 */
function readSelfImproveEventsLast7Days(
  groupFolder: string,
): Array<Record<string, unknown>> {
  try {
    const logPath = path.join(
      resolveGroupFolderPath(groupFolder),
      'logs',
      'self-improve-events.jsonl',
    );
    if (!fs.existsSync(logPath)) return [];
    const content = fs.readFileSync(logPath, 'utf-8');
    const lines = content.split('\n').filter((l) => l.trim());
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const cutoff = sevenDaysAgo.toISOString();
    const events: Array<Record<string, unknown>> = [];
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        const ts = parsed['ts'] as string | undefined;
        if (ts && ts >= cutoff) {
          events.push(parsed);
        }
      } catch {
        // Skip malformed lines
      }
    }
    return events;
  } catch {
    return [];
  }
}

/**
 * Read task audit events from the JSONL file for the given group.
 * Returns parsed lines from the last 7 days.
 */
function readTaskAuditEventsLast7Days(
  groupFolder: string,
): Array<Record<string, unknown>> {
  try {
    const logPath = path.join(
      resolveGroupFolderPath(groupFolder),
      'logs',
      'task-audit.jsonl',
    );
    if (!fs.existsSync(logPath)) return [];
    const content = fs.readFileSync(logPath, 'utf-8');
    const lines = content.split('\n').filter((l) => l.trim());
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const cutoff = sevenDaysAgo.toISOString();
    const events: Array<Record<string, unknown>> = [];
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        const ts = parsed['ts'] as string | undefined;
        if (ts && ts >= cutoff) {
          events.push(parsed);
        }
      } catch {
        // Skip malformed lines
      }
    }
    return events;
  } catch {
    return [];
  }
}

export function formatLearningDigest(): string {
  const lines: string[] = ['## Learning Status'];
  const groupFolder = MAIN_GROUP_FOLDER;

  // Section 1: Skills created/patched/archived in the last 7 days (VAL-WS6-009)
  // Read from mutation-audit.jsonl for actual skill mutations
  const mutationEvents = readMutationAuditEventsLast7Days(groupFolder);
  const skillMutations = mutationEvents.filter(
    (e) => e.kind === 'mutation' && e.mutationType === 'skill' && e.success,
  );
  if (skillMutations.length === 0) {
    lines.push(
      'Skills (last 7 days): No skills created or modified in the last 7 days.',
    );
  } else {
    lines.push(
      `Skills (last 7 days): ${skillMutations.length} skill mutation(s).`,
    );
    for (const evt of skillMutations.slice(0, 3)) {
      const detail = evt.targetName
        ? `${evt.action}: ${evt.targetName}`
        : evt.action;
      lines.push(`  - ${detail}`);
    }
    if (skillMutations.length > 3) {
      lines.push(`  ... and ${skillMutations.length - 3} more`);
    }
  }

  // Optional: mention review triggers as a one-line aside
  const selfImproveEvents = readSelfImproveEventsLast7Days(groupFolder);
  const skillReviewEvents = selfImproveEvents.filter(
    (e) =>
      e['review_fired'] === true &&
      (e['review_type'] === 'skill-self-improve' ||
        e['review_type'] === 'skill-manager'),
  );
  if (skillReviewEvents.length > 0) {
    lines.push(`  (${skillReviewEvents.length} skill review(s) triggered)`);
  }

  // Section 2: Memory writes from learning_injections (VAL-WS6-009)
  const injections = getRecentLearningInjections(groupFolder, 20);
  const memoryInjections = injections.filter((i) => i.kind === 'memory');
  if (memoryInjections.length === 0) {
    lines.push('Memory writes: No memory writes in the last 20 injections.');
  } else {
    lines.push(
      `Memory writes: ${memoryInjections.length} memory write(s) in last 20 injections.`,
    );
    for (const inj of memoryInjections.slice(0, 5)) {
      const itemPreview =
        inj.item.length > 50 ? inj.item.slice(0, 50) + '…' : inj.item;
      lines.push(`  - ${inj.kind}: ${itemPreview}`);
    }
    if (memoryInjections.length > 5) {
      lines.push(`  ... and ${memoryInjections.length - 5} more`);
    }
  }

  // Section 3: Pass-rate trend (this week vs prior) (VAL-WS6-009)
  // Read evaluator verdicts to compute week-over-week trend
  // Note: getEvaluatorStats already provides recentSkips; we add week comparison here
  const stats = getEvaluatorStats(groupFolder, 20);
  if (stats.total === 0) {
    lines.push('Pass-rate trend: No runs evaluated yet.');
  } else {
    // Show overall stats
    const passPct = Math.round(stats.passRate * 100);
    lines.push(
      `Pass-rate (last ${stats.total} runs): ${stats.passes}/${stats.total} passed (${passPct}%)`,
    );
  }

  // Section 4: Recent skips (VAL-WS6-011)
  lines.push(`Recent skips: ${stats.recentSkips} / ${stats.total}`);
  if (stats.recentIssues.length > 0) {
    lines.push('Recurring issues:');
    for (const issue of stats.recentIssues.slice(0, 5)) {
      lines.push(`  - ${issue}`);
    }
  }

  // Section 5: Pending agent-task approvals (VAL-WS6-012)
  const pendingTasks = getPendingTasks();
  if (pendingTasks.length === 0) {
    lines.push('Pending agent-task approvals: None.');
  } else {
    lines.push(`Pending agent-task approvals: ${pendingTasks.length} pending.`);
    for (const task of pendingTasks.slice(0, 5)) {
      const promptPreview =
        task.prompt.length > 50 ? task.prompt.slice(0, 50) + '…' : task.prompt;
      lines.push(`  - ${task.id}: ${promptPreview}`);
    }
    if (pendingTasks.length > 5) {
      lines.push(`  ... and ${pendingTasks.length - 5} more`);
    }
  }

  // Section 6: Pause status (VAL-INV-I6-002)
  lines.push(
    `Pause status: ${state.learningPaused ? 'Learning is paused' : 'Learning is active'}`,
  );

  return lines.join('\n');
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
    text:
      action === 'status'
        ? appendTuiGatewayHealth(
            bounded || `Gateway service command completed: ${action}`,
          )
        : bounded || `Gateway service command completed: ${action}`,
  };
}

function appendTuiGatewayHealth(prefix: string): string {
  if (state.tuiGatewayServer) {
    const endpoint = state.tuiGatewayLocalEndpoint;
    return (
      prefix +
      '\n\nTUI gateway: healthy' +
      (endpoint ? `\n- local_endpoint: ${endpoint}` : '')
    );
  }
  const localEndpoint = state.tuiGatewayLocalEndpoint;
  const lines: string[] = [prefix, '', 'TUI gateway: degraded (not listening)'];
  lines.push(
    localEndpoint
      ? `- local_endpoint: ${localEndpoint}`
      : '- local_endpoint: <not resolved>',
  );
  if (state.tuiGatewayLastError) {
    lines.push(`- last_error: ${state.tuiGatewayLastError}`);
  }
  lines.push(
    '- hint: run ./scripts/service.sh status and inspect service logs; if running on Android/Termux, ensure termux-services is installed and the daemon was installed with --install-daemon.',
  );
  return lines.join('\n');
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
