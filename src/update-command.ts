import { randomBytes } from 'crypto';
import { spawn, spawnSync, type ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';

export type UpdateProgressPhase =
  | 'starting'
  | 'fetching'
  | 'pulling'
  | 'installing'
  | 'building'
  | 'restarting'
  | 'verifying'
  | 'complete';

export interface UpdateProgressEvent {
  phase: UpdateProgressPhase;
  label: string;
  status: 'started' | 'completed' | 'failed';
  message?: string;
  at: string;
  durationMs?: number;
  ok?: boolean;
}

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
  progress?: UpdateProgressEvent[];
  /** Index into the progress array that the update service has already processed */
  lastProgressIndex?: number;
  /** Telegram message ID of the preview message for editing in place */
  previewMessageId?: number;
  /** Flag indicating that the preview message send failed and we should use fallback mode */
  previewFailed?: boolean;
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
  onProgress?: (event: UpdateProgressEvent) => void;
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
const DEFAULT_HEALTH_SETTLE_MS = 8 * 1000;
const DEFAULT_HEALTH_RECHECK_MS = 5 * 1000;

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

/**
 * The install-recovery marker records that an update is partway through the
 * dependency-install + build span (the window where node_modules is wiped by
 * `npm ci` and the service cannot start). It is written before install and
 * cleared after a successful build. If the worker dies mid-install (crash,
 * reboot, kill), the launchd wrapper (scripts/run-launchd.sh) sees the marker
 * on next boot and self-heals (reinstall + build, or rollback to the recorded
 * SHA). Format: line 1 = pre-update SHA, line 2 = branch, line 3 = timestamp.
 */
export function getUpdateMarkerFile(cwd: string): string {
  return path.join(cwd, 'data', 'update-incomplete');
}

export function writeUpdateMarker(
  cwd: string,
  info: { preSha: string; branch: string; at: string },
): void {
  try {
    const file = getUpdateMarkerFile(cwd);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${info.preSha}\n${info.branch}\n${info.at}\n`);
  } catch {
    // Best-effort recovery insurance; never block an update on the marker.
  }
}

export function clearUpdateMarker(cwd: string): void {
  try {
    fs.unlinkSync(getUpdateMarkerFile(cwd));
  } catch {
    // Already gone.
  }
}

/** True when a command result looks like a spawn timeout (killed by the runner). */
function isTimeoutResult(result: CommandRunResult): boolean {
  if (!result.error) return false;
  const code = (result.error as NodeJS.ErrnoException).code;
  return (
    code === 'ETIMEDOUT' ||
    result.signal === 'SIGTERM' ||
    result.signal === 'SIGKILL'
  );
}

export function runUpdateCommand(
  options: RunUpdateCommandOptions = {},
): UpdateCommandResult {
  const cwd = options.cwd || process.cwd();
  const env = options.env || process.env;
  const run = options.run || defaultRunner;
  const existsSync = options.existsSync || fs.existsSync;
  const now = options.now || (() => new Date());
  const onProgress = options.onProgress;
  const stepTimeoutMs = parsePositiveInt(
    env.FFT_NANO_UPDATE_STEP_TIMEOUT_MS,
    DEFAULT_STEP_TIMEOUT_MS,
  );
  const healthSettleMs = parsePositiveInt(
    env.FFT_NANO_UPDATE_HEALTH_SETTLE_MS,
    DEFAULT_HEALTH_SETTLE_MS,
  );
  const healthRecheckMs = parsePositiveInt(
    env.FFT_NANO_UPDATE_HEALTH_RECHECK_MS,
    DEFAULT_HEALTH_RECHECK_MS,
  );
  const outputLines: string[] = [];
  let stashRef: string | null = null;
  let lockFile: string | null = null;

  const emit = (
    phase: UpdateProgressPhase,
    label: string,
    status: 'started' | 'completed' | 'failed',
    message?: string,
    durationMs?: number,
    ok?: boolean,
  ): void => {
    if (!onProgress) return;
    onProgress({
      phase,
      label,
      status,
      at: new Date().toISOString(),
      message,
      durationMs,
      ok,
    });
  };

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
      if (isTimeoutResult(result)) {
        const secs = Math.round(stepTimeoutMs / 1000);
        outputLines.push(
          `${label} timed out after ${secs}s with no completion (${result.error.message}).`,
        );
      } else {
        outputLines.push(`Failed: ${result.error.message}`);
      }
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
    // --- starting phase ---
    emit('starting', 'update worker started', 'started');
    const gitCheck = runRaw('git', ['rev-parse', '--is-inside-work-tree']);
    if (gitCheck.error) {
      emit('starting', 'git rev-parse', 'failed', gitCheck.error.message);
      return fail(`Failed checking git checkout: ${gitCheck.error.message}`);
    }
    if (gitCheck.status !== 0 || gitCheck.stdout?.trim() !== 'true') {
      emit('starting', 'git rev-parse', 'failed', 'not a git checkout');
      return fail('Update aborted: current directory is not a git checkout.');
    }

    const status = runStep('git status', 'git', ['status', '--porcelain']);
    if (!status.ok) {
      emit(
        'starting',
        'git status',
        'failed',
        status.result.stderr || 'failed',
      );
      return fail('Update aborted before changing files.');
    }
    emit(
      'starting',
      'update worker started',
      'completed',
      undefined,
      undefined,
      true,
    );

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
      if (!stash.ok) {
        emit('pulling', 'git stash', 'failed', stash.result.stderr || 'failed');
        return fail('Update aborted: could not stash local changes.');
      }

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

    // Resolve the target branch BEFORE fetch so the fetch can be scoped to a
    // single ref (a bare `git fetch origin` can stall on repos with many refs).
    const branch = runRaw('git', ['symbolic-ref', '--short', 'HEAD']);
    const currentBranch =
      branch.status === 0 && branch.stdout?.trim()
        ? branch.stdout.trim()
        : null;
    let pullBranch = currentBranch || 'main';

    // --- fetching phase ---
    emit('fetching', `git fetch origin ${pullBranch}`, 'started');
    let fetchStart = Date.now();
    let fetch = runStep('git fetch', 'git', ['fetch', 'origin', pullBranch]);
    if (!fetch.ok && currentBranch && pullBranch !== 'main') {
      // Current branch may not exist on origin; fall back to main.
      outputLines.push(
        `origin/${pullBranch} not found; fetching origin/main instead.`,
      );
      pullBranch = 'main';
      fetch = runStep('git fetch', 'git', ['fetch', 'origin', pullBranch]);
    }
    if (!fetch.ok) {
      const stderr = fetch.result.stderr || '';
      let reason = 'Update aborted during fetch.';
      if (
        /could not resolve host|unable to access|network is unreachable|temporary failure in name resolution|connection timed out/i.test(
          stderr,
        )
      ) {
        reason =
          'Update aborted: network error — cannot reach origin. Check connectivity and retry.';
      } else if (
        /authentication failed|could not read username|permission denied \(publickey\)/i.test(
          stderr,
        )
      ) {
        reason =
          'Update aborted: git authentication failed — check credentials or SSH key.';
      } else if (isTimeoutResult(fetch.result)) {
        reason =
          'Update aborted: git fetch timed out. Check connectivity and retry.';
      }
      emit(
        'fetching',
        `git fetch origin ${pullBranch}`,
        'failed',
        stderr || reason,
        Date.now() - fetchStart,
      );
      restoreAutostashAfterAbort();
      return fail(reason);
    }
    emit(
      'fetching',
      `git fetch origin ${pullBranch}`,
      'completed',
      undefined,
      Date.now() - fetchStart,
      true,
    );

    // --- up-to-date short-circuit ---
    // Skip the expensive install/build/restart when origin has no new commits.
    // Compare against FETCH_HEAD (always set by the fetch we just ran); a
    // scoped `git fetch origin <branch>` does NOT update refs/remotes/origin/*.
    const behind = runRaw('git', ['rev-list', '--count', 'HEAD..FETCH_HEAD']);
    const behindCount =
      behind.status === 0 ? Number((behind.stdout || '').trim()) : NaN;
    if (Number.isFinite(behindCount) && behindCount === 0) {
      if (stashRef) {
        runStep('git stash apply', 'git', ['stash', 'apply', stashRef]);
        runStep('git stash drop', 'git', ['stash', 'drop', stashRef]);
      }
      outputLines.push(
        'Already up to date. No new commits on origin; skipping rebuild and restart.',
      );
      emit(
        'complete',
        'already up to date',
        'completed',
        undefined,
        undefined,
        true,
      );
      return { ok: true, text: outputLines.join('\n') };
    }
    if (Number.isFinite(behindCount)) {
      outputLines.push(
        `Found ${behindCount} new commit(s) on origin/${pullBranch}.`,
      );
    }

    // Capture the pre-update commit so we can roll back if install/build/restart
    // fails on the new code.
    const headBefore = runRaw('git', ['rev-parse', 'HEAD']);
    const preSha =
      headBefore.status === 0 ? (headBefore.stdout || '').trim() : '';

    // --- pulling phase ---
    emit('pulling', 'git pull --ff-only', 'started');
    let pullStart = Date.now();
    const pull = runStep('git pull', 'git', [
      'pull',
      '--ff-only',
      'origin',
      pullBranch,
    ]);
    if (!pull.ok) {
      // Fast-forward failed — history diverged. Reset to origin only when the
      // local checkout has NO commits the remote lacks (the runtime should
      // never carry local commits). Otherwise preserve and abort.
      const ahead = runRaw('git', ['rev-list', '--count', 'FETCH_HEAD..HEAD']);
      const aheadCount =
        ahead.status === 0 ? Number((ahead.stdout || '').trim()) : NaN;
      if (Number.isFinite(aheadCount) && aheadCount === 0) {
        outputLines.push(
          'Fast-forward not possible (history diverged); resetting to match origin.',
        );
        const reset = runStep('git reset --hard origin', 'git', [
          'reset',
          '--hard',
          'FETCH_HEAD',
        ]);
        if (!reset.ok) {
          emit(
            'pulling',
            'git pull --ff-only',
            'failed',
            reset.result.stderr || 'reset failed',
            Date.now() - pullStart,
          );
          restoreAutostashAfterAbort();
          return fail(
            `Update aborted: could not reset to origin/${pullBranch}. Recover manually: git fetch origin && git reset --hard origin/${pullBranch}`,
          );
        }
      } else {
        emit(
          'pulling',
          'git pull --ff-only',
          'failed',
          pull.result.stderr || 'failed',
          Date.now() - pullStart,
        );
        restoreAutostashAfterAbort();
        return fail(
          `Update aborted during pull: local history has ${Number.isFinite(aheadCount) ? aheadCount : 'unknown'} commit(s) not on origin/${pullBranch}. Resolve manually.`,
        );
      }
    }
    emit(
      'pulling',
      'git pull --ff-only',
      'completed',
      pull.result.stdout || undefined,
      Date.now() - pullStart,
      true,
    );

    // Reapply local changes onto the new code. Keep the stash ref until the
    // build succeeds so a rollback can re-restore it after a hard reset.
    if (stashRef) {
      const apply = runStep('git stash apply', 'git', [
        'stash',
        'apply',
        stashRef,
      ]);
      if (!apply.ok) {
        emit(
          'pulling',
          'git stash apply',
          'failed',
          apply.result.stderr || 'failed',
        );
        return fail(
          `Update aborted: local changes could not be reapplied cleanly. Resolve conflicts, then recover with: git stash apply ${stashRef}`,
        );
      }
    }

    // ===== Past this point the working tree is on new code. Any failure
    // rolls back to preSha so the service always restarts on a known-good
    // build. The install-recovery marker covers the node_modules-wiped window
    // so a crash mid-install self-heals on next boot (scripts/run-launchd.sh).
    const scriptPath = path.join(cwd, 'scripts', 'service.sh');
    if (!existsSync(scriptPath)) {
      outputLines.push(
        'Service script not found (scripts/service.sh); aborting before install so the running service stays untouched.',
      );
      emit('restarting', 'service.sh restart', 'failed', 'script not found');
      return fail('Update aborted: scripts/service.sh not found.');
    }

    const installDeps = (tag: string): boolean => {
      const hasLock = existsSync(path.join(cwd, 'package-lock.json'));
      const label = `${hasLock ? 'npm ci' : 'npm install'}${tag}`;
      emit('installing', label, 'started');
      const start = Date.now();
      const primary = hasLock
        ? runStep('npm ci', 'npm', ['ci', '--include=dev'])
        : runStep('npm install', 'npm', ['install', '--include=dev']);
      if (primary.ok) {
        emit(
          'installing',
          label,
          'completed',
          primary.result.stdout || undefined,
          Date.now() - start,
          true,
        );
        return true;
      }
      if (hasLock) {
        outputLines.push('npm ci failed; falling back to npm install.');
        const fb = runStep('npm install', 'npm', ['install', '--include=dev']);
        if (fb.ok) {
          emit(
            'installing',
            `npm install${tag}`,
            'completed',
            fb.result.stdout || undefined,
            Date.now() - start,
            true,
          );
          return true;
        }
        emit(
          'installing',
          `npm install${tag}`,
          'failed',
          fb.result.stderr || 'failed',
          Date.now() - start,
        );
        return false;
      }
      emit(
        'installing',
        label,
        'failed',
        primary.result.stderr || 'failed',
        Date.now() - start,
      );
      return false;
    };

    const readServicePid = (): number | null => {
      const res = runRaw('bash', [scriptPath, 'pid']);
      const n = Number((res.stdout || '').trim());
      return Number.isInteger(n) && n > 0 ? n : null;
    };

    // Restart returns restarting=true when the restart terminated this caller
    // (expected in host configs where the worker is inside the service tree).
    const restartService = (
      tag: string,
    ): { ok: boolean; restarting: boolean; detail: string } => {
      emit('restarting', `service.sh restart${tag}`, 'started');
      const start = Date.now();
      const res = run('bash', [scriptPath, 'restart'], {
        cwd,
        env: {
          ...env,
          FFT_NANO_GATEWAY_CALL: '1',
          FFT_NANO_NONINTERACTIVE: '1',
        },
        timeoutMs: stepTimeoutMs,
      });
      const out = combinedOutput(res);
      if (out) outputLines.push(boundedOutput(out));
      if (
        res.status === null &&
        (res.signal === 'SIGTERM' || res.signal === 'SIGKILL')
      ) {
        emit(
          'restarting',
          `service.sh restart${tag}`,
          'completed',
          'SIGTERM received (expected)',
          Date.now() - start,
          true,
        );
        return {
          ok: true,
          restarting: true,
          detail: 'caller terminated by restart (expected)',
        };
      }
      if (res.error) {
        emit(
          'restarting',
          `service.sh restart${tag}`,
          'failed',
          res.error.message,
          Date.now() - start,
        );
        return { ok: false, restarting: false, detail: res.error.message };
      }
      if (res.status !== 0) {
        emit(
          'restarting',
          `service.sh restart${tag}`,
          'failed',
          `exit code ${res.status ?? 'unknown'}`,
          Date.now() - start,
        );
        return {
          ok: false,
          restarting: false,
          detail: `service restart exited ${res.status ?? 'unknown'}`,
        };
      }
      emit(
        'restarting',
        `service.sh restart${tag}`,
        'completed',
        res.stdout || undefined,
        Date.now() - start,
        true,
      );
      return { ok: true, restarting: false, detail: 'restarted' };
    };

    // Health gate: confirm the new process actually stays up. A stable,
    // unchanged PID across two samples means it booted; a missing or changing
    // PID means it failed or is crash-looping.
    const verifyHealth = (): { ok: boolean; detail: string } => {
      emit('verifying', 'service health check', 'started');
      const vStart = Date.now();
      runRaw('sleep', [String(Math.max(1, Math.round(healthSettleMs / 1000)))]);
      const pid1 = readServicePid();
      if (!pid1) {
        emit(
          'verifying',
          'service health check',
          'failed',
          'no running PID after restart',
          Date.now() - vStart,
        );
        return {
          ok: false,
          detail: 'service did not report a running process after restart',
        };
      }
      runRaw('sleep', [
        String(Math.max(1, Math.round(healthRecheckMs / 1000))),
      ]);
      const pid2 = readServicePid();
      if (!pid2) {
        emit(
          'verifying',
          'service health check',
          'failed',
          'process exited after restart',
          Date.now() - vStart,
        );
        return { ok: false, detail: 'service exited shortly after restart' };
      }
      if (pid1 !== pid2) {
        emit(
          'verifying',
          'service health check',
          'failed',
          `pid ${pid1} -> ${pid2} (crash-looping)`,
          Date.now() - vStart,
        );
        return {
          ok: false,
          detail: `service is crash-looping (pid changed ${pid1} -> ${pid2})`,
        };
      }
      emit(
        'verifying',
        'service health check',
        'completed',
        `healthy (pid ${pid1})`,
        Date.now() - vStart,
        true,
      );
      return { ok: true, detail: `healthy (pid ${pid1})` };
    };

    const rollbackToKnownGood = (reason: string): UpdateCommandResult => {
      outputLines.push('--- rollback ---');
      outputLines.push(`Update failed: ${reason}`);
      if (!preSha) {
        clearUpdateMarker(cwd);
        return fail(
          `${reason} Rollback unavailable: pre-update commit was not captured. Recover manually: git reflog && git reset --hard <previous-sha>.`,
        );
      }
      emit(
        'restarting',
        `rolling back to ${preSha.slice(0, 10)}`,
        'started',
        reason,
      );
      writeUpdateMarker(cwd, {
        preSha,
        branch: pullBranch,
        at: now().toISOString(),
      });
      const reset = runStep('git reset --hard (rollback)', 'git', [
        'reset',
        '--hard',
        preSha,
      ]);
      if (!reset.ok) {
        clearUpdateMarker(cwd);
        emit('restarting', 'rollback', 'failed', 'git reset failed');
        return fail(
          `Rollback FAILED: could not reset to ${preSha.slice(0, 10)}. Recover manually: cd ${cwd} && git reset --hard ${preSha}`,
        );
      }
      if (stashRef) {
        runStep('git stash apply (rollback)', 'git', [
          'stash',
          'apply',
          stashRef,
        ]);
      }
      if (!installDeps(' (rollback)')) {
        return fail(
          `Rolled back code to ${preSha.slice(0, 10)} but dependency reinstall failed. Run: cd ${cwd} && npm ci && npm run build && bash scripts/service.sh restart`,
        );
      }
      emit('building', 'npm run build (rollback)', 'started');
      const rb = runStep('npm run build (rollback)', 'npm', ['run', 'build']);
      if (!rb.ok) {
        emit(
          'building',
          'npm run build (rollback)',
          'failed',
          rb.result.stderr || 'failed',
        );
        return fail(
          `Rolled back code to ${preSha.slice(0, 10)} but rebuild failed. Run: cd ${cwd} && npm run build && bash scripts/service.sh restart`,
        );
      }
      emit(
        'building',
        'npm run build (rollback)',
        'completed',
        undefined,
        undefined,
        true,
      );
      clearUpdateMarker(cwd);
      const restart = restartService(' (rollback)');
      emit(
        'complete',
        'rolled back to previous version',
        'completed',
        reason,
        undefined,
        false,
      );
      if (restart.restarting) {
        return {
          ok: false,
          text: `${outputLines.join('\n')}\nRolled back to the previous working version (${preSha.slice(0, 10)}); service restarting.`,
        };
      }
      if (!restart.ok) {
        return {
          ok: false,
          text: `${outputLines.join('\n')}\nRolled back code to ${preSha.slice(0, 10)} but service restart failed: ${restart.detail}. Restart manually: bash scripts/service.sh restart`,
        };
      }
      return {
        ok: false,
        text: `${outputLines.join('\n')}\nUpdate failed and was rolled back to the previous working version (${preSha.slice(0, 10)}). Service restarted on the prior build.`,
      };
    };

    // --- installing phase ---
    writeUpdateMarker(cwd, {
      preSha,
      branch: pullBranch,
      at: now().toISOString(),
    });
    if (!installDeps('')) {
      return rollbackToKnownGood('dependency installation failed.');
    }

    // --- building phase ---
    emit('building', 'npm run build', 'started');
    let buildStart = Date.now();
    const build = runStep('npm run build', 'npm', ['run', 'build']);
    if (!build.ok) {
      emit(
        'building',
        'npm run build',
        'failed',
        build.result.stderr || 'failed',
        Date.now() - buildStart,
      );
      return rollbackToKnownGood('build failed on the new code.');
    }
    emit(
      'building',
      'npm run build',
      'completed',
      build.result.stdout || undefined,
      Date.now() - buildStart,
      true,
    );

    // Deps + dist are good. Clear the recovery marker before restart so a clean
    // reboot during the restart window does not re-run boot recovery.
    clearUpdateMarker(cwd);

    // Drop the autostash now that the new build includes the local changes.
    if (stashRef) {
      const drop = runStep('git stash drop', 'git', [
        'stash',
        'drop',
        stashRef,
      ]);
      if (!drop.ok) {
        outputLines.push(
          `Warning: local changes were reapplied, but ${stashRef} could not be dropped. Drop it manually after inspection.`,
        );
      }
      stashRef = null;
    }

    // --- restarting phase ---
    outputLines.push('--- restart ---');
    const restart = restartService('');
    if (restart.restarting) {
      // The restart terminated this caller; the new process is coming up and we
      // cannot verify health from a dead process. Report success optimistically.
      outputLines.push('Update complete. Service restarting.');
      emit(
        'complete',
        'update complete',
        'completed',
        undefined,
        undefined,
        true,
      );
      return { ok: true, text: outputLines.join('\n') };
    }
    if (!restart.ok) {
      return rollbackToKnownGood(`service restart failed: ${restart.detail}.`);
    }

    // --- verifying phase: confirm the new build actually stays up ---
    const health = verifyHealth();
    if (!health.ok) {
      return rollbackToKnownGood(health.detail);
    }

    outputLines.push(
      `Update complete. Service restarted and verified ${health.detail}.`,
    );
    emit(
      'complete',
      'update complete',
      'completed',
      undefined,
      undefined,
      true,
    );
    return { ok: true, text: outputLines.join('\n') };
  } finally {
    if (lockFile) releaseUpdateLock(lockFile);
  }
}

/**
 * resolveRef calls the installer's resolve_ref() bash function.
 * It sources installScriptPath in a bash subshell and invokes resolve_ref
 * with the given repo and ref, returning the resolved tag.
 *
 * This is used by the installer-update-e2e integration test to exercise
 * the full installer + update loop with a real local git fixture.
 */
export async function resolveRef(
  repo: string,
  ref: string,
  installScriptPath: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'bash',
      ['-c', `set -euo pipefail; source "${installScriptPath}" && resolve_ref`],
      {
        env: { ...process.env, REPO: repo, REF: ref },
        cwd: path.dirname(installScriptPath),
        timeout: 30_000,
      },
    );
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(
          new Error(`resolve_ref exited ${code}${stderr ? `: ${stderr}` : ''}`),
        );
      }
    });
    child.on('error', (err) => {
      reject(err);
    });
  });
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
