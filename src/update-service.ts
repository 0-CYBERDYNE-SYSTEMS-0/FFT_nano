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

function formatEventLine(event: UpdateProgressEvent): string {
  if (event.status === 'completed') {
    const dur =
      typeof event.durationMs === 'number'
        ? ` (${Math.round(event.durationMs / 100) / 10}s)`
        : '';
    return `✓ ${event.phase}: ${event.label}${dur}`;
  }
  if (event.status === 'failed') {
    return `✗ ${event.phase}: ${event.label} — ${event.message ?? 'failed'}`;
  }
  return `▸ ${event.phase}: ${event.label}`;
}

/**
 * Ensure the report has a preview message. Always tries to seed one (even if
 * events already exist) — the previous version only seeded when there were no
 * new events, which meant a worker writing fast would skip seeding entirely
 * and the user would see "Update started" once, then nothing.
 */
async function ensurePreview(
  reportFile: string,
  record: UpdateNotificationRecord,
): Promise<UpdateNotificationRecord> {
  if (record.previewMessageId || record.previewFailed) return record;
  if (!state.telegramBot || !deps) return record;
  const bot = state.telegramBot;
  const registry = deps.previewRegistry;
  if (!registry) {
    deps.previewRegistry = new TelegramPreviewRegistry(300_000);
  }

  try {
    const result = await updateTelegramPreview({
      bot,
      registry: deps.previewRegistry!,
      chatJid: record.chatJid,
      requestId: record.id,
      text: buildStartedPreviewText(record),
    });

    if (result.messageId) {
      const updated: UpdateNotificationRecord = {
        ...record,
        previewMessageId: result.messageId,
        updatedAt: new Date().toISOString(),
      };
      writeUpdateNotification(reportFile, updated);
      logger.debug(
        { reportId: record.id, messageId: result.messageId },
        'Update preview seeded',
      );
      return updated;
    }

    // Preview send returned no id and no error — mark fallback so the next
    // event uses plain sendMessage.
    const updated: UpdateNotificationRecord = {
      ...record,
      previewFailed: true,
      updatedAt: new Date().toISOString(),
    };
    writeUpdateNotification(reportFile, updated);
    logger.warn(
      { reportId: record.id },
      'Update preview send returned no messageId; switching to fallback',
    );
    return updated;
  } catch (err) {
    const updated: UpdateNotificationRecord = {
      ...record,
      previewFailed: true,
      updatedAt: new Date().toISOString(),
    };
    writeUpdateNotification(reportFile, updated);
    logger.warn(
      { err, reportId: record.id },
      'Update preview send threw; switching to fallback',
    );
    return updated;
  }
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

  // 1. Terminal: always reach the user via plain sendMessage if we never
  //    managed to set up a preview. Previous logic only sent a plain message
  //    when previewFailed was true, which silently dropped terminal updates
  //    for any report that lost its previewMessageId mid-run.
  if (record.status === 'complete') {
    if (record.sentAt) return;

    const completionText = buildCompletionText(record);
    let delivered = false;

    if (record.previewMessageId) {
      try {
        await bot.editStreamMessage(
          record.chatJid,
          record.previewMessageId,
          completionText,
        );
        delivered = true;
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

    if (!delivered) {
      // Always send the terminal message. This is the user-visible "your
      // update finished" message — it must reach the chat no matter what.
      try {
        await sendMessage(record.chatJid, completionText);
        delivered = true;
      } catch (err) {
        logger.error(
          { err, reportId: record.id, chatJid: record.chatJid },
          'Failed to send update terminal message',
        );
      }
    }

    const sentAt = new Date().toISOString();
    writeUpdateNotification(reportFile, {
      ...record,
      sentAt,
      updatedAt: sentAt,
    });
    if (delivered) {
      logger.info(
        { reportId: record.id, chatJid: record.chatJid, ok: record.ok },
        'Update notification delivered',
      );
    }
    return;
  }

  // 2. Mid-run: ensure we have a preview message first, then walk new events.
  const seeded = await ensurePreview(reportFile, record);

  const progress = seeded.progress || [];
  const lastIndex = seeded.lastProgressIndex ?? -1;
  const newEvents = progress.slice(lastIndex + 1);
  if (newEvents.length === 0) return;

  let lastDeliveredIndex = lastIndex;
  for (const event of newEvents) {
    const eventIndex = progress.indexOf(event);
    if (eventIndex < 0) continue;
    const eventTime = new Date(event.at);
    const eventElapsedMs = eventTime.getTime() - startedAt.getTime();

    const previewText = seeded.previewMessageId
      ? buildProgressPreviewText(
          seeded,
          event.phase,
          eventElapsedMs,
          event.status,
        )
      : formatEventLine(event);

    let delivered = false;
    if (seeded.previewMessageId && registry) {
      try {
        await updateTelegramPreview({
          bot,
          registry,
          chatJid: record.chatJid,
          requestId: record.id,
          text: previewText,
        });
        delivered = true;
      } catch (err) {
        logger.warn(
          { err, reportId: record.id, event },
          'Failed to edit update preview',
        );
      }
    }
    if (!delivered) {
      // Fallback: send every event as a plain message. Surface ALL events
      // (started + completed + failed) so the user sees real progress even
      // when preview editing is unavailable.
      try {
        await sendMessage(record.chatJid, formatEventLine(event));
      } catch (err) {
        logger.warn(
          { err, reportId: record.id, event },
          'Failed to send update fallback message',
        );
      }
    }

    lastDeliveredIndex = eventIndex;
    writeUpdateNotification(reportFile, {
      ...seeded,
      lastProgressIndex: eventIndex,
      updatedAt: new Date().toISOString(),
    });
  }

  // If the worker signaled a terminal-style event, let the next poll deliver
  // the completion text (it will arrive as soon as status flips to complete).
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
