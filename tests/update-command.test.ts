import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  readUpdateNotification,
  runUpdateCommand,
  startDetachedUpdateCommand,
  type CommandRunOptions,
  type CommandRunResult,
  type UpdateProgressEvent,
} from '../src/update-command.js';

interface ExpectedCommand {
  command: string;
  args: string[];
  result: CommandRunResult;
}

function makeRunner(expected: ExpectedCommand[]) {
  const calls: Array<{
    command: string;
    args: string[];
    options: CommandRunOptions;
  }> = [];
  const run = (
    command: string,
    args: string[],
    options: CommandRunOptions,
  ): CommandRunResult => {
    calls.push({ command, args, options });
    const next = expected.shift();
    assert.ok(next, `Unexpected command: ${command} ${args.join(' ')}`);
    assert.equal(command, next.command);
    assert.deepEqual(args, next.args);
    return next.result;
  };
  return { run, calls, remaining: expected };
}

function ok(stdout = ''): CommandRunResult {
  return { status: 0, stdout };
}

function fail(stderr = 'failed'): CommandRunResult {
  return { status: 1, stderr };
}

function timeoutResult(): CommandRunResult {
  return {
    status: null,
    signal: 'SIGTERM',
    error: Object.assign(new Error('spawnSync git ETIMEDOUT'), {
      code: 'ETIMEDOUT',
    }),
  };
}

const cwd = '/tmp/fft_nano';
const sh = '/tmp/fft_nano/scripts/service.sh';
const fixedNow = () => new Date('2026-05-19T12:34:56.000Z');
const marker = 'fft-nano-update-autostash-2026-05-19T12:34:56.000Z';
const preSha = 'abc123def4567890';
const lockAndScript = (filePath: string) =>
  filePath === '/tmp/fft_nano/package-lock.json' || filePath === sh;

// --- reusable command segments --------------------------------------------

function guard(): ExpectedCommand[] {
  return [
    {
      command: 'git',
      args: ['rev-parse', '--is-inside-work-tree'],
      result: ok('true\n'),
    },
  ];
}

function cleanPrelude(branch = 'main', behind = '2'): ExpectedCommand[] {
  return [
    ...guard(),
    { command: 'git', args: ['status', '--porcelain'], result: ok('') },
    {
      command: 'git',
      args: ['symbolic-ref', '--short', 'HEAD'],
      result: ok(`${branch}\n`),
    },
    { command: 'git', args: ['fetch', 'origin', branch], result: ok('') },
    {
      command: 'git',
      args: ['rev-list', '--count', 'HEAD..FETCH_HEAD'],
      result: ok(`${behind}\n`),
    },
    { command: 'git', args: ['rev-parse', 'HEAD'], result: ok(`${preSha}\n`) },
    {
      command: 'git',
      args: ['pull', '--ff-only', 'origin', branch],
      result: ok('Updating abc..def\n'),
    },
  ];
}

function installBuild(): ExpectedCommand[] {
  return [
    { command: 'npm', args: ['ci', '--include=dev'], result: ok('installed\n') },
    { command: 'npm', args: ['run', 'build'], result: ok('built\n') },
  ];
}

function restartVerifyHealthy(pid = '4242'): ExpectedCommand[] {
  return [
    { command: 'bash', args: [sh, 'restart'], result: ok('restarted\n') },
    { command: 'sleep', args: ['8'], result: ok('') },
    { command: 'bash', args: [sh, 'pid'], result: ok(`${pid}\n`) },
    { command: 'sleep', args: ['5'], result: ok('') },
    { command: 'bash', args: [sh, 'pid'], result: ok(`${pid}\n`) },
  ];
}

// --- happy paths -----------------------------------------------------------

test('runUpdateCommand updates a clean checkout and verifies health', () => {
  const { run, remaining } = makeRunner([
    ...cleanPrelude(),
    ...installBuild(),
    ...restartVerifyHealthy(),
  ]);

  const result = runUpdateCommand({ cwd, run, existsSync: lockAndScript });

  assert.equal(result.ok, true);
  assert.match(
    result.text,
    /Update complete\. Service restarted and verified healthy \(pid 4242\)/,
  );
  assert.equal(remaining.length, 0);
});

test('runUpdateCommand stashes dirty changes, reapplies after pull, drops after build', () => {
  const { run, calls, remaining } = makeRunner([
    ...guard(),
    {
      command: 'git',
      args: ['status', '--porcelain'],
      result: ok(' M README.md\n?? local.txt\n'),
    },
    {
      command: 'git',
      args: ['stash', 'push', '--include-untracked', '-m', marker],
      result: ok(`Saved working directory and index state On main: ${marker}\n`),
    },
    {
      command: 'git',
      args: ['stash', 'list', '--format=%gd%x00%gs'],
      result: ok(`stash@{0}\0On main: ${marker}\n`),
    },
    {
      command: 'git',
      args: ['symbolic-ref', '--short', 'HEAD'],
      result: ok('main\n'),
    },
    { command: 'git', args: ['fetch', 'origin', 'main'], result: ok('') },
    {
      command: 'git',
      args: ['rev-list', '--count', 'HEAD..FETCH_HEAD'],
      result: ok('2\n'),
    },
    { command: 'git', args: ['rev-parse', 'HEAD'], result: ok(`${preSha}\n`) },
    {
      command: 'git',
      args: ['pull', '--ff-only', 'origin', 'main'],
      result: ok('Updating abc..def\n'),
    },
    { command: 'git', args: ['stash', 'apply', 'stash@{0}'], result: ok('') },
    ...installBuild(),
    {
      command: 'git',
      args: ['stash', 'drop', 'stash@{0}'],
      result: ok('Dropped stash@{0}\n'),
    },
    // restart terminates the caller (SIGTERM) — early success, no health probe
    {
      command: 'bash',
      args: [sh, 'restart'],
      result: { status: null, signal: 'SIGTERM', stdout: '' },
    },
  ]);

  const result = runUpdateCommand({
    cwd,
    run,
    now: fixedNow,
    existsSync: lockAndScript,
  });

  assert.equal(result.ok, true);
  assert.match(result.text, /Saved local changes as stash@\{0\}/);
  assert.match(result.text, /Update complete\. Service restarting\./);
  assert.equal(remaining.length, 0);
  // stash drop must happen AFTER build, not before
  const dropIdx = calls.findIndex(
    (c) => c.command === 'git' && c.args.join(' ') === 'stash drop stash@{0}',
  );
  const buildIdx = calls.findIndex(
    (c) => c.command === 'npm' && c.args.join(' ') === 'run build',
  );
  assert.ok(dropIdx > buildIdx, 'stash drop should follow the build');
});

test('runUpdateCommand falls back to origin/main when branch upstream is gone', () => {
  const { run, remaining } = makeRunner([
    ...guard(),
    { command: 'git', args: ['status', '--porcelain'], result: ok('') },
    {
      command: 'git',
      args: ['symbolic-ref', '--short', 'HEAD'],
      result: ok('codex/fix-update\n'),
    },
    {
      command: 'git',
      args: ['fetch', 'origin', 'codex/fix-update'],
      result: fail('couldn’t find remote ref'),
    },
    { command: 'git', args: ['fetch', 'origin', 'main'], result: ok('') },
    {
      command: 'git',
      args: ['rev-list', '--count', 'HEAD..FETCH_HEAD'],
      result: ok('1\n'),
    },
    { command: 'git', args: ['rev-parse', 'HEAD'], result: ok(`${preSha}\n`) },
    {
      command: 'git',
      args: ['pull', '--ff-only', 'origin', 'main'],
      result: ok('Updating abc..def\n'),
    },
    ...installBuild(),
    ...restartVerifyHealthy(),
  ]);

  const result = runUpdateCommand({ cwd, run, existsSync: lockAndScript });

  assert.equal(result.ok, true);
  assert.match(
    result.text,
    /origin\/codex\/fix-update not found; fetching origin\/main instead\./,
  );
  assert.equal(remaining.length, 0);
});

// --- up-to-date short-circuit ---------------------------------------------

test('runUpdateCommand short-circuits when origin has no new commits', () => {
  const { run, calls, remaining } = makeRunner([
    ...guard(),
    { command: 'git', args: ['status', '--porcelain'], result: ok('') },
    {
      command: 'git',
      args: ['symbolic-ref', '--short', 'HEAD'],
      result: ok('main\n'),
    },
    { command: 'git', args: ['fetch', 'origin', 'main'], result: ok('') },
    {
      command: 'git',
      args: ['rev-list', '--count', 'HEAD..FETCH_HEAD'],
      result: ok('0\n'),
    },
  ]);

  const result = runUpdateCommand({ cwd, run, existsSync: lockAndScript });

  assert.equal(result.ok, true);
  assert.match(result.text, /Already up to date/);
  assert.equal(remaining.length, 0);
  assert.equal(
    calls.some((c) => c.command === 'npm'),
    false,
    'no install/build when nothing to update',
  );
  assert.equal(
    calls.some((c) => c.command === 'git' && c.args[0] === 'pull'),
    false,
    'no pull when nothing to update',
  );
});

test('runUpdateCommand restores stash on a no-op (dirty) short-circuit', () => {
  const { run, remaining } = makeRunner([
    ...guard(),
    {
      command: 'git',
      args: ['status', '--porcelain'],
      result: ok(' M README.md\n'),
    },
    {
      command: 'git',
      args: ['stash', 'push', '--include-untracked', '-m', marker],
      result: ok(`Saved working directory and index state On main: ${marker}\n`),
    },
    {
      command: 'git',
      args: ['stash', 'list', '--format=%gd%x00%gs'],
      result: ok(`stash@{0}\0On main: ${marker}\n`),
    },
    {
      command: 'git',
      args: ['symbolic-ref', '--short', 'HEAD'],
      result: ok('main\n'),
    },
    { command: 'git', args: ['fetch', 'origin', 'main'], result: ok('') },
    {
      command: 'git',
      args: ['rev-list', '--count', 'HEAD..FETCH_HEAD'],
      result: ok('0\n'),
    },
    { command: 'git', args: ['stash', 'apply', 'stash@{0}'], result: ok('') },
    {
      command: 'git',
      args: ['stash', 'drop', 'stash@{0}'],
      result: ok('Dropped stash@{0}\n'),
    },
  ]);

  const result = runUpdateCommand({
    cwd,
    run,
    now: fixedNow,
    existsSync: lockAndScript,
  });

  assert.equal(result.ok, true);
  assert.match(result.text, /Already up to date/);
  assert.equal(remaining.length, 0);
});

// --- diverged history fallback --------------------------------------------

test('runUpdateCommand resets to origin when ff fails and local is not ahead', () => {
  const { run, remaining } = makeRunner([
    ...guard(),
    { command: 'git', args: ['status', '--porcelain'], result: ok('') },
    {
      command: 'git',
      args: ['symbolic-ref', '--short', 'HEAD'],
      result: ok('main\n'),
    },
    { command: 'git', args: ['fetch', 'origin', 'main'], result: ok('') },
    {
      command: 'git',
      args: ['rev-list', '--count', 'HEAD..FETCH_HEAD'],
      result: ok('3\n'),
    },
    { command: 'git', args: ['rev-parse', 'HEAD'], result: ok(`${preSha}\n`) },
    {
      command: 'git',
      args: ['pull', '--ff-only', 'origin', 'main'],
      result: fail('fatal: Not possible to fast-forward\n'),
    },
    {
      command: 'git',
      args: ['rev-list', '--count', 'FETCH_HEAD..HEAD'],
      result: ok('0\n'),
    },
    {
      command: 'git',
      args: ['reset', '--hard', 'FETCH_HEAD'],
      result: ok('HEAD is now at def\n'),
    },
    ...installBuild(),
    ...restartVerifyHealthy(),
  ]);

  const result = runUpdateCommand({ cwd, run, existsSync: lockAndScript });

  assert.equal(result.ok, true);
  assert.match(result.text, /resetting to match origin/);
  assert.equal(remaining.length, 0);
});

test('runUpdateCommand aborts a diverged pull when local has unpushed commits', () => {
  const events: UpdateProgressEvent[] = [];
  const { run, calls, remaining } = makeRunner([
    ...guard(),
    { command: 'git', args: ['status', '--porcelain'], result: ok('') },
    {
      command: 'git',
      args: ['symbolic-ref', '--short', 'HEAD'],
      result: ok('main\n'),
    },
    { command: 'git', args: ['fetch', 'origin', 'main'], result: ok('') },
    {
      command: 'git',
      args: ['rev-list', '--count', 'HEAD..FETCH_HEAD'],
      result: ok('1\n'),
    },
    { command: 'git', args: ['rev-parse', 'HEAD'], result: ok(`${preSha}\n`) },
    {
      command: 'git',
      args: ['pull', '--ff-only', 'origin', 'main'],
      result: fail('fatal: Not possible to fast-forward\n'),
    },
    {
      command: 'git',
      args: ['rev-list', '--count', 'FETCH_HEAD..HEAD'],
      result: ok('2\n'),
    },
  ]);

  const result = runUpdateCommand({
    cwd,
    run,
    existsSync: lockAndScript,
    onProgress: (e) => events.push(e),
  });

  assert.equal(result.ok, false);
  assert.match(result.text, /local history has 2 commit/);
  assert.equal(remaining.length, 0);
  assert.equal(
    calls.some((c) => c.command === 'npm'),
    false,
  );
  assert.ok(
    events.some((e) => e.phase === 'pulling' && e.status === 'failed'),
  );
});

test('runUpdateCommand aborts before build when autostash cannot be reapplied', () => {
  const { run, calls, remaining } = makeRunner([
    ...guard(),
    {
      command: 'git',
      args: ['status', '--porcelain'],
      result: ok(' M src/index.ts\n'),
    },
    {
      command: 'git',
      args: ['stash', 'push', '--include-untracked', '-m', marker],
      result: ok(`Saved working directory and index state On main: ${marker}\n`),
    },
    {
      command: 'git',
      args: ['stash', 'list', '--format=%gd%x00%gs'],
      result: ok(`stash@{0}\0On main: ${marker}\n`),
    },
    {
      command: 'git',
      args: ['symbolic-ref', '--short', 'HEAD'],
      result: ok('main\n'),
    },
    { command: 'git', args: ['fetch', 'origin', 'main'], result: ok('') },
    {
      command: 'git',
      args: ['rev-list', '--count', 'HEAD..FETCH_HEAD'],
      result: ok('2\n'),
    },
    { command: 'git', args: ['rev-parse', 'HEAD'], result: ok(`${preSha}\n`) },
    {
      command: 'git',
      args: ['pull', '--ff-only', 'origin', 'main'],
      result: ok('Updating abc..def\n'),
    },
    {
      command: 'git',
      args: ['stash', 'apply', 'stash@{0}'],
      result: fail('CONFLICT (content): Merge conflict\n'),
    },
  ]);

  const result = runUpdateCommand({
    cwd,
    run,
    now: fixedNow,
    existsSync: lockAndScript,
  });

  assert.equal(result.ok, false);
  assert.match(result.text, /could not be reapplied cleanly/);
  assert.match(result.text, /git stash apply stash@\{0\}/);
  assert.equal(remaining.length, 0);
  assert.equal(
    calls.some((c) => c.command === 'npm'),
    false,
  );
});

// --- auto-rollback ---------------------------------------------------------

test('runUpdateCommand rolls back to the prior commit when install fails', () => {
  const { run, calls, remaining } = makeRunner([
    ...cleanPrelude('main', '2'),
    // forward install fails (ci then install fallback)
    { command: 'npm', args: ['ci', '--include=dev'], result: fail('ENETWORK') },
    { command: 'npm', args: ['install', '--include=dev'], result: fail('ENETWORK') },
    // rollback
    {
      command: 'git',
      args: ['reset', '--hard', preSha],
      result: ok('HEAD is now at abc\n'),
    },
    { command: 'npm', args: ['ci', '--include=dev'], result: ok('installed\n') },
    { command: 'npm', args: ['run', 'build'], result: ok('built\n') },
    { command: 'bash', args: [sh, 'restart'], result: ok('restarted\n') },
  ]);

  const result = runUpdateCommand({ cwd, run, existsSync: lockAndScript });

  assert.equal(result.ok, false);
  assert.match(result.text, /rolled back to the previous working version/i);
  assert.match(result.text, /abc123def4/);
  assert.equal(remaining.length, 0);
  assert.ok(
    calls.some((c) => c.command === 'git' && c.args.join(' ') === `reset --hard ${preSha}`),
    'must hard-reset to the captured pre-update SHA',
  );
});

test('runUpdateCommand rolls back when the new code fails to build', () => {
  const { run, remaining } = makeRunner([
    ...cleanPrelude('main', '2'),
    { command: 'npm', args: ['ci', '--include=dev'], result: ok('installed\n') },
    { command: 'npm', args: ['run', 'build'], result: fail('TS2304\n') },
    {
      command: 'git',
      args: ['reset', '--hard', preSha],
      result: ok('HEAD is now at abc\n'),
    },
    { command: 'npm', args: ['ci', '--include=dev'], result: ok('installed\n') },
    { command: 'npm', args: ['run', 'build'], result: ok('built\n') },
    { command: 'bash', args: [sh, 'restart'], result: ok('restarted\n') },
  ]);

  const result = runUpdateCommand({ cwd, run, existsSync: lockAndScript });

  assert.equal(result.ok, false);
  assert.match(result.text, /build failed on the new code/);
  assert.match(result.text, /rolled back/i);
  assert.equal(remaining.length, 0);
});

test('runUpdateCommand rolls back when the restarted service crash-loops', () => {
  const { run, remaining } = makeRunner([
    ...cleanPrelude('main', '2'),
    ...installBuild(),
    { command: 'bash', args: [sh, 'restart'], result: ok('restarted\n') },
    { command: 'sleep', args: ['8'], result: ok('') },
    { command: 'bash', args: [sh, 'pid'], result: ok('100\n') },
    { command: 'sleep', args: ['5'], result: ok('') },
    { command: 'bash', args: [sh, 'pid'], result: ok('200\n') },
    // rollback
    {
      command: 'git',
      args: ['reset', '--hard', preSha],
      result: ok('HEAD is now at abc\n'),
    },
    { command: 'npm', args: ['ci', '--include=dev'], result: ok('installed\n') },
    { command: 'npm', args: ['run', 'build'], result: ok('built\n') },
    { command: 'bash', args: [sh, 'restart'], result: ok('restarted\n') },
  ]);

  const result = runUpdateCommand({ cwd, run, existsSync: lockAndScript });

  assert.equal(result.ok, false);
  assert.match(result.text, /crash-looping/);
  assert.match(result.text, /rolled back/i);
  assert.equal(remaining.length, 0);
});

// --- timeouts & errors -----------------------------------------------------

test('runUpdateCommand surfaces a fetch timeout with a clear message', () => {
  const { run, remaining } = makeRunner([
    ...guard(),
    { command: 'git', args: ['status', '--porcelain'], result: ok('') },
    {
      command: 'git',
      args: ['symbolic-ref', '--short', 'HEAD'],
      result: ok('main\n'),
    },
    { command: 'git', args: ['fetch', 'origin', 'main'], result: timeoutResult() },
  ]);

  const result = runUpdateCommand({ cwd, run, existsSync: lockAndScript });

  assert.equal(result.ok, false);
  assert.match(result.text, /timed out/i);
  assert.equal(remaining.length, 0);
});

test('runUpdateCommand reports a network error during fetch', () => {
  const { run, remaining } = makeRunner([
    ...guard(),
    { command: 'git', args: ['status', '--porcelain'], result: ok('') },
    {
      command: 'git',
      args: ['symbolic-ref', '--short', 'HEAD'],
      result: ok('main\n'),
    },
    {
      command: 'git',
      args: ['fetch', 'origin', 'main'],
      result: fail('fatal: unable to access ... Could not resolve host: github.com'),
    },
  ]);

  const result = runUpdateCommand({ cwd, run, existsSync: lockAndScript });

  assert.equal(result.ok, false);
  assert.match(result.text, /network error/i);
  assert.equal(remaining.length, 0);
});

test('runUpdateCommand fails fast when another update lock is active', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-update-lock-'));
  const lockDir = path.join(tempDir, 'data');
  fs.mkdirSync(lockDir, { recursive: true });
  fs.writeFileSync(
    path.join(lockDir, 'update.lock.json'),
    JSON.stringify({
      pid: process.pid,
      startedAt: new Date().toISOString(),
      reportId: 'update-existing',
    }),
  );

  const result = runUpdateCommand({
    cwd: tempDir,
    run: () => {
      throw new Error('should not execute commands while locked');
    },
  });

  assert.equal(result.ok, false);
  assert.match(result.text, /already running/);
});

// --- progress events -------------------------------------------------------

test('runUpdateCommand emits the full phase sequence for a clean run', () => {
  const events: UpdateProgressEvent[] = [];
  const { run, remaining } = makeRunner([
    ...cleanPrelude(),
    ...installBuild(),
    ...restartVerifyHealthy(),
  ]);

  const result = runUpdateCommand({
    cwd,
    run,
    onProgress: (event) => events.push(event),
    existsSync: lockAndScript,
  });

  assert.equal(result.ok, true);
  assert.equal(remaining.length, 0);

  assert.deepEqual(
    events.map((e) => e.phase),
    [
      'starting',
      'starting',
      'fetching',
      'fetching',
      'pulling',
      'pulling',
      'installing',
      'installing',
      'building',
      'building',
      'restarting',
      'restarting',
      'verifying',
      'verifying',
      'complete',
    ],
  );

  const verifying = events.filter((e) => e.phase === 'verifying');
  assert.equal(verifying[0]?.status, 'started');
  assert.equal(verifying[1]?.status, 'completed');

  const complete = events.filter((e) => e.phase === 'complete');
  assert.equal(complete[0]?.status, 'completed');
  assert.equal(complete[0]?.ok, true);

  for (const event of events) {
    assert.ok(event.at, 'every event must have an at timestamp');
    assert.notEqual(new Date(event.at).toString(), 'Invalid Date');
  }
});

test('runUpdateCommand emits a failed event when fetch fails', () => {
  const events: UpdateProgressEvent[] = [];
  const { run } = makeRunner([
    ...guard(),
    { command: 'git', args: ['status', '--porcelain'], result: ok('') },
    {
      command: 'git',
      args: ['symbolic-ref', '--short', 'HEAD'],
      result: ok('main\n'),
    },
    { command: 'git', args: ['fetch', 'origin', 'main'], result: fail('boom') },
  ]);

  const result = runUpdateCommand({
    cwd,
    run,
    onProgress: (event) => events.push(event),
    existsSync: lockAndScript,
  });

  assert.equal(result.ok, false);
  assert.ok(
    events.some((e) => e.phase === 'fetching' && e.status === 'failed'),
  );
  assert.equal(
    events.filter((e) => e.phase === 'complete').length,
    0,
  );
});

test('runUpdateCommand returns the exact UpdateCommandResult shape without onProgress', () => {
  const { run, remaining } = makeRunner([
    ...cleanPrelude(),
    ...installBuild(),
    ...restartVerifyHealthy(),
  ]);

  const result = runUpdateCommand({ cwd, run, existsSync: lockAndScript });

  assert.equal(result.ok, true);
  assert.equal(typeof result.ok, 'boolean');
  assert.equal(typeof result.text, 'string');
  assert.equal(Object.keys(result).length, 2);
  assert.equal(remaining.length, 0);
});

// --- detached worker launch (sequence-independent) -------------------------

test('startDetachedUpdateCommand writes report and launches worker detached', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-update-test-'));
  const reportDir = path.join(tempDir, 'reports');
  const scriptPath = path.join(tempDir, 'dist', 'update-worker.js');
  const spawned: Array<{
    command: string;
    args: string[];
    options: {
      cwd: string;
      env: NodeJS.ProcessEnv;
      detached: true;
      stdio: 'ignore';
    };
    unrefCalled: boolean;
  }> = [];
  let currentSpawn: (typeof spawned)[number] | null = null;

  const result = startDetachedUpdateCommand({
    cwd,
    chatJid: 'telegram:123',
    now: fixedNow,
    nodePath: '/usr/local/bin/node',
    scriptPath,
    reportDir,
    existsSync: (filePath) => filePath === scriptPath,
    spawnProcess: (command, args, options) => {
      currentSpawn = {
        command,
        args,
        options,
        unrefCalled: false,
      };
      spawned.push(currentSpawn);
      return {
        unref: () => {
          if (currentSpawn) currentSpawn.unrefCalled = true;
        },
      };
    },
  });

  assert.equal(result.ok, true);
  assert.match(result.reportId || '', /^update-20260519T123456000Z-/);
  assert.equal(spawned.length, 1);
  assert.equal(spawned[0].command, '/usr/local/bin/node');
  assert.deepEqual(spawned[0].args, [
    scriptPath,
    '--report-file',
    result.reportFile,
    '--cwd',
    cwd,
  ]);
  assert.equal(spawned[0].options.detached, true);
  assert.equal(spawned[0].options.stdio, 'ignore');
  assert.equal(spawned[0].unrefCalled, true);

  const report = readUpdateNotification(result.reportFile || '');
  assert.equal(report?.chatJid, 'telegram:123');
  assert.equal(report?.status, 'started');
});

test('startDetachedUpdateCommand allows chatless starts for non-Telegram surfaces', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-update-test-'));
  const reportDir = path.join(tempDir, 'reports');
  const scriptPath = path.join(tempDir, 'dist', 'update-worker.js');
  const spawned: Array<{ command: string; args: string[] }> = [];

  const result = startDetachedUpdateCommand({
    cwd,
    now: fixedNow,
    nodePath: '/usr/local/bin/node',
    scriptPath,
    reportDir,
    existsSync: (filePath) => filePath === scriptPath,
    spawnProcess: (command, args) => {
      spawned.push({ command, args });
      return { unref: () => {} };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(spawned.length, 1);
  const report = readUpdateNotification(result.reportFile || '');
  assert.equal(report?.chatJid, '');
  assert.equal(report?.status, 'started');
});
