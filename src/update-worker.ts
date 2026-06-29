import {
  readUpdateNotification,
  runUpdateCommand,
  writeUpdateNotification,
  type UpdateNotificationRecord,
  type UpdateProgressEvent,
} from './update-command.js';

function getArg(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] || null;
}

function completeRecord(
  record: UpdateNotificationRecord,
  ok: boolean,
  text: string,
  progress?: UpdateProgressEvent[],
): UpdateNotificationRecord {
  const completedAt = new Date().toISOString();
  return {
    ...record,
    status: 'complete',
    ok,
    text,
    completedAt,
    updatedAt: completedAt,
    progress,
  };
}

const reportFile =
  getArg('--report-file') || process.env.FFT_NANO_UPDATE_REPORT_FILE;
const cwd = getArg('--cwd') || process.env.FFT_NANO_UPDATE_CWD || process.cwd();

if (!reportFile) {
  process.stderr.write('Missing --report-file\n');
  process.exit(2);
}

const existing = readUpdateNotification(reportFile);
const baseRecord: UpdateNotificationRecord = existing || {
  id: `update-worker-${Date.now()}`,
  chatJid: '',
  cwd,
  status: 'started',
  startedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const progressEvents: UpdateProgressEvent[] = [];

/**
 * Flush the current progress to disk, preserving any fields the host may have
 * written between our reads (notably `previewMessageId` and `previewFailed`).
 * Without this re-read the worker would clobber the host's preview message id
 * on every progress event, which is the root cause of "one Telegram message
 * and then nothing" — the polling service sees the previewMessageId vanish
 * before it can edit the message.
 */
function flushProgress(file: string): void {
  try {
    const onDisk = readUpdateNotification(file);
    writeUpdateNotification(file, {
      ...(onDisk || baseRecord),
      status: 'started',
      progress: [...progressEvents],
      updatedAt: new Date().toISOString(),
    });
  } catch {
    // Best-effort: a write failure must not abort the run.
  }
}

try {
  const result = runUpdateCommand({
    cwd,
    onProgress: (event) => {
      progressEvents.push(event);
      flushProgress(reportFile);
    },
  });
  writeUpdateNotification(
    reportFile,
    completeRecord(
      readUpdateNotification(reportFile) || baseRecord,
      result.ok,
      result.text,
      progressEvents,
    ),
  );
  process.exit(result.ok ? 0 : 1);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  writeUpdateNotification(
    reportFile,
    completeRecord(
      readUpdateNotification(reportFile) || baseRecord,
      false,
      `Update worker crashed: ${message}`,
      progressEvents,
    ),
  );
  process.exit(1);
}
