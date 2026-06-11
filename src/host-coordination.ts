import fs from 'fs';
import path from 'path';

import {
  DATA_DIR,
  IPC_POLL_INTERVAL,
  MAIN_GROUP_FOLDER,
  MAIN_WORKSPACE_DIR,
  PARITY_CONFIG,
} from './config.js';
import { logger } from './logger.js';
import { enqueueHeldDelivery, markHeldDeliveryNotified } from './db.js';
import {
  state,
  telegramPreviewRegistry,
  hostEventBus,
  runAuthorityRegistry,
  type TelegramDeliveryMode,
} from './app-state.js';
import {
  getTelegramPreviewRunKey,
  isTelegramRunStatusPreviewText,
  type TelegramMessagePreviewState,
  updateTelegramDraftPreview,
  updateTelegramPreview,
} from './telegram-streaming.js';
import { getActiveStreamConsumer } from './streaming/active-consumers.js';
import { deriveTelegramDraftId, type AvailableGroup } from './pi-runner.js';
import type { RegisteredGroup } from './types.js';
import { isTelegramJid } from './telegram.js';
import {
  dispatchLegacyMessageEnvelope,
  wrapLegacyActionEnvelope,
  wrapLegacyMessageEnvelope,
} from './runtime/boundary-ipc.js';
import {
  createOrderedHostEventProcessor,
  type HostEvent,
} from './runtime/host-events.js';
import {
  normalizeFileDeliveryRequest,
  processFileDeliveryRequest,
} from './file-delivery.js';
import { attachActionRequestAudit } from './action-result-audit.js';
import { executeFarmAction } from './farm-action-gateway.js';
import { executeMemoryAction } from './memory-action-gateway.js';
import { executeSkillAction } from './skill-lifecycle.js';
import { writeJsonFileAtomic } from './atomic-write.js';
import { FEATURE_FARM } from './config.js';
import type { StatusTelemetry } from './status-report.js';
import type {
  FarmActionRequest,
  MemoryActionRequest,
  SkillActionRequest,
} from './types.js';
import type { CronV2Schedule } from './cron/types.js';
import {
  resolveCronExecutionPlan,
  resolveCronPolicy,
} from './cron/adapters.js';
import { resolveGroupFolderPath } from './group-folder.js';
import { recordTaskAuditEvent } from './task-audit.js';

export interface HostCoordinationDeps {
  sendTelegramAgentReply: (chatJid: string, text: string) => Promise<boolean>;
  finalizeTelegramPreviewMessage: (
    chatJid: string,
    messageId: number,
    text: string,
    messageIds?: number[],
  ) => Promise<boolean>;
  sendAgentResultMessage: (
    chatJid: string,
    text: string,
    opts?: { prefixWhatsApp?: boolean },
  ) => Promise<boolean>;
  noteDeliveryPending: (
    chatJid: string | null | undefined,
    requestId: string,
  ) => void;
  noteDeliverySettled: (params: {
    chatJid: string | null | undefined;
    requestId: string;
    status: 'success' | 'error';
    error?: string;
  }) => void;
  statusTelemetry: StatusTelemetry;
  getSessionKeyForChat: (chatJid: string) => string;
  registerGroup: (jid: string, group: RegisteredGroup) => void;
  syncGroupMetadata: (force?: boolean) => Promise<void>;
  getAvailableGroups: () => AvailableGroup[];
}

// ── Telegram stream state helpers ──────────────────────────────────────────

export function getTelegramHostStreamKey(
  chatJid: string,
  requestId: string,
): string {
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

export function consumeTelegramHostCompletedRun(
  chatJid: string,
  requestId: string,
): boolean {
  return telegramPreviewRegistry.consumeCompleted(
    getTelegramHostStreamKey(chatJid, requestId),
  );
}

export function consumeTelegramHostStreamState(
  chatJid: string,
  requestId: string,
): TelegramMessagePreviewState | null {
  return telegramPreviewRegistry.consumePreviewState(
    getTelegramHostStreamKey(chatJid, requestId),
  );
}

function getTelegramHostAttemptStreamKeys(
  chatJid: string,
  requestId: string,
): string[] {
  const baseKey = getTelegramHostStreamKey(chatJid, requestId);
  return [baseKey, getTelegramHostStreamKey(chatJid, `${requestId}:retry`)];
}

function consumeTelegramHostAttemptDraftStates(
  chatJid: string,
  requestId: string,
): void {
  for (const streamKey of getTelegramHostAttemptStreamKeys(
    chatJid,
    requestId,
  )) {
    telegramPreviewRegistry.consumeDraftState(streamKey);
  }
}

function consumeTelegramHostAttemptPreviewStates(
  chatJid: string,
  requestId: string,
): TelegramMessagePreviewState | null {
  let previewState: TelegramMessagePreviewState | null = null;
  for (const streamKey of getTelegramHostAttemptStreamKeys(
    chatJid,
    requestId,
  )) {
    const consumed = telegramPreviewRegistry.consumePreviewState(streamKey);
    previewState ||= consumed;
  }
  return previewState;
}

function consumeTelegramHostAttemptCompletions(
  chatJid: string,
  requestId: string,
): boolean {
  let completed = false;
  for (const streamKey of getTelegramHostAttemptStreamKeys(
    chatJid,
    requestId,
  )) {
    completed =
      telegramPreviewRegistry.consumeCompleted(streamKey) || completed;
  }
  return completed;
}

function noteTelegramHostAttemptCompletions(
  chatJid: string,
  requestId: string,
): void {
  for (const streamKey of getTelegramHostAttemptStreamKeys(
    chatJid,
    requestId,
  )) {
    telegramPreviewRegistry.noteCompleted(streamKey);
  }
}

export function pruneTelegramHostStreamedRuns(): void {
  telegramPreviewRegistry.prune();
}

export function getTelegramDeliveryMode(chatJid: string): TelegramDeliveryMode {
  return state.chatRunPreferences[chatJid]?.telegramDeliveryMode || 'stream';
}

function canUseTelegramNativeDraft(_chatJid: string): boolean {
  return Boolean(state.telegramBot);
}

// ── Message delivery ────────────────────────────────────────────────────────

export async function deliverRuntimeAgentMessage(
  params: {
    chatJid: string;
    text: string;
    requestId?: string;
    prefixWhatsApp?: boolean;
  },
  deps: HostCoordinationDeps,
): Promise<void> {
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
      const finalized = await deps.finalizeTelegramPreviewMessage(
        params.chatJid,
        previewState.messageId,
        params.text,
        previewState.messageIds,
      );
      if (!finalized) {
        await deps.sendTelegramAgentReply(params.chatJid, params.text);
      }
      return;
    }
  }

  await deps.sendAgentResultMessage(params.chatJid, params.text, {
    prefixWhatsApp: params.prefixWhatsApp,
  });
}

export async function prepareTelegramCompletionState(params: {
  chatJid: string;
  runId: string;
  result: string | null;
}): Promise<{
  externallyCompleted: boolean;
  previewState: TelegramMessagePreviewState | null;
}> {
  const deliveryMode = getTelegramDeliveryMode(params.chatJid);
  if (deliveryMode === 'append') {
    consumeTelegramHostAttemptCompletions(params.chatJid, params.runId);
    consumeTelegramHostAttemptPreviewStates(params.chatJid, params.runId);
    consumeTelegramHostAttemptDraftStates(params.chatJid, params.runId);
    noteTelegramHostAttemptCompletions(params.chatJid, params.runId);
    return {
      externallyCompleted: false,
      previewState: null,
    };
  }

  if (deliveryMode === 'draft' && canUseTelegramNativeDraft(params.chatJid)) {
    consumeTelegramHostAttemptDraftStates(params.chatJid, params.runId);
    const externallyCompleted = consumeTelegramHostAttemptCompletions(
      params.chatJid,
      params.runId,
    );
    noteTelegramHostAttemptCompletions(params.chatJid, params.runId);
    return {
      externallyCompleted,
      previewState: null,
    };
  }

  const externallyCompleted = consumeTelegramHostAttemptCompletions(
    params.chatJid,
    params.runId,
  );
  const previewState = consumeTelegramHostAttemptPreviewStates(
    params.chatJid,
    params.runId,
  );
  noteTelegramHostAttemptCompletions(params.chatJid, params.runId);
  return {
    externallyCompleted,
    previewState,
  };
}

// ── Host event processor ────────────────────────────────────────────────────

export async function processHostEvent(
  event: HostEvent,
  deps: HostCoordinationDeps,
): Promise<void> {
  switch (event.kind) {
    case 'chat_delivery_requested':
      await deliverRuntimeAgentMessage(
        {
          chatJid: event.chatJid,
          text: event.text,
          requestId: event.requestId,
          prefixWhatsApp: event.prefixWhatsApp,
        },
        deps,
      );
      return;
    case 'ipc_request':
      if (event.requestKind === 'task') {
        await processTaskIpc(
          event.request as Parameters<typeof processTaskIpc>[0],
          event.sourceGroup,
          event.isMain,
          deps,
        );
        return;
      }
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
          : event.request.type === 'skill_action'
            ? await executeSkillAction(event.request, {
                sourceGroup: event.sourceGroup,
                isMain: event.isMain,
                registeredGroups: state.registeredGroups,
              })
            : await executeMemoryAction(event.request, {
                sourceGroup: event.sourceGroup,
                isMain: event.isMain,
                registeredGroups: state.registeredGroups,
              });
      fs.writeFileSync(
        event.resultPath,
        JSON.stringify(
          attachActionRequestAudit({
            result,
            request: event.request,
            sourceGroup: event.sourceGroup,
            isMain: event.isMain,
          }),
          null,
          2,
        ),
      );
      return;
    case 'ipc_result':
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
    case 'tool_progress':
      // Telegram routing now handled by StreamConsumer in runAgent callback.
      // Event stays on the bus for TUI consumers.
      return;
    case 'run_progress': {
      deps.statusTelemetry.noteRunProgress({
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

      const activeConsumer = getActiveStreamConsumer(
        event.chatJid,
        event.runId,
      );
      if (activeConsumer) {
        activeConsumer.handleExternalProgress(
          event.phase,
          event.text,
          event.detail,
        );
        return;
      }

      const deliveryMode = getTelegramDeliveryMode(event.chatJid);
      if (deliveryMode === 'off') return;
      if (deliveryMode === 'append') {
        await state.telegramBot.sendMessage(event.chatJid, event.text);
        logger.debug(
          {
            runId: event.runId,
            chatJid: event.chatJid,
            phase: event.phase,
            messageId: null,
          },
          'Telegram run-progress message sent',
        );
        return;
      }

      const streamKey = getTelegramPreviewRunKey(event.chatJid, event.runId);
      const existingState = telegramPreviewRegistry.getStreamState(streamKey);
      if (
        existingState &&
        existingState.lastText.trim() &&
        !isTelegramRunStatusPreviewText(existingState.lastText)
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
        } else if (sendResult.sent) {
          logger.debug(
            {
              runId: event.runId,
              chatJid: event.chatJid,
              phase: event.phase,
              messageId: sendResult.draftId ?? null,
            },
            'Telegram draft run-progress update sent',
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
      } else if (sendResult.sent) {
        logger.debug(
          {
            runId: event.runId,
            chatJid: event.chatJid,
            phase: event.phase,
            messageId: sendResult.messageId ?? null,
          },
          'Telegram run-progress preview updated',
        );
      }
      return;
    }
    case 'run_state':
      if ('state' in event && event.state === 'error') {
        deps.statusTelemetry.noteRunFailed({
          runId: event.runId,
          errorMessage: event.errorMessage || 'Run failed',
          detail: event.errorMessage,
          chatJid: event.chatJid,
          createdAt: event.createdAt,
        });
      } else if ('phase' in event && event.phase === 'end') {
        deps.statusTelemetry.clearRun(event.runId);
      }
      return;
    case 'file_transfer':
      if (event.phase === 'requested') {
        logger.info(
          {
            sourceGroup: event.sourceGroup,
            requestId: event.requestId,
            filePath: event.filePath,
            mediaKind: event.mediaKind,
            chatJid: event.chatJid,
          },
          'File delivery requested via IPC',
        );
        return;
      }
      if (event.success) {
        logger.info(
          {
            sourceGroup: event.sourceGroup,
            requestId: event.requestId,
            filePath: event.filePath,
            mediaKind: event.mediaKind,
          },
          'File delivery completed successfully',
        );
      } else {
        logger.warn(
          {
            sourceGroup: event.sourceGroup,
            requestId: event.requestId,
            filePath: event.filePath,
            error: event.error,
          },
          'File delivery failed',
        );
      }
      return;
    default:
      return;
  }
}

// ── IPC watcher ─────────────────────────────────────────────────────────────

export function startIpcWatcher(deps: HostCoordinationDeps): void {
  if (state.ipcWatcherRunning) {
    logger.debug('IPC watcher already running, skipping duplicate start');
    return;
  }
  state.ipcWatcherRunning = true;

  const ipcBaseDir = path.join(DATA_DIR, 'ipc');
  fs.mkdirSync(ipcBaseDir, { recursive: true });

  const boundProcessHostEvent = (event: HostEvent) =>
    processHostEvent(event, deps);
  const processHostEventOrdered = createOrderedHostEventProcessor(
    boundProcessHostEvent,
    (err, event) => {
      logger.error(
        { err, kind: event.kind },
        'Unhandled host event delivery failure',
      );
    },
  );

  // Subscribe to the host event bus for in-process events
  hostEventBus.subscribe((event) => {
    processHostEventOrdered(event);
  });

  const processIpcFiles = async () => {
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

      // Process held markers in messages/ before processing message files.
      // A .held marker means the permission gate returned 'held' for that
      // outbound action — the host must call enqueueHeldDelivery instead of
      // delivering the message. VAL-XARE-001 / VAL-XARE-006.
      const heldMessageIds = new Set<string>();
      try {
        if (fs.existsSync(messagesDir)) {
          const markerFiles = fs
            .readdirSync(messagesDir)
            .filter((f) => f.endsWith('.held'));
          for (const mf of markerFiles) {
            const markerPath = path.join(messagesDir, mf);
            try {
              const content = fs.readFileSync(markerPath, 'utf-8');
              const marker = JSON.parse(content) as {
                requestId: string;
                action: string;
                ts: string;
              };
              const { requestId, action, ts } = marker;
              if (requestId && action === 'send_message') {
                // Read the corresponding message file to get destination + body
                const msgFile = path.join(messagesDir, `${requestId}.json`);
                let destination = '';
                let body = '';
                if (fs.existsSync(msgFile)) {
                  try {
                    const msgData = JSON.parse(
                      fs.readFileSync(msgFile, 'utf-8'),
                    ) as { chatJid?: string; text?: string };
                    destination = msgData.chatJid ?? '';
                    body = msgData.text ?? '';
                  } catch {
                    /* ignore parse errors */
                  }
                }
                const dedupeKey = `held:${sourceGroup}:${requestId}`;
                enqueueHeldDelivery({ dedupeKey, destination, body });
                markHeldDeliveryNotified(dedupeKey);
                heldMessageIds.add(requestId);
                logger.info(
                  { sourceGroup, requestId, action, ts },
                  'Held marker detected: enqueued held delivery',
                );
              }
              fs.unlinkSync(markerPath);
            } catch (err) {
              logger.warn(
                { err, markerPath: markerPath },
                'Failed to process held marker',
              );
              try {
                fs.unlinkSync(markerPath);
              } catch {
                /* ignore */
              }
            }
          }
        }
      } catch (err) {
        logger.error(
          { err, sourceGroup },
          'Error processing held markers in messages',
        );
      }

      try {
        if (fs.existsSync(messagesDir)) {
          const messageFiles = fs
            .readdirSync(messagesDir)
            .filter((f) => f.endsWith('.json'));
          for (const file of messageFiles) {
            // Skip messages that were already handled via a .held marker
            const requestId = file.replace(/\.json$/, '');
            if (heldMessageIds.has(requestId)) {
              // Message was held — suppress delivery, already enqueued
              try {
                fs.unlinkSync(path.join(messagesDir, file));
              } catch {
                /* ignore */
              }
              continue;
            }

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
                  deps.getSessionKeyForChat,
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

      try {
        const actionsDir = path.join(ipcBaseDir, sourceGroup, 'actions');
        if (fs.existsSync(actionsDir)) {
          // Process held markers in actions/ before processing action files.
          // This covers deliver_file and send_webhook held decisions.
          // VAL-XARE-001 / VAL-XARE-006.
          const markerFiles = fs
            .readdirSync(actionsDir)
            .filter((f) => f.endsWith('.held'));
          for (const mf of markerFiles) {
            const markerPath = path.join(actionsDir, mf);
            try {
              const content = fs.readFileSync(markerPath, 'utf-8');
              const marker = JSON.parse(content) as {
                requestId: string;
                action: string;
                destination: string;
                body: string;
                ts: string;
              };
              const { requestId, action, destination, body, ts } = marker;
              if (
                requestId &&
                (action === 'deliver_file' || action === 'send_webhook')
              ) {
                const dedupeKey = `held:${sourceGroup}:${requestId}`;
                enqueueHeldDelivery({ dedupeKey, destination, body });
                markHeldDeliveryNotified(dedupeKey);
                logger.info(
                  { sourceGroup, requestId, action, ts },
                  'Held marker detected in actions: enqueued held delivery',
                );
              }
              fs.unlinkSync(markerPath);
            } catch (err) {
              logger.warn(
                { err, markerPath },
                'Failed to process held marker in actions',
              );
              try {
                fs.unlinkSync(markerPath);
              } catch {
                /* ignore */
              }
            }
          }

          const actionFiles = fs
            .readdirSync(actionsDir)
            .filter((f) => f.endsWith('.json'));

          for (const file of actionFiles) {
            // Check if this action was already handled via a .held marker
            const requestId = file.replace(/\.json$/, '');
            // The held marker for this action would have been processed above
            // and removed. If it still exists, it means it's not a held action.

            const filePath = path.join(actionsDir, file);
            try {
              const request = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as
                | FarmActionRequest
                | MemoryActionRequest
                | SkillActionRequest;

              const resultDir = path.join(
                ipcBaseDir,
                sourceGroup,
                'action_results',
              );
              fs.mkdirSync(resultDir, { recursive: true });

              if (
                request.type === 'farm_action' ||
                request.type === 'memory_action' ||
                request.type === 'skill_action'
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
                  kind: 'ipc_request',
                  requestKind: 'action',
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

      try {
        const deliverFilesDir = path.join(
          ipcBaseDir,
          sourceGroup,
          'deliver_files',
        );
        if (fs.existsSync(deliverFilesDir)) {
          const deliveryFiles = fs
            .readdirSync(deliverFilesDir)
            .filter((f) => f.endsWith('.json'));
          for (const file of deliveryFiles) {
            const filePath = path.join(deliverFilesDir, file);
            const requestIdFromFile = file.replace(/\.json$/, '');

            // Check for a .held marker for this deliver_file.
            // The marker is written to deliver_files/ (same dir) by the extension
            // so we can detect it before processing the file.
            const markerPath = path.join(
              deliverFilesDir,
              `${requestIdFromFile}.held`,
            );
            if (fs.existsSync(markerPath)) {
              try {
                const content = fs.readFileSync(markerPath, 'utf-8');
                const marker = JSON.parse(content) as {
                  requestId: string;
                  action: string;
                  destination: string;
                  body: string;
                  ts: string;
                };
                const { destination, body, ts } = marker;
                const dedupeKey = `held:${sourceGroup}:${marker.requestId}`;
                enqueueHeldDelivery({ dedupeKey, destination, body });
                markHeldDeliveryNotified(dedupeKey);
                logger.info(
                  {
                    sourceGroup,
                    requestId: marker.requestId,
                    action: marker.action,
                    ts,
                  },
                  'Held marker detected for deliver_file: enqueued held delivery',
                );
              } catch (err) {
                logger.warn(
                  { err, markerPath },
                  'Failed to process held marker for deliver_file',
                );
              }
              try {
                fs.unlinkSync(markerPath);
              } catch {
                /* ignore */
              }
              try {
                fs.unlinkSync(filePath);
              } catch {
                /* ignore */
              }
              continue; // Skip processing — delivery is held
            }

            let trackedRequestId: string | null = null;
            let trackedChatJid: string | null = null;
            let parsedRequestId: string | null = null;
            try {
              const rawRequest = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
              const request = normalizeFileDeliveryRequest(rawRequest);
              parsedRequestId = request.requestId;
              const groupJid = Object.keys(state.registeredGroups).find(
                (jid) => state.registeredGroups[jid].folder === sourceGroup,
              );
              const chatJid = request.params?.chatJid || groupJid;
              trackedRequestId = request.requestId;
              trackedChatJid = chatJid || null;
              deps.noteDeliveryPending(trackedChatJid, trackedRequestId);

              await processHostEventOrdered({
                kind: 'file_transfer',
                phase: 'requested',
                id: `fd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                createdAt: new Date().toISOString(),
                source: 'ipc-boundary',
                sourceGroup,
                isMain,
                chatJid: chatJid || '',
                requestId: request.requestId,
                filePath: request.params?.filePath || '',
                mediaKind: request.params?.kind || 'document',
                caption: request.params?.caption,
              });

              const result = await processFileDeliveryRequest(
                request,
                { sourceGroup, isMain, chatJid },
                {
                  telegramBot: state.telegramBot ?? undefined,
                  registeredGroups: state.registeredGroups,
                  resolveGroupWorkspaceDir: (folder) => {
                    return folder === MAIN_GROUP_FOLDER
                      ? MAIN_WORKSPACE_DIR
                      : resolveGroupFolderPath(folder);
                  },
                },
              );
              const resultDir = path.join(
                ipcBaseDir,
                sourceGroup,
                'action_results',
              );
              fs.mkdirSync(resultDir, { recursive: true });
              const resultPath = path.join(
                resultDir,
                `${request.requestId}.json`,
              );
              writeJsonFileAtomic(resultPath, result);
              deps.noteDeliverySettled({
                chatJid: trackedChatJid,
                requestId: request.requestId,
                status: result.status,
                error: result.error,
              });

              await processHostEventOrdered({
                kind: 'file_transfer',
                phase: 'completed',
                id: `fdc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                createdAt: new Date().toISOString(),
                source: 'ipc-boundary',
                sourceGroup,
                chatJid: chatJid || '',
                requestId: request.requestId,
                filePath: request.params?.filePath || '',
                success: result.status === 'success',
                mediaKind: result.result?.kind,
                error: result.error,
              });

              fs.unlinkSync(filePath);
              logger.info(
                {
                  sourceGroup,
                  requestId: request.requestId,
                  status: result.status,
                },
                'File delivery processed',
              );
            } catch (err) {
              const errorMessage =
                err instanceof Error ? err.message : String(err);
              if (trackedRequestId) {
                deps.noteDeliverySettled({
                  chatJid: trackedChatJid,
                  requestId: trackedRequestId,
                  status: 'error',
                  error: errorMessage,
                });
              }
              logger.error(
                { file, sourceGroup, err },
                'Error processing file delivery request',
              );
              const resultDir = path.join(
                ipcBaseDir,
                sourceGroup,
                'action_results',
              );
              fs.mkdirSync(resultDir, { recursive: true });
              const resultRequestId =
                trackedRequestId ||
                parsedRequestId ||
                `invalid-${path.basename(file, '.json')}`;
              writeJsonFileAtomic(
                path.join(resultDir, `${resultRequestId}.json`),
                {
                  requestId: resultRequestId,
                  status: 'error',
                  error: errorMessage,
                  executedAt: new Date().toISOString(),
                },
              );
              const errorDir = path.join(ipcBaseDir, 'errors');
              fs.mkdirSync(errorDir, { recursive: true });
              const baseErrorPath = path.join(
                errorDir,
                `delivery-${sourceGroup}-${file}`,
              );
              const errorPath = fs.existsSync(baseErrorPath)
                ? path.join(
                    errorDir,
                    `delivery-${sourceGroup}-${Date.now()}-${file}`,
                  )
                : baseErrorPath;
              fs.renameSync(filePath, errorPath);
            }
          }
        }
      } catch (err) {
        logger.error(
          { err, sourceGroup },
          'Error reading IPC deliver_files directory',
        );
      }
    }

    setTimeout(processIpcFiles, IPC_POLL_INTERVAL);
  };

  processIpcFiles();
  logger.info('IPC watcher started (per-group namespaces)');
}

// ── Task IPC processor ───────────────────────────────────────────────────────

export async function processTaskIpc(
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
    jid?: string;
    name?: string;
    folder?: string;
    trigger?: string;
    containerConfig?: RegisteredGroup['containerConfig'];
  },
  sourceGroup: string,
  isMain: boolean,
  deps: HostCoordinationDeps,
): Promise<void> {
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
        const targetGroup = data.groupFolder;
        if (!isMain && targetGroup !== sourceGroup) {
          logger.warn(
            { sourceGroup, targetGroup },
            'Unauthorized schedule_task attempt blocked',
          );
          break;
        }

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

        // WS2.2: Derive created_by and status from the run authority's origin.
        // Agent-created tasks (origin headless/subagent) → pending_approval, created_by='agent'.
        // Operator-created tasks (origin interactive-main) → active, created_by='operator'.
        // Conservative default: if no authority found, treat as agent-created.
        const runAuthority = runAuthorityRegistry.get(sourceGroup);
        const isAgentOrigin =
          !runAuthority ||
          runAuthority.origin === 'headless' ||
          runAuthority.origin === 'subagent';
        // WS6.3: When learning is paused, autoApprove is ignored and agent tasks
        // always go to pending_approval (VAL-WS6-019, VAL-XARE-014).
        const effectiveAutoApprove = state.learningPaused
          ? false
          : PARITY_CONFIG.cron.agentTasks.autoApprove;
        const taskStatus =
          isAgentOrigin && !effectiveAutoApprove
            ? 'pending_approval'
            : 'active';
        const createdBy = isAgentOrigin ? 'agent' : 'operator';

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
          status: taskStatus,
          created_by: createdBy,
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

        // WS2.4: Write audit line for task creation
        recordTaskAuditEvent(targetGroup, {
          taskId,
          kind: 'create',
          authorityId: runAuthority?.authorityId,
          priorStatus: undefined,
          newStatus: taskStatus,
          promptPreview: data.prompt?.slice(0, 200) || undefined,
          scheduleType: executionPlan.scheduleType,
          scheduleValue: executionPlan.scheduleValue,
          deliveryTo: policy.delivery.to || null,
          deliveryMode: policy.delivery.mode || null,
          deleteAfterRun: policy.deleteAfterRun,
          createdBy: createdBy as 'operator' | 'agent',
        });
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
          // WS2.4: Write audit line before deleting
          recordTaskAuditEvent(task.group_folder, {
            taskId: data.taskId,
            kind: 'cancel',
            priorStatus: task.status || null,
            newStatus: null,
          });
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
      if (isMain) {
        logger.info(
          { sourceGroup },
          'Group metadata refresh requested via IPC',
        );
        await deps.syncGroupMetadata(true);
        const availableGroups = deps.getAvailableGroups();
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
      if (!isMain) {
        logger.warn(
          { sourceGroup },
          'Unauthorized register_group attempt blocked',
        );
        break;
      }
      if (data.jid && data.name && data.folder && data.trigger) {
        deps.registerGroup(data.jid, {
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
