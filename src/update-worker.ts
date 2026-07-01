import {
  readUpdateNotification,
  runUpdateCommand,
  withUpdateReportLock,
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
 *
 * Wrapped in the per-report advisory lock so we don't race the host's
 * concurrent writes to the same file. Falls back to an unlocked write if the
 * peer holds the lock beyond our timeout; the alternative (dropping the
 * event entirely) is worse — losing a progress event re-triggers F-3 / F-16.
 */
function flushProgress(file: string): void {
  const write = () => {
    const onDisk = readUpdateNotification(file);
    writeUpdateNotification(file, {
      ...(onDisk || baseRecord),
      status: 'started',
      progress: [...progressEvents],
      updatedAt: new Date().toISOString(),
    });
  };
  try {
    withUpdateReportLock(file, write, 200);
  } catch {
    // Lock acquire/timeout threw unexpectedly — try one unlocked write as
    // a last-ditch fallback so a transient lock failure doesn't kill the run.
    try {
      write();
    } catch {
      // Best-effort: a write failure must not abort the run.
    }
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
  const finalize = () => {
    writeUpdateNotification(
      reportFile,
      completeRecord(
        readUpdateNotification(reportFile) || baseRecord,
        result.ok,
        result.text,
        progressEvents,
      ),
    );
  };
  try {
    withUpdateReportLock(reportFile, finalize, 500);
  } catch {
    try {
      finalize();
    } catch {
      // Best-effort: a write failure here would mean the host never sees
      // the terminal record; the launcher-side timeout will surface that.
    }
  }
  process.exit(result.ok ? 0 : 1);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  const finalize = () => {
    writeUpdateNotification(
      reportFile,
      completeRecord(
        readUpdateNotification(reportFile) || baseRecord,
        false,
        `Update worker crashed: ${message}`,
        progressEvents,
      ),
    );
  };
  try {
    withUpdateReportLock(reportFile, finalize, 500);
  } catch {
    try {
      finalize();
    } catch {
      // Best-effort: a write failure here would mean the host never sees
      // the terminal record; the launcher-side timeout will surface that.
    }
  }
  process.exit(1);
}
