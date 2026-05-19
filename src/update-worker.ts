import {
  readUpdateNotification,
  runUpdateCommand,
  writeUpdateNotification,
  type UpdateNotificationRecord,
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
): UpdateNotificationRecord {
  const completedAt = new Date().toISOString();
  return {
    ...record,
    status: 'complete',
    ok,
    text,
    completedAt,
    updatedAt: completedAt,
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

try {
  const result = runUpdateCommand({ cwd });
  writeUpdateNotification(
    reportFile,
    completeRecord(baseRecord, result.ok, result.text),
  );
  process.exit(result.ok ? 0 : 1);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  writeUpdateNotification(
    reportFile,
    completeRecord(baseRecord, false, `Update worker crashed: ${message}`),
  );
  process.exit(1);
}
