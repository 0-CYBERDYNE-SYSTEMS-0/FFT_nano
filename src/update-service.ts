import fs from 'fs';
import path from 'path';

import { logger } from './logger.js';
import { state } from './app-state.js';
import {
  getUpdateNotificationsDir,
  readUpdateNotification,
  writeUpdateNotification,
} from './update-command.js';

export interface UpdateServiceDeps {
  sendMessage: (chatJid: string, text: string) => Promise<boolean>;
}

const UPDATE_NOTIFICATION_POLL_MS = 5000;
let updateNotificationTimer: ReturnType<typeof setInterval> | null = null;
let deps: UpdateServiceDeps | null = null;

async function processPendingUpdateNotifications(): Promise<void> {
  if (!state.telegramBot) return;
  if (!deps) return;
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
    if (!record || record.status !== 'complete' || record.sentAt) continue;
    if (!record.chatJid) {
      const sentAt = new Date().toISOString();
      writeUpdateNotification(reportFile, {
        ...record,
        sentAt,
        updatedAt: sentAt,
      });
      logger.info(
        { reportFile, reportId: record.id },
        'Update report completed without chat id; marked as consumed',
      );
      continue;
    }

    const label = record.ok ? 'Update complete' : 'Update failed';
    const sent = await deps.sendMessage(
      record.chatJid,
      `${label}:\n${record.text || ''}`,
    );
    if (!sent) continue;

    const sentAt = new Date().toISOString();
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
