import fs from 'fs';
import os from 'os';
import path from 'path';

import { logger } from './logger.js';

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

export function acquireSingletonLock(lockPath: string): void {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });

  const payload = JSON.stringify({
    pid: process.pid,
    hostname: os.hostname(),
    startedAt: new Date().toISOString(),
  });

  const writeLock = () => {
    const fd = fs.openSync(lockPath, 'wx');
    try {
      fs.writeFileSync(fd, payload + '\n', 'utf-8');
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
      if (pidIsAlive(existingPid)) {
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

  const cleanup = () => {
    try {
      fs.unlinkSync(lockPath);
    } catch {
      /* ignore */
    }
  };

  process.on('exit', cleanup);
  process.on('SIGINT', () => {
    cleanup();
    process.exit(130);
  });
  process.on('SIGTERM', () => {
    cleanup();
    process.exit(143);
  });
}

