import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createWatchdog, type WatchdogConfig } from '../src/watchdog.js';
import type { ActiveChatRun, ActiveCoderRun } from '../src/app-state.js';

function makeConfig(overrides: Partial<WatchdogConfig> = {}): WatchdogConfig {
  return {
    enabled: true,
    intervalMs: 30_000,
    chatRunMaxMs: 30_000,
    chatStaleMs: 5_000,
    coderRunMaxMs: 30_000,
    coderStaleMs: 5_000,
    fileScanMs: 999_999_999,
    alertCooldownMs: 600_000,
    ...overrides,
  };
}

function makeDirs(): {
  root: string;
  dataDir: string;
  groupsDir: string;
  mainWorkspaceDir: string;
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-watchdog-'));
  const dataDir = path.join(root, 'data');
  const groupsDir = path.join(root, 'groups');
  const mainWorkspaceDir = path.join(root, 'main-workspace');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(groupsDir, { recursive: true });
  fs.mkdirSync(mainWorkspaceDir, { recursive: true });
  return { root, dataDir, groupsDir, mainWorkspaceDir };
}

function writeRegisteredGroups(
  dataDir: string,
  groups: Array<{ jid: string; folder: string }>,
): void {
  const payload: Record<string, { folder: string; name: string; trigger: string }> = {};
  for (const group of groups) {
    payload[group.jid] = {
      folder: group.folder,
      name: group.jid,
      trigger: '@FarmFriend',
    };
  }
  fs.writeFileSync(
    path.join(dataDir, 'registered_groups.json'),
    JSON.stringify(payload, null, 2),
    'utf-8',
  );
}

function writeCriticalMarkdown(root: string): void {
  for (const file of [
    'MEMORY.md',
    'SOUL.md',
    'TODOS.md',
    'HEARTBEAT.md',
    'NANO.md',
  ]) {
    fs.writeFileSync(path.join(root, file), `# ${file}\n\nok\n`, 'utf-8');
  }
}

test('watchdog aborts stale chat run and cleans bookkeeping on follow-up scan', async () => {
  const dirs = makeDirs();
  let now = 10_000;
  let aborts = 0;
  const alerts: string[] = [];
  const abortController = new AbortController();
  abortController.signal.addEventListener('abort', () => {
    aborts += 1;
  });
  const run: ActiveChatRun = {
    chatJid: 'telegram:1',
    requestId: 'run-stale',
    startedAt: 0,
    lastProgressAt: 0,
    abortController,
  };
  const activeChatRuns = new Map([[run.chatJid, run]]);
  const activeChatRunsById = new Map([[run.requestId, run]]);
  const watchdog = createWatchdog(
    {
      activeChatRuns,
      activeChatRunsById,
      activeCoderRuns: new Map(),
      ...dirs,
      now: () => now,
      sendAlert: (text) => {
        alerts.push(text);
      },
    },
    makeConfig(),
  );

  await watchdog.scan();
  assert.equal(aborts, 1);
  assert.equal(activeChatRunsById.has('run-stale'), true);

  now += 1_000;
  await watchdog.scan();
  assert.equal(aborts, 1);
  assert.equal(activeChatRunsById.has('run-stale'), false);
  assert.equal(activeChatRuns.has('telegram:1'), false);
  assert.match(alerts.join('\n'), /Chat run exceeded watchdog stale threshold/);
});

test('watchdog does not abort old run with recent progress before hard max', async () => {
  const dirs = makeDirs();
  const abortController = new AbortController();
  let aborted = false;
  abortController.signal.addEventListener('abort', () => {
    aborted = true;
  });
  const run: ActiveChatRun = {
    chatJid: 'telegram:1',
    requestId: 'run-progress',
    startedAt: 0,
    lastProgressAt: 19_500,
    abortController,
  };
  const watchdog = createWatchdog(
    {
      activeChatRuns: new Map([[run.chatJid, run]]),
      activeChatRunsById: new Map([[run.requestId, run]]),
      activeCoderRuns: new Map(),
      ...dirs,
      now: () => 20_000,
    },
    makeConfig({ chatRunMaxMs: 60_000 }),
  );

  await watchdog.scan();
  assert.equal(aborted, false);
});

test('watchdog hard max aborts even when progress is recent', async () => {
  const dirs = makeDirs();
  const abortController = new AbortController();
  let aborted = false;
  abortController.signal.addEventListener('abort', () => {
    aborted = true;
  });
  const run: ActiveChatRun = {
    chatJid: 'telegram:1',
    requestId: 'run-too-old',
    startedAt: 0,
    lastProgressAt: 19_900,
    abortController,
  };
  const watchdog = createWatchdog(
    {
      activeChatRuns: new Map([[run.chatJid, run]]),
      activeChatRunsById: new Map([[run.requestId, run]]),
      activeCoderRuns: new Map(),
      ...dirs,
      now: () => 20_000,
    },
    makeConfig({ chatRunMaxMs: 10_000 }),
  );

  await watchdog.scan();
  assert.equal(aborted, true);
});

test('watchdog marks stale coder runs aborted', async () => {
  const dirs = makeDirs();
  const abortController = new AbortController();
  let aborted = false;
  abortController.signal.addEventListener('abort', () => {
    aborted = true;
  });
  const run: ActiveCoderRun = {
    requestId: 'coder-stale',
    mode: 'execute',
    chatJid: 'telegram:1',
    groupName: 'main',
    startedAt: 0,
    lastProgressAt: 0,
    state: 'running',
    abortController,
  };
  const watchdog = createWatchdog(
    {
      activeChatRuns: new Map(),
      activeChatRunsById: new Map(),
      activeCoderRuns: new Map([[run.requestId, run]]),
      ...dirs,
      now: () => 10_000,
    },
    makeConfig(),
  );

  await watchdog.scan();
  assert.equal(aborted, true);
  assert.equal(run.state, 'aborted');
});

test('watchdog quarantines invalid IPC JSON and leaves valid JSON untouched', async () => {
  const dirs = makeDirs();
  writeCriticalMarkdown(dirs.mainWorkspaceDir);
  const groupIpc = path.join(dirs.dataDir, 'ipc', 'main', 'messages');
  fs.mkdirSync(groupIpc, { recursive: true });
  const validPath = path.join(groupIpc, 'valid.json');
  const badPath = path.join(groupIpc, 'bad.json');
  fs.writeFileSync(validPath, '{"ok":true}\n', 'utf-8');
  fs.writeFileSync(badPath, '{not json', 'utf-8');
  const watchdog = createWatchdog(
    {
      activeChatRuns: new Map(),
      activeChatRunsById: new Map(),
      activeCoderRuns: new Map(),
      ...dirs,
      now: () => 10_000,
    },
    makeConfig({ fileScanMs: 0 }),
  );

  await watchdog.scan();
  assert.equal(fs.existsSync(validPath), true);
  assert.equal(fs.existsSync(badPath), false);
  const quarantined = fs.readdirSync(path.join(dirs.dataDir, 'ipc', 'errors'));
  assert.equal(quarantined.length, 1);
  assert.match(quarantined[0], /messages-main-/);
});

test('watchdog alerts on zero-byte markdown without inventing content', async () => {
  const dirs = makeDirs();
  writeCriticalMarkdown(dirs.mainWorkspaceDir);
  const memoryPath = path.join(dirs.mainWorkspaceDir, 'MEMORY.md');
  fs.writeFileSync(memoryPath, '', 'utf-8');
  const alerts: string[] = [];
  const watchdog = createWatchdog(
    {
      activeChatRuns: new Map(),
      activeChatRunsById: new Map(),
      activeCoderRuns: new Map(),
      ...dirs,
      now: () => 10_000,
      sendAlert: (text) => {
        alerts.push(text);
      },
    },
    makeConfig({ fileScanMs: 0 }),
  );

  await watchdog.scan();
  assert.equal(fs.readFileSync(memoryPath, 'utf-8'), '');
  assert.match(alerts.join('\n'), /zero-byte/);
});

test('watchdog restores suspicious markdown only from existing backup', async () => {
  const dirs = makeDirs();
  writeCriticalMarkdown(dirs.mainWorkspaceDir);
  const memoryPath = path.join(dirs.mainWorkspaceDir, 'MEMORY.md');
  const backupBody = '# MEMORY\n\nlast known good\n';
  fs.writeFileSync(`${memoryPath}.bak`, backupBody, 'utf-8');
  fs.writeFileSync(memoryPath, '', 'utf-8');
  const watchdog = createWatchdog(
    {
      activeChatRuns: new Map(),
      activeChatRunsById: new Map(),
      activeCoderRuns: new Map(),
      ...dirs,
      now: () => 10_000,
    },
    makeConfig({ fileScanMs: 0 }),
  );

  await watchdog.scan();
  assert.equal(fs.readFileSync(memoryPath, 'utf-8'), backupBody);
});

test('watchdog treats group HEARTBEAT.md as optional', async () => {
  const dirs = makeDirs();
  writeCriticalMarkdown(dirs.mainWorkspaceDir);
  const groupDir = path.join(dirs.groupsDir, 'normal-group');
  fs.mkdirSync(groupDir, { recursive: true });
  for (const file of ['MEMORY.md', 'SOUL.md', 'TODOS.md', 'NANO.md']) {
    fs.writeFileSync(path.join(groupDir, file), `# ${file}\n\nok\n`, 'utf-8');
  }
  writeRegisteredGroups(dirs.dataDir, [{ jid: 'telegram:normal', folder: 'normal-group' }]);
  const alerts: string[] = [];
  const watchdog = createWatchdog(
    {
      activeChatRuns: new Map(),
      activeChatRunsById: new Map(),
      activeCoderRuns: new Map(),
      ...dirs,
      now: () => 10_000,
      sendAlert: (text) => {
        alerts.push(text);
      },
    },
    makeConfig({ fileScanMs: 0 }),
  );

  await watchdog.scan();
  assert.equal(fs.existsSync(path.join(groupDir, 'HEARTBEAT.md')), false);
  assert.doesNotMatch(alerts.join('\n'), /HEARTBEAT\.md/);
});

test('watchdog scans only registered non-main group folders', async () => {
  const dirs = makeDirs();
  writeCriticalMarkdown(dirs.mainWorkspaceDir);

  const registeredDir = path.join(dirs.groupsDir, 'registered-group');
  fs.mkdirSync(registeredDir, { recursive: true });
  for (const file of ['MEMORY.md', 'SOUL.md', 'TODOS.md']) {
    fs.writeFileSync(path.join(registeredDir, file), `# ${file}\n\nok\n`, 'utf-8');
  }

  const orphanDir = path.join(dirs.groupsDir, 'orphan-group');
  fs.mkdirSync(orphanDir, { recursive: true });

  const mainShadowDir = path.join(dirs.groupsDir, 'main');
  fs.mkdirSync(mainShadowDir, { recursive: true });

  writeRegisteredGroups(dirs.dataDir, [
    { jid: 'telegram:main', folder: 'main' },
    { jid: 'telegram:child', folder: 'registered-group' },
  ]);

  const alerts: string[] = [];
  const watchdog = createWatchdog(
    {
      activeChatRuns: new Map(),
      activeChatRunsById: new Map(),
      activeCoderRuns: new Map(),
      ...dirs,
      now: () => 10_000,
      sendAlert: (msg) => {
        alerts.push(msg);
      },
    },
    makeConfig({ fileScanMs: 0 }),
  );

  await watchdog.scan();
  const combined = alerts.join('\n');
  assert.match(combined, /registered-group\/NANO\.md/);
  assert.doesNotMatch(combined, /orphan-group\/NANO\.md/);
  assert.doesNotMatch(combined, /groups\/main\/NANO\.md/);
});
