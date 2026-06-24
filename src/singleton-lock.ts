import fs from 'fs';
import os from 'os';
import path from 'path';

import { logger } from './logger.js';

// A held lock rewrites its mtime every HEARTBEAT_MS. A lock whose mtime is
// older than STALE_AFTER_MS is treated as abandoned even if its recorded pid
// happens to still resolve to *some* live process — pids get recycled by the
// OS after an unclean exit (SIGKILL/OOM), so liveness alone can't tell our
// process apart from an unrelated one that was later assigned the same pid.
const HEARTBEAT_MS = 5_000;
const STALE_AFTER_MS = HEARTBEAT_MS * 4;

function pidIsAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 1) return false;
  try {
    // kill(pid, 0) checks for existence/permission without sending a signal.
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function lockIsStale(lockPath: string): boolean {
  try {
    const mtimeMs = fs.statSync(lockPath).mtimeMs;
    return Date.now() - mtimeMs > STALE_AFTER_MS;
  } catch {
    // Can't stat it — don't claim staleness on that basis alone.
    return false;
  }
}

export function acquireSingletonLock(lockPath: string): void {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });

  const payload = () =>
    JSON.stringify({
      pid: process.pid,
      hostname: os.hostname(),
      startedAt: new Date().toISOString(),
    }) + '\n';

  const writeLock = () => {
    const fd = fs.openSync(lockPath, 'wx');
    try {
      fs.writeFileSync(fd, payload(), 'utf-8');
    } finally {
      fs.closeSync(fd);
    }
  };

  try {
    writeLock();
  } catch (err: any) {
    if (err && err.code === 'EEXIST') {
      let existing: any = null;
      try {
        existing = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
      } catch {
        // ignore parse errors; treat as stale below
      }

      const existingPid = Number(existing?.pid);
      if (pidIsAlive(existingPid) && !lockIsStale(lockPath)) {
        logger.error(
          { lockPath, existingPid, existing },
          'Another FFT_nano instance is already running',
        );
        console.error(
          `FATAL: Another FFT_nano instance is already running (pid=${existingPid}).\n` +
            `Stop the other instance (launchd or dev) before starting a new one.\n` +
            `Lock file: ${lockPath}\n`,
        );
        process.exit(1);
      }

      if (pidIsAlive(existingPid)) {
        logger.warn(
          { lockPath, existingPid, existing },
          'Reclaiming stale FFT_nano lock: pid is alive but heartbeat is stale (likely a recycled pid after an unclean exit)',
        );
      }

      // Stale lock: remove and retry once.
      try {
        fs.unlinkSync(lockPath);
      } catch {
        // If we cannot unlink, do not proceed.
        logger.error({ lockPath }, 'Failed to remove stale lock file');
        process.exit(1);
      }

      writeLock();
    } else {
      throw err;
    }
  }

  const heartbeat = setInterval(() => {
    try {
      fs.writeFileSync(lockPath, payload(), 'utf-8');
    } catch {
      // If the lock file vanished or is unwritable, leave it — the next
      // acquireSingletonLock call elsewhere will surface the real problem.
    }
  }, HEARTBEAT_MS);
  heartbeat.unref();

  const cleanup = () => {
    clearInterval(heartbeat);
    try {
      fs.unlinkSync(lockPath);
    } catch {
      /* ignore */
    }
  };

  // Cleanup is wired only to `process.on('exit', ...)`. The host (app.ts)
  // registers its own SIGINT/SIGTERM handlers that run an async shutdown
  // sequence (stop TUI/Web/prune/curator/farm services, then exit 0).
  // Registering signal handlers here would run AFTER the app's handlers
  // (signal listeners are invoked in registration order) and call
  // process.exit() synchronously, killing that async flow before it can
  // complete. `process.on('exit')` still fires on signal-induced exits
  // and is sufficient to remove the lockfile.
  process.on('exit', cleanup);
}
