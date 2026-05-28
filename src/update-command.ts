import { randomBytes } from 'crypto';
import { spawn, spawnSync, type ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';

export interface UpdateCommandResult {
  ok: boolean;
  text: string;
}

export interface UpdateCommandStartResult extends UpdateCommandResult {
  reportId?: string;
  reportFile?: string;
}

export interface UpdateNotificationRecord {
  id: string;
  chatJid: string;
  cwd: string;
  status: 'started' | 'complete';
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  sentAt?: string;
  ok?: boolean;
  text?: string;
}

export interface CommandRunResult {
  stdout?: string;
  stderr?: string;
  status: number | null;
  signal?: NodeJS.Signals | null;
  error?: Error;
}

export interface CommandRunOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

export type CommandRunner = (
  command: string,
  args: string[],
  options: CommandRunOptions,
) => CommandRunResult;

export interface RunUpdateCommandOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  run?: CommandRunner;
  existsSync?: (filePath: string) => boolean;
  now?: () => Date;
}

export interface StartDetachedUpdateCommandOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  chatJid?: string;
  now?: () => Date;
  nodePath?: string;
  scriptPath?: string;
  reportDir?: string;
  spawnProcess?: (
    command: string,
    args: string[],
    options: {
      cwd: string;
      env: NodeJS.ProcessEnv;
      detached: true;
      stdio: 'ignore';
    },
  ) => Pick<ChildProcess, 'unref'>;
  existsSync?: (filePath: string) => boolean;
}

interface StepResult {
  ok: boolean;
  result: CommandRunResult;
}

interface UpdateLockRecord {
  pid: number;
  startedAt: string;
  reportId?: string;
}

const OUTPUT_LIMIT = 4000;
const MAX_BUFFER = 8 * 1024 * 1024;
const DEFAULT_STEP_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_LOCK_STALE_MS = 2 * 60 * 60 * 1000;

function defaultRunner(
  command: string,
  args: string[],
  options: CommandRunOptions,
): CommandRunResult {
  return spawnSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    env: options.env,
    maxBuffer: MAX_BUFFER,
    timeout: options.timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS,
  });
}

function boundedOutput(output: string): string {
  return output.length > OUTPUT_LIMIT
    ? `${output.slice(0, OUTPUT_LIMIT)}\n...truncated...`
    : output;
}

function combinedOutput(result: CommandRunResult): string {
  return [result.stdout || '', result.stderr || '']
    .filter((part) => part.trim().length > 0)
    .join('\n')
    .trim();
}

function autostashMarker(now: Date): string {
  return `fft-nano-update-autostash-${now.toISOString()}`;
}

function createUpdateReportId(now: Date): string {
  const stamp = now.toISOString().replace(/[^0-9A-Za-z]/g, '');
  return `update-${stamp}-${randomBytes(4).toString('hex')}`;
}

export function getUpdateNotificationsDir(cwd = process.cwd()): string {
  return path.join(cwd, 'data', 'update-notifications');
}

function getUpdateLockFile(cwd: string): string {
  return path.join(cwd, 'data', 'update.lock.json');
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readUpdateLock(lockFile: string): UpdateLockRecord | null {
  try {
    return JSON.parse(fs.readFileSync(lockFile, 'utf-8')) as UpdateLockRecord;
  } catch {
    return null;
  }
}

function getActiveUpdateLockReason(cwd: string): string | null {
  const lockFile = getUpdateLockFile(cwd);
  const staleMs = parsePositiveInt(
    process.env.FFT_NANO_UPDATE_LOCK_STALE_MS,
    DEFAULT_LOCK_STALE_MS,
  );
  const existing = readUpdateLock(lockFile);
  if (!existing) return null;
  const startedMs = Date.parse(existing.startedAt);
  const staleByTime =
    Number.isFinite(startedMs) && Date.now() - startedMs > staleMs;
  const alive = isPidAlive(existing.pid);
  if (!alive || staleByTime) return null;
  return `another update is already running (pid ${existing.pid}, started ${existing.startedAt})`;
}

function writeUpdateLock(lockFile: string, record: UpdateLockRecord): void {
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  const tempFile = `${lockFile}.${process.pid}.tmp`;
  fs.writeFileSync(tempFile, `${JSON.stringify(record, null, 2)}\n`);
  fs.renameSync(tempFile, lockFile);
}

function tryAcquireUpdateLock(
  cwd: string,
  reportId?: string,
): {
  ok: boolean;
  lockFile: string;
  reason?: string;
} {
  const lockFile = getUpdateLockFile(cwd);
  const staleMs = parsePositiveInt(
    process.env.FFT_NANO_UPDATE_LOCK_STALE_MS,
    DEFAULT_LOCK_STALE_MS,
  );
  const nowMs = Date.now();
  const existing = readUpdateLock(lockFile);
  if (existing) {
    const startedMs = Date.parse(existing.startedAt);
    const staleByTime =
      Number.isFinite(startedMs) && nowMs - startedMs > staleMs;
    const alive = isPidAlive(existing.pid);
    if (!alive || staleByTime) {
      try {
        fs.unlinkSync(lockFile);
      } catch {
        // Best effort; next open will fail if lock still exists.
      }
    } else {
      return {
        ok: false,
        lockFile,
        reason: `another update is already running (pid ${existing.pid}, started ${existing.startedAt})`,
      };
    }
  }

  fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  const handle = fs.openSync(lockFile, 'wx');
  fs.closeSync(handle);
  writeUpdateLock(lockFile, {
    pid: process.pid,
    startedAt: new Date(nowMs).toISOString(),
    reportId,
  });
  return { ok: true, lockFile };
}

function releaseUpdateLock(lockFile: string): void {
  try {
    fs.unlinkSync(lockFile);
  } catch {
    // Best-effort cleanup.
  }
}

export function writeUpdateNotification(
  reportFile: string,
  record: UpdateNotificationRecord,
): void {
  fs.mkdirSync(path.dirname(reportFile), { recursive: true });
  const tempFile = `${reportFile}.${process.pid}.tmp`;
  fs.writeFileSync(tempFile, `${JSON.stringify(record, null, 2)}\n`);
  fs.renameSync(tempFile, reportFile);
}

export function readUpdateNotification(
  reportFile: string,
): UpdateNotificationRecord | null {
  try {
    return JSON.parse(
      fs.readFileSync(reportFile, 'utf-8'),
    ) as UpdateNotificationRecord;
  } catch {
    return null;
  }
}

function findAutostashRef(stashList: string, marker: string): string | null {
  for (const line of stashList.split(/\r?\n/)) {
    const [ref, subject] = line.split('\0');
    if (ref && subject?.includes(marker)) return ref;
  }
  return null;
}

export function runUpdateCommand(
  options: RunUpdateCommandOptions = {},
): UpdateCommandResult {
  const cwd = options.cwd || process.cwd();
  const env = options.env || process.env;
  const run = options.run || defaultRunner;
  const existsSync = options.existsSync || fs.existsSync;
  const now = options.now || (() => new Date());
  const stepTimeoutMs = parsePositiveInt(
    env.FFT_NANO_UPDATE_STEP_TIMEOUT_MS,
    DEFAULT_STEP_TIMEOUT_MS,
  );
  const outputLines: string[] = [];
  let stashRef: string | null = null;
  let lockFile: string | null = null;

  const runRaw = (command: string, args: string[]): CommandRunResult =>
    run(command, args, { cwd, env, timeoutMs: stepTimeoutMs });

  const runStep = (
    label: string,
    command: string,
    args: string[],
  ): StepResult => {
    outputLines.push(`--- ${label} ---`);
    const result = runRaw(command, args);
    const output = combinedOutput(result);

    if (result.error) {
      outputLines.push(`Failed: ${result.error.message}`);
      return { ok: false, result };
    }

    if (output) outputLines.push(boundedOutput(output));

    if (result.status !== 0) {
      outputLines.push(
        `${label} failed with exit code ${result.status ?? 'unknown'}.`,
      );
      return { ok: false, result };
    }

    return { ok: true, result };
  };

  const fail = (message: string): UpdateCommandResult => {
    outputLines.push(message);
    return { ok: false, text: outputLines.join('\n') };
  };

  const restoreAutostashAfterAbort = (): boolean => {
    if (!stashRef) return true;
    const restore = runStep('git stash apply (restore after abort)', 'git', [
      'stash',
      'apply',
      stashRef,
    ]);
    if (!restore.ok) {
      outputLines.push(
        `Local changes remain saved in ${stashRef}. Restore manually with: git stash apply ${stashRef}`,
      );
      return false;
    }
    outputLines.push(
      `Local changes restored. Backup stash retained at ${stashRef}; drop it after inspection with: git stash drop ${stashRef}`,
    );
    return true;
  };

  const lock = tryAcquireUpdateLock(cwd);
  if (!lock.ok) {
    return fail(`Update not started: ${lock.reason}.`);
  }
  lockFile = lock.lockFile;

  try {
    const gitCheck = runRaw('git', ['rev-parse', '--is-inside-work-tree']);
    if (gitCheck.error) {
      return fail(`Failed checking git checkout: ${gitCheck.error.message}`);
    }
    if (gitCheck.status !== 0 || gitCheck.stdout?.trim() !== 'true') {
      return fail('Update aborted: current directory is not a git checkout.');
    }

    const status = runStep('git status', 'git', ['status', '--porcelain']);
    if (!status.ok) return fail('Update aborted before changing files.');

    const dirty = Boolean(status.result.stdout?.trim());
    if (dirty) {
      const marker = autostashMarker(now());
      outputLines.push('Local changes detected; stashing before update.');
      const stash = runStep('git stash', 'git', [
        'stash',
        'push',
        '--include-untracked',
        '-m',
        marker,
      ]);
      if (!stash.ok)
        return fail('Update aborted: could not stash local changes.');

      const stashList = runRaw('git', ['stash', 'list', '--format=%gd%x00%gs']);
      if (stashList.error) {
        return fail(
          `Update aborted: could not identify stash (${stashList.error.message}).`,
        );
      }
      stashRef = findAutostashRef(stashList.stdout || '', marker);
      if (!stashRef) {
        return fail(
          `Update aborted: created autostash marker was not found. Marker: ${marker}`,
        );
      }
      outputLines.push(`Saved local changes as ${stashRef}.`);
    }

    const fetch = runStep('git fetch', 'git', ['fetch', 'origin']);
    if (!fetch.ok) {
      restoreAutostashAfterAbort();
      return fail('Update aborted during fetch.');
    }

    const branch = runRaw('git', ['symbolic-ref', '--short', 'HEAD']);
    const currentBranch =
      branch.status === 0 && branch.stdout?.trim()
        ? branch.stdout.trim()
        : null;
    let pullBranch = currentBranch || 'main';
    if (currentBranch) {
      const remoteBranchCheck = runRaw('git', [
        'show-ref',
        '--verify',
        '--quiet',
        `refs/remotes/origin/${currentBranch}`,
      ]);
      if (remoteBranchCheck.status !== 0) {
        pullBranch = 'main';
        outputLines.push(
          `Remote branch origin/${currentBranch} not found; pulling origin/main instead.`,
        );
      }
    }
    const pullArgs = ['pull', '--ff-only', 'origin', pullBranch];
    const pull = runStep('git pull', 'git', pullArgs);
    if (!pull.ok) {
      restoreAutostashAfterAbort();
      return fail('Update aborted during pull.');
    }

    if (stashRef) {
      const apply = runStep('git stash apply', 'git', [
        'stash',
        'apply',
        stashRef,
      ]);
      if (!apply.ok) {
        return fail(
          `Update aborted: local changes could not be reapplied cleanly. Resolve conflicts, then recover with: git stash apply ${stashRef}`,
        );
      }

      const drop = runStep('git stash drop', 'git', [
        'stash',
        'drop',
        stashRef,
      ]);
      if (!drop.ok) {
        outputLines.push(
          `Warning: local changes were reapplied, but ${stashRef} could not be dropped. You may drop it manually after inspection.`,
        );
      }
    }

    const installStep = existsSync(path.join(cwd, 'package-lock.json'))
      ? runStep('npm ci', 'npm', ['ci', '--include=dev'])
      : runStep('npm install', 'npm', ['install', '--include=dev']);

    if (!installStep.ok && existsSync(path.join(cwd, 'package-lock.json'))) {
      outputLines.push('npm ci failed; falling back to npm install.');
      const fallbackInstall = runStep('npm install', 'npm', [
        'install',
        '--include=dev',
      ]);
      if (!fallbackInstall.ok) {
        return fail('Update aborted during dependency installation.');
      }
    } else if (!installStep.ok) {
      return fail('Update aborted during dependency installation.');
    }

    const build = runStep('npm run build', 'npm', ['run', 'build']);
    if (!build.ok) return fail('Update aborted during build.');

    outputLines.push('--- restart ---');
    const scriptPath = path.join(cwd, 'scripts', 'service.sh');
    if (!existsSync(scriptPath)) {
      outputLines.push('Service script not found. Restart manually.');
      return { ok: false, text: outputLines.join('\n') };
    }

    const restartResult = run('bash', [scriptPath, 'restart'], {
      cwd,
      env: {
        ...env,
        FFT_NANO_GATEWAY_CALL: '1',
        FFT_NANO_NONINTERACTIVE: '1',
      },
      timeoutMs: stepTimeoutMs,
    });

    const restartOutput = combinedOutput(restartResult);
    if (restartOutput) outputLines.push(boundedOutput(restartOutput));

    if (
      restartResult.status === null &&
      (restartResult.signal === 'SIGTERM' || restartResult.signal === 'SIGKILL')
    ) {
      outputLines.push('Update complete. Service restarting.');
      return { ok: true, text: outputLines.join('\n') };
    }

    if (restartResult.error) {
      outputLines.push(`Failed: ${restartResult.error.message}`);
      return { ok: false, text: outputLines.join('\n') };
    }

    if (restartResult.status !== 0) {
      outputLines.push(
        `Service restart failed with exit code ${restartResult.status ?? 'unknown'}. Update applied but service may need manual restart.`,
      );
      return { ok: false, text: outputLines.join('\n') };
    }

    const statusCheck = runStep('service status check', 'bash', [
      scriptPath,
      'status',
    ]);
    if (!statusCheck.ok) {
      return fail('Update applied, but service status verification failed.');
    }

    outputLines.push('Update complete. Service restarted.');
    return { ok: true, text: outputLines.join('\n') };
  } finally {
    if (lockFile) releaseUpdateLock(lockFile);
  }
}

export function startDetachedUpdateCommand(
  options: StartDetachedUpdateCommandOptions,
): UpdateCommandStartResult {
  const cwd = options.cwd || process.cwd();
  const env = options.env || process.env;
  const now = options.now || (() => new Date());
  const existsSync = options.existsSync || fs.existsSync;
  const nodePath = options.nodePath || process.execPath;
  const scriptPath =
    options.scriptPath || path.join(cwd, 'dist', 'update-worker.js');
  const reportDir = options.reportDir || getUpdateNotificationsDir(cwd);
  const spawnProcess = options.spawnProcess || spawn;

  const chatJid = (options.chatJid || '').trim();
  const activeLockReason = getActiveUpdateLockReason(cwd);
  if (activeLockReason) {
    return { ok: false, text: `Update not started: ${activeLockReason}.` };
  }
  if (!existsSync(scriptPath)) {
    return {
      ok: false,
      text: `Update not started: worker script not found at ${scriptPath}. Rebuild first.`,
    };
  }

  const startedAt = now();
  const reportId = createUpdateReportId(startedAt);
  const reportFile = path.join(reportDir, `${reportId}.json`);
  const record: UpdateNotificationRecord = {
    id: reportId,
    chatJid,
    cwd,
    status: 'started',
    startedAt: startedAt.toISOString(),
    updatedAt: startedAt.toISOString(),
  };

  try {
    writeUpdateNotification(reportFile, record);
    const child = spawnProcess(
      nodePath,
      [scriptPath, '--report-file', reportFile, '--cwd', cwd],
      {
        cwd,
        detached: true,
        stdio: 'ignore',
        env: {
          ...env,
          FFT_NANO_UPDATE_REPORT_FILE: reportFile,
          FFT_NANO_UPDATE_CWD: cwd,
        },
      },
    );
    child.unref?.();
    return {
      ok: true,
      reportId,
      reportFile,
      text: `Update worker started (${reportId}).`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const failedAt = now().toISOString();
    writeUpdateNotification(reportFile, {
      ...record,
      status: 'complete',
      ok: false,
      text: `Update worker failed to start: ${message}`,
      completedAt: failedAt,
      updatedAt: failedAt,
    });
    return {
      ok: false,
      reportId,
      reportFile,
      text: `Update not started: ${message}`,
    };
  }
}
