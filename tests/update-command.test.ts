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

const cwd = '/tmp/fft_nano';
const fixedNow = () => new Date('2026-05-19T12:34:56.000Z');
const marker = 'fft-nano-update-autostash-2026-05-19T12:34:56.000Z';

test('runUpdateCommand updates a clean checkout without stashing', () => {
  const { run, calls, remaining } = makeRunner([
    {
      command: 'git',
      args: ['rev-parse', '--is-inside-work-tree'],
      result: ok('true\n'),
    },
    { command: 'git', args: ['status', '--porcelain'], result: ok('') },
    { command: 'git', args: ['fetch', 'origin'], result: ok('') },
    {
      command: 'git',
      args: ['symbolic-ref', '--short', 'HEAD'],
      result: ok('main\n'),
    },
    {
      command: 'git',
      args: ['pull', '--ff-only', 'origin', 'main'],
      result: ok('Already up to date.\n'),
    },
    {
      command: 'npm',
      args: ['ci', '--include=dev'],
      result: ok('installed\n'),
    },
    { command: 'npm', args: ['run', 'build'], result: ok('built\n') },
    {
      command: 'bash',
      args: ['/tmp/fft_nano/scripts/service.sh', 'restart'],
      result: ok('restarted\n'),
    },
    {
      command: 'bash',
      args: ['/tmp/fft_nano/scripts/service.sh', 'status'],
      result: ok('running\n'),
    },
  ]);

  const result = runUpdateCommand({
    cwd,
    run,
    existsSync: (filePath) =>
      filePath === '/tmp/fft_nano/package-lock.json' ||
      filePath === '/tmp/fft_nano/scripts/service.sh',
  });

  assert.equal(result.ok, true);
  assert.match(result.text, /Update complete\. Service restarted\./);
  assert.equal(remaining.length, 0);
  assert.deepEqual(
    calls.map((call) => [call.command, call.args[0]]),
    [
      ['git', 'rev-parse'],
      ['git', 'status'],
      ['git', 'fetch'],
      ['git', 'symbolic-ref'],
      ['git', 'pull'],
      ['npm', 'ci'],
      ['npm', 'run'],
      ['bash', '/tmp/fft_nano/scripts/service.sh'],
      ['bash', '/tmp/fft_nano/scripts/service.sh'],
    ],
  );
});

test('runUpdateCommand stashes dirty changes and reapplies them after pull', () => {
  const { run, calls, remaining } = makeRunner([
    {
      command: 'git',
      args: ['rev-parse', '--is-inside-work-tree'],
      result: ok('true\n'),
    },
    {
      command: 'git',
      args: ['status', '--porcelain'],
      result: ok(' M README.md\n?? local.txt\n'),
    },
    {
      command: 'git',
      args: ['stash', 'push', '--include-untracked', '-m', marker],
      result: ok(
        `Saved working directory and index state On main: ${marker}\n`,
      ),
    },
    {
      command: 'git',
      args: ['stash', 'list', '--format=%gd%x00%gs'],
      result: ok(`stash@{0}\0On main: ${marker}\n`),
    },
    { command: 'git', args: ['fetch', 'origin'], result: ok('') },
    {
      command: 'git',
      args: ['symbolic-ref', '--short', 'HEAD'],
      result: ok('main\n'),
    },
    {
      command: 'git',
      args: ['pull', '--ff-only', 'origin', 'main'],
      result: ok('Updating abc..def\n'),
    },
    { command: 'git', args: ['stash', 'apply', 'stash@{0}'], result: ok('') },
    {
      command: 'git',
      args: ['stash', 'drop', 'stash@{0}'],
      result: ok('Dropped stash@{0}\n'),
    },
    {
      command: 'npm',
      args: ['ci', '--include=dev'],
      result: ok('installed\n'),
    },
    { command: 'npm', args: ['run', 'build'], result: ok('built\n') },
    {
      command: 'bash',
      args: ['/tmp/fft_nano/scripts/service.sh', 'restart'],
      result: { status: null, signal: 'SIGTERM', stdout: '' },
    },
  ]);

  const result = runUpdateCommand({
    cwd,
    run,
    now: fixedNow,
    existsSync: (filePath) =>
      filePath === '/tmp/fft_nano/package-lock.json' ||
      filePath === '/tmp/fft_nano/scripts/service.sh',
  });

  assert.equal(result.ok, true);
  assert.match(result.text, /Saved local changes as stash@\{0\}/);
  assert.match(result.text, /Update complete\. Service restarting\./);
  assert.equal(remaining.length, 0);
  assert.deepEqual(
    calls
      .filter((call) => call.command === 'git')
      .map((call) => call.args.slice(0, 2).join(' ')),
    [
      'rev-parse --is-inside-work-tree',
      'status --porcelain',
      'stash push',
      'stash list',
      'fetch origin',
      'symbolic-ref --short',
      'pull --ff-only',
      'stash apply',
      'stash drop',
    ],
  );
});

test('runUpdateCommand restores dirty changes and retains backup stash when pull fails', () => {
  const { run, calls, remaining } = makeRunner([
    {
      command: 'git',
      args: ['rev-parse', '--is-inside-work-tree'],
      result: ok('true\n'),
    },
    {
      command: 'git',
      args: ['status', '--porcelain'],
      result: ok(' M README.md\n'),
    },
    {
      command: 'git',
      args: ['stash', 'push', '--include-untracked', '-m', marker],
      result: ok(
        `Saved working directory and index state On main: ${marker}\n`,
      ),
    },
    {
      command: 'git',
      args: ['stash', 'list', '--format=%gd%x00%gs'],
      result: ok(`stash@{0}\0On main: ${marker}\n`),
    },
    { command: 'git', args: ['fetch', 'origin'], result: ok('') },
    {
      command: 'git',
      args: ['symbolic-ref', '--short', 'HEAD'],
      result: ok('main\n'),
    },
    {
      command: 'git',
      args: ['pull', '--ff-only', 'origin', 'main'],
      result: fail('fatal: Not possible to fast-forward\n'),
    },
    { command: 'git', args: ['stash', 'apply', 'stash@{0}'], result: ok('') },
  ]);

  const result = runUpdateCommand({
    cwd,
    run,
    now: fixedNow,
    existsSync: () => true,
  });

  assert.equal(result.ok, false);
  assert.match(result.text, /Update aborted during pull\./);
  assert.match(result.text, /Backup stash retained at stash@\{0\}/);
  assert.equal(remaining.length, 0);
  assert.equal(
    calls.some((call) => call.command === 'npm'),
    false,
  );
});

test('runUpdateCommand aborts before build when autostash cannot be reapplied cleanly', () => {
  const { run, calls, remaining } = makeRunner([
    {
      command: 'git',
      args: ['rev-parse', '--is-inside-work-tree'],
      result: ok('true\n'),
    },
    {
      command: 'git',
      args: ['status', '--porcelain'],
      result: ok(' M src/index.ts\n'),
    },
    {
      command: 'git',
      args: ['stash', 'push', '--include-untracked', '-m', marker],
      result: ok(
        `Saved working directory and index state On main: ${marker}\n`,
      ),
    },
    {
      command: 'git',
      args: ['stash', 'list', '--format=%gd%x00%gs'],
      result: ok(`stash@{0}\0On main: ${marker}\n`),
    },
    { command: 'git', args: ['fetch', 'origin'], result: ok('') },
    {
      command: 'git',
      args: ['symbolic-ref', '--short', 'HEAD'],
      result: ok('main\n'),
    },
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
    existsSync: () => true,
  });

  assert.equal(result.ok, false);
  assert.match(result.text, /could not be reapplied cleanly/);
  assert.match(result.text, /git stash apply stash@\{0\}/);
  assert.equal(remaining.length, 0);
  assert.equal(
    calls.some(
      (call) =>
        call.command === 'git' &&
        call.args.slice(0, 2).join(' ') === 'stash drop',
    ),
    false,
  );
  assert.equal(
    calls.some((call) => call.command === 'npm'),
    false,
  );
});

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
