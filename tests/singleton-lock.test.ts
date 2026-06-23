import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import test from 'node:test';

import { acquireSingletonLock } from '../src/singleton-lock.js';

function makeTmpLockPath(): string {
  return path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'fft-nano-lock-')),
    'fft_nano.lock',
  );
}

test('acquireSingletonLock creates the lock file', () => {
  const lockPath = makeTmpLockPath();
  acquireSingletonLock(lockPath);
  assert.ok(fs.existsSync(lockPath));
  const payload = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
  assert.equal(payload.pid, process.pid);
  // Tidy up so we don't leave a real lock file behind.
  fs.unlinkSync(lockPath);
  fs.rmdirSync(path.dirname(lockPath));
});

test('acquireSingletonLock does not register SIGINT/SIGTERM handlers', () => {
  // Snapshot signal handler counts before and after acquiring the lock.
  // If the lock were to install its own SIGINT/SIGTERM listeners, the
  // count would grow and it would call process.exit() synchronously
  // ahead of the app's async shutdown sequence.
  const lockPath = makeTmpLockPath();
  const sigintBefore = process.listenerCount('SIGINT');
  const sigtermBefore = process.listenerCount('SIGTERM');
  acquireSingletonLock(lockPath);
  try {
    assert.equal(
      process.listenerCount('SIGINT'),
      sigintBefore,
      'lock must not register SIGINT handler',
    );
    assert.equal(
      process.listenerCount('SIGTERM'),
      sigtermBefore,
      'lock must not register SIGTERM handler',
    );
  } finally {
    fs.unlinkSync(lockPath);
    fs.rmdirSync(path.dirname(lockPath));
  }
});

test('acquireSingletonLock removes the lock file on process exit', () => {
  // Simulate the "exit" event firing (this is what runs on SIGINT/SIGTERM
  // once the app's async shutdown is done). After the simulated exit, the
  // lockfile must be gone.
  const lockPath = makeTmpLockPath();
  acquireSingletonLock(lockPath);
  assert.ok(fs.existsSync(lockPath));
  process.emit('exit', 0);
  assert.equal(
    fs.existsSync(lockPath),
    false,
    'lockfile should be removed by the exit handler',
  );
});
