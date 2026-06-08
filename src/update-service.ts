import fs from 'fs';
import path from 'path';

import { logger } from './logger.js';
import { state } from './app-state.js';
import {
  getUpdateNotificationsDir,
  readUpdateNotification,
  type UpdateNotificationRecord,
  type UpdateProgressEvent,
  writeUpdateNotification,
} from './update-command.js';
import {
  TelegramPreviewRegistry,
  updateTelegramPreview,
} from './telegram-streaming.js';

export interface UpdateServiceDeps {
  sendMessage: (chatJid: string, text: string) => Promise<boolean>;
  previewRegistry?: TelegramPreviewRegistry;
}

const UPDATE_NOTIFICATION_POLL_MS = 5000;
let updateNotificationTimer: ReturnType<typeof setInterval> | null = null;
let deps: UpdateServiceDeps | null = null;

function buildProgressPreviewText(
  record: UpdateNotificationRecord,
  currentPhase: string,
  elapsedMs: number,
  status?: 'started' | 'completed' | 'failed',
): string {
  const elapsedSec = Math.floor(elapsedMs / 1000);
  const min = Math.floor(elapsedSec / 60);
  const sec = elapsedSec % 60;
  const timeStr = min > 0 ? `${min}m ${sec}s` : `${sec}s`;
  let phaseDisplay = currentPhase;
  if (status === 'completed') {
    phaseDisplay = `${currentPhase} ✓`;
  } else if (status === 'failed') {
    phaseDisplay = `${currentPhase} ✗`;
  }
  return `▸ ${phaseDisplay} (${timeStr})`;
}

function buildStartedPreviewText(record: UpdateNotificationRecord): string {
  return 'Update started ▸ starting';
}

function buildCompletionText(record: UpdateNotificationRecord): string {
  if (record.ok === true) {
    return 'Update complete — service restarted.';
  }
  const firstLine = (record.text || '').split('\n')[0] || 'Unknown error';
  return `Update failed — ${firstLine}`;
}

async function processReport(
  reportFile: string,
  record: UpdateNotificationRecord,
): Promise<void> {
  if (!state.telegramBot || !deps) return;
  if (!record.chatJid) return;

  const bot = state.telegramBot;
  const registry = deps.previewRegistry;
  const sendMessage = deps.sendMessage;
  const now = new Date();
  const startedAt = new Date(record.startedAt);
  const elapsedMs = now.getTime() - startedAt.getTime();

  // If status is 'complete', handle final delivery
  if (record.status === 'complete') {
    const completionText = buildCompletionText(record);

    if (record.previewMessageId) {
      // We have an active preview - edit it to terminal wording
      try {
        await bot.editStreamMessage(
          record.chatJid,
          record.previewMessageId,
          completionText,
        );
      } catch (err) {
        logger.warn(
          {
            err,
            reportId: record.id,
            previewMessageId: record.previewMessageId,
          },
          'Failed to edit preview message to terminal wording',
        );
      }
    }

    // If preview failed at any point, send final via plain sendMessage
    if (record.previewFailed) {
      await sendMessage(record.chatJid, completionText);
    }

    // Mark as sent if not already
    if (!record.sentAt) {
      const sentAt = now.toISOString();
      writeUpdateNotification(reportFile, {
        ...record,
        sentAt,
        updatedAt: sentAt,
      });
      logger.info(
        { reportId: record.id, chatJid: record.chatJid, ok: record.ok },
        'Update notification delivered',
      );
    }
    return;
  }

  // Status is 'started' - handle preview messaging
  const progress = record.progress || [];
  const lastIndex = record.lastProgressIndex ?? -1;
  const newEvents = progress.slice(lastIndex + 1);

  // If no new progress events and no preview exists, seed one
  if (newEvents.length === 0 && !record.previewMessageId) {
    // Seed the preview with initial text
    const previewText = buildStartedPreviewText(record);
    try {
      const result = await updateTelegramPreview({
        bot,
        registry: registry!,
        chatJid: record.chatJid,
        requestId: record.id,
        text: previewText,
      });

      if (result.messageId) {
        const updatedRecord: UpdateNotificationRecord = {
          ...record,
          previewMessageId: result.messageId,
          updatedAt: new Date().toISOString(),
        };
        writeUpdateNotification(reportFile, updatedRecord);
        logger.debug(
          { reportId: record.id, messageId: result.messageId },
          'Update preview seeded',
        );
      } else if (result.disabled || result.error) {
        // Preview send failed - mark for fallback mode
        const updatedRecord: UpdateNotificationRecord = {
          ...record,
          previewFailed: true,
          updatedAt: new Date().toISOString(),
        };
        writeUpdateNotification(reportFile, updatedRecord);
        logger.warn(
          { err: result.error, reportId: record.id },
          'Update preview send failed; will use fallback mode',
        );
      }
    } catch (err) {
      // Preview send threw - mark for fallback mode
      const updatedRecord: UpdateNotificationRecord = {
        ...record,
        previewFailed: true,
        updatedAt: new Date().toISOString(),
      };
      writeUpdateNotification(reportFile, updatedRecord);
      logger.warn(
        { err, reportId: record.id },
        'Update preview send threw; will use fallback mode',
      );
    }
    return;
  }

  // If preview failed, use plain sendMessage for each new event
  if (record.previewFailed) {
    for (const event of newEvents) {
      if (event.status === 'completed' || event.status === 'failed') {
        // Skip intermediate completed events in fallback mode
        continue;
      }
      const msg = `▸ ${event.phase}: ${event.label}`;
      await sendMessage(record.chatJid, msg);
    }

    // Update lastProgressIndex even in fallback mode
    if (newEvents.length > 0) {
      const lastEvent = newEvents[newEvents.length - 1];
      const newIndex = progress.indexOf(lastEvent);
      const updatedRecord: UpdateNotificationRecord = {
        ...record,
        lastProgressIndex: newIndex >= 0 ? newIndex : record.lastProgressIndex,
        updatedAt: new Date().toISOString(),
      };
      writeUpdateNotification(reportFile, updatedRecord);
    }
    return;
  }

  // Normal mode: edit preview in place for each new event
  if (!record.previewMessageId || newEvents.length === 0) return;

  for (const event of newEvents) {
    // Find the index of this event in the progress array
    const eventIndex = progress.indexOf(event);
    if (eventIndex < 0) continue;

    // Determine current phase text (use phase name directly)
    const currentPhase = event.phase;

    // Calculate elapsed time up to this event
    const eventTime = new Date(event.at);
    const eventElapsedMs = eventTime.getTime() - startedAt.getTime();

    const previewText = buildProgressPreviewText(
      record,
      currentPhase,
      eventElapsedMs,
      event.status,
    );

    try {
      await updateTelegramPreview({
        bot,
        registry: registry!,
        chatJid: record.chatJid,
        requestId: record.id,
        text: previewText,
      });
    } catch (err) {
      logger.warn(
        { err, reportId: record.id, event },
        'Failed to edit update preview',
      );
    }

    // Update lastProgressIndex
    const updatedRecord: UpdateNotificationRecord = {
      ...record,
      lastProgressIndex: eventIndex,
      updatedAt: new Date().toISOString(),
    };
    writeUpdateNotification(reportFile, updatedRecord);

    // If this was a failed event, trigger completion handling
    if (event.status === 'failed' || event.phase === 'complete') {
      await processReport(reportFile, updatedRecord);
    }
  }
}

async function processPendingUpdateNotifications(): Promise<void> {
  if (!state.telegramBot) return;
  if (!deps) return;

  // If no previewRegistry is configured, create a default one
  if (!deps.previewRegistry) {
    deps.previewRegistry = new TelegramPreviewRegistry(300_000);
  }

  const reportDir = getUpdateNotificationsDir(process.cwd());
  if (!fs.existsSync(reportDir)) return;

  let entries: string[] = [];
  try {
    entries = fs
      .readdirSync(reportDir)
      .filter((entry) => entry.endsWith('.json'));
  } catch (err) {
    logger.debug({ err, reportDir }, 'Failed to read update notification dir');
    return;
  }

  for (const entry of entries) {
    const reportFile = path.join(reportDir, entry);
    const record = readUpdateNotification(reportFile);
    if (!record) continue;

    // Skip already-sent complete reports
    if (record.status === 'complete' && record.sentAt) continue;

    // Skip reports without chatJid (non-Telegram surfaces)
    if (!record.chatJid) {
      // For non-Telegram surfaces, just mark as sent if complete
      if (record.status === 'complete' && !record.sentAt) {
        const sentAt = new Date().toISOString();
        writeUpdateNotification(reportFile, {
          ...record,
          sentAt,
          updatedAt: sentAt,
        });
      }
      continue;
    }

    await processReport(reportFile, record);
  }
}

export function startUpdateNotificationLoop(
  serviceDeps: UpdateServiceDeps,
): void {
  if (updateNotificationTimer !== null) return;
  deps = serviceDeps;
  void processPendingUpdateNotifications();
  updateNotificationTimer = setInterval(() => {
    if (state.shuttingDown) return;
    void processPendingUpdateNotifications();
  }, UPDATE_NOTIFICATION_POLL_MS);
  updateNotificationTimer.unref?.();
}

export function stopUpdateNotificationLoop(): void {
  if (updateNotificationTimer === null) return;
  clearInterval(updateNotificationTimer);
  updateNotificationTimer = null;
}

/**
 * Get current phase and elapsed time from a report record.
 * Returns null if the report is not found or has no progress.
 */
export function getReportProgress(
  record: UpdateNotificationRecord,
): { currentPhase: string; elapsedMs: number } | null {
  const progress = record.progress;
  if (!progress || progress.length === 0) {
    return null;
  }

  const lastIndex = record.lastProgressIndex ?? progress.length - 1;
  const lastEvent = progress[lastIndex] as UpdateProgressEvent | undefined;
  if (!lastEvent) {
    return null;
  }

  const startedAt = new Date(record.startedAt);
  let elapsedMs: number;
  if (lastEvent.status === 'completed' || lastEvent.status === 'failed') {
    // Use the event's timestamp for completed/failed events
    const eventTime = new Date(lastEvent.at);
    elapsedMs = eventTime.getTime() - startedAt.getTime();
  } else {
    elapsedMs = Date.now() - startedAt.getTime();
  }

  return {
    currentPhase: lastEvent.phase,
    elapsedMs,
  };
}
