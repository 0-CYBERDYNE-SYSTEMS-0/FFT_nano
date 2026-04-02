import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { hostEventBus } from '../src/app-state.js';
import { runContainerAgent } from '../src/pi-runner.ts';
import type { RegisteredGroup } from '../src/types.ts';

function writeFakePiExecutable(dir: string): string {
  const executablePath = path.join(dir, 'fake-pi.js');
  fs.writeFileSync(
    executablePath,
    `#!/usr/bin/env node
const args = process.argv.slice(2);

if (args.includes('-c')) {
  setInterval(() => {}, 1000);
  return;
}

process.stdout.write(JSON.stringify({
  type: 'message_end',
  message: {
    role: 'assistant',
    content: [{ type: 'text', text: 'fresh ok' }],
  },
}) + '\\n');
setTimeout(() => process.exit(0), 10);
`,
    'utf8',
  );
  fs.chmodSync(executablePath, 0o755);
  return executablePath;
}

test(
  'runContainerAgent retries a stale continued interactive run with a fresh session',
  { timeout: 5000, concurrency: false },
  async (t) => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-pi-stale-'));
    const fakePiPath = writeFakePiExecutable(tempDir);
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-workspace-'));
    const groupFolder = `testrun_${Date.now().toString(36)}`;
    const groupDir = path.join(process.cwd(), 'groups', groupFolder);
    const ipcDir = path.join(process.cwd(), 'data', 'ipc', groupFolder);
    const piDir = path.join(process.cwd(), 'data', 'pi', groupFolder);

    t.after(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
      fs.rmSync(workspaceDir, { recursive: true, force: true });
      fs.rmSync(groupDir, { recursive: true, force: true });
      fs.rmSync(ipcDir, { recursive: true, force: true });
      fs.rmSync(piDir, { recursive: true, force: true });
    });

    const group: RegisteredGroup = {
      name: 'Test Group',
      folder: groupFolder,
      trigger: '@FarmFriend',
      added_at: '2026-03-31T00:00:00.000Z',
    };

    const progressEvents: any[] = [];
    const abortController = new AbortController();
    const abortTimer = setTimeout(() => {
      abortController.abort(new Error('test timeout abort'));
    }, 2000);

    const output = await runContainerAgent(
      group,
      {
        prompt: 'reply once',
        groupFolder,
        chatJid: 'telegram:test',
        isMain: false,
        assistantName: 'FarmFriend',
        requestId: 'req-stale-1',
        workspaceDirOverride: workspaceDir,
        piExecutableOverride: fakePiPath,
        lifecyclePolicyOverride: {
          staleAfterMs: 300,
          hardTimeoutMs: 2500,
        },
      },
      abortController.signal,
      undefined,
      undefined,
      (event) => {
        progressEvents.push(event);
      },
    ).finally(() => clearTimeout(abortTimer));

    assert.equal(output.status, 'success');
    assert.equal(output.result, 'fresh ok');

    const spawnEvents = progressEvents.filter((event) => event.kind === 'spawn');
    assert.equal(spawnEvents.length, 2);
    assert.equal(spawnEvents[0]?.resumed, true);
    assert.equal(spawnEvents[1]?.resumed, false);
    assert.equal(
      progressEvents.some((event) => event.kind === 'retry_fresh'),
      true,
    );
  },
);

function writeDelayedFreshPiExecutable(dir: string): string {
  const executablePath = path.join(dir, 'fake-pi-delayed.js');
  fs.writeFileSync(
    executablePath,
    `#!/usr/bin/env node
const args = process.argv.slice(2);

if (args.includes('-c')) {
  process.stdout.write(JSON.stringify({
    type: 'message_end',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: 'continued ok' }],
    },
  }) + '\\n');
  setTimeout(() => process.exit(0), 10);
  return;
}

setTimeout(() => {
  process.stdout.write(JSON.stringify({
    type: 'message_end',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: 'fresh slow ok' }],
    },
  }) + '\\n');
  setTimeout(() => process.exit(0), 10);
}, 200);
`,
    'utf8',
  );
  fs.chmodSync(executablePath, 0o755);
  return executablePath;
}

test(
  'runContainerAgent does not stale-kill a fresh interactive run before first output',
  { timeout: 5000, concurrency: false },
  async (t) => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-pi-fresh-'));
    const fakePiPath = writeDelayedFreshPiExecutable(tempDir);
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-workspace-'));
    const groupFolder = `testrun_${Date.now().toString(36)}`;
    const groupDir = path.join(process.cwd(), 'groups', groupFolder);
    const ipcDir = path.join(process.cwd(), 'data', 'ipc', groupFolder);
    const piDir = path.join(process.cwd(), 'data', 'pi', groupFolder);

    t.after(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
      fs.rmSync(workspaceDir, { recursive: true, force: true });
      fs.rmSync(groupDir, { recursive: true, force: true });
      fs.rmSync(ipcDir, { recursive: true, force: true });
      fs.rmSync(piDir, { recursive: true, force: true });
    });

    const group: RegisteredGroup = {
      name: 'Test Group',
      folder: groupFolder,
      trigger: '@FarmFriend',
      added_at: '2026-03-31T00:00:00.000Z',
    };

    const output = await runContainerAgent(group, {
      prompt: 'reply once',
      groupFolder,
      chatJid: 'telegram:test',
      isMain: false,
      assistantName: 'FarmFriend',
      requestId: 'req-fresh-1',
      noContinue: true,
      workspaceDirOverride: workspaceDir,
      piExecutableOverride: fakePiPath,
      lifecyclePolicyOverride: {
        staleAfterMs: 500,
        hardTimeoutMs: 2500,
      },
    });

    assert.equal(output.status, 'success');
    assert.equal(output.result, 'fresh slow ok');
  },
);

function writeHungFreshPiExecutable(dir: string): string {
  const executablePath = path.join(dir, 'fake-pi-hung-fresh.js');
  fs.writeFileSync(
    executablePath,
    `#!/usr/bin/env node
setInterval(() => {}, 1000);
`,
    'utf8',
  );
  fs.chmodSync(executablePath, 0o755);
  return executablePath;
}

test(
  'runContainerAgent fails fast on a fresh interactive run that produces no progress',
  { timeout: 5000, concurrency: false },
  async (t) => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-pi-hung-'));
    const fakePiPath = writeHungFreshPiExecutable(tempDir);
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-workspace-'));
    const groupFolder = `testrun_${Date.now().toString(36)}`;
    const groupDir = path.join(process.cwd(), 'groups', groupFolder);
    const ipcDir = path.join(process.cwd(), 'data', 'ipc', groupFolder);
    const piDir = path.join(process.cwd(), 'data', 'pi', groupFolder);
    const progressEvents: any[] = [];

    t.after(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
      fs.rmSync(workspaceDir, { recursive: true, force: true });
      fs.rmSync(groupDir, { recursive: true, force: true });
      fs.rmSync(ipcDir, { recursive: true, force: true });
      fs.rmSync(piDir, { recursive: true, force: true });
    });

    const group: RegisteredGroup = {
      name: 'Test Group',
      folder: groupFolder,
      trigger: '@FarmFriend',
      added_at: '2026-03-31T00:00:00.000Z',
    };

    const startedAt = Date.now();
    const output = await runContainerAgent(
      group,
      {
        prompt: 'reply once',
        groupFolder,
        chatJid: 'telegram:test',
        isMain: false,
        assistantName: 'FarmFriend',
        requestId: 'req-fresh-stall',
        noContinue: true,
        workspaceDirOverride: workspaceDir,
        piExecutableOverride: fakePiPath,
        lifecyclePolicyOverride: {
          staleAfterMs: 300,
          hardTimeoutMs: 2500,
        },
      },
      undefined,
      undefined,
      undefined,
      (event) => {
        progressEvents.push(event);
      },
    );

    const duration = Date.now() - startedAt;
    assert.equal(output.status, 'error');
    assert.match(output.error || '', /Pi run stalled before producing progress/);
    assert.equal(
      progressEvents.some(
        (event) =>
          event.kind === 'stale' && event.retryingFresh === false,
      ),
      true,
    );
    assert.equal(
      progressEvents.some((event) => event.kind === 'retry_fresh'),
      false,
    );
    assert.ok(duration < 2000);
  },
);

function writeToolFirstPiExecutable(dir: string): string {
  const executablePath = path.join(dir, 'fake-pi-tool-first.js');
  fs.writeFileSync(
    executablePath,
    `#!/usr/bin/env node
setTimeout(() => {
  process.stdout.write(JSON.stringify({
    type: 'tool_call_start',
    toolName: 'web_search',
    toolCallId: 'call-1',
    args: { query: 'ai for agriculture' },
  }) + '\\n');
}, 30);

setTimeout(() => {
  process.stdout.write(JSON.stringify({
    type: 'message_end',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: 'final answer' }],
    },
  }) + '\\n');
  setTimeout(() => process.exit(0), 10);
}, 350);
`,
    'utf8',
  );
  fs.chmodSync(executablePath, 0o755);
  return executablePath;
}

test(
  'runContainerAgent avoids generic Telegram draft previews before assistant text exists',
  { timeout: 5000, concurrency: false },
  async (t) => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-pi-draft-'));
    const fakePiPath = writeToolFirstPiExecutable(tempDir);
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-workspace-'));
    const groupFolder = `testrun_${Date.now().toString(36)}`;
    const groupDir = path.join(process.cwd(), 'groups', groupFolder);
    const ipcDir = path.join(process.cwd(), 'data', 'ipc', groupFolder);
    const piDir = path.join(process.cwd(), 'data', 'pi', groupFolder);
    const requestId = `req-draft-${Date.now().toString(36)}`;
    const seenPreviewTexts: string[] = [];
    const unsubscribe = hostEventBus.subscribe((event) => {
      if (
        event.kind === 'telegram_preview_requested' &&
        event.requestId === requestId
      ) {
        seenPreviewTexts.push(event.text);
      }
    });

    t.after(() => {
      unsubscribe();
      fs.rmSync(tempDir, { recursive: true, force: true });
      fs.rmSync(workspaceDir, { recursive: true, force: true });
      fs.rmSync(groupDir, { recursive: true, force: true });
      fs.rmSync(ipcDir, { recursive: true, force: true });
      fs.rmSync(piDir, { recursive: true, force: true });
    });

    const group: RegisteredGroup = {
      name: 'Test Group',
      folder: groupFolder,
      trigger: '@FarmFriend',
      added_at: '2026-03-31T00:00:00.000Z',
    };

    const output = await runContainerAgent(group, {
      prompt: 'reply once',
      groupFolder,
      chatJid: 'telegram:test',
      isMain: true,
      assistantName: 'FarmFriend',
      requestId,
      noContinue: true,
      workspaceDirOverride: workspaceDir,
      piExecutableOverride: fakePiPath,
      lifecyclePolicyOverride: {
        staleAfterMs: 2500,
        hardTimeoutMs: 2500,
      },
    });

    assert.equal(output.status, 'success');
    assert.equal(output.result, 'final answer');
    assert.equal(
      seenPreviewTexts.some((text) =>
        text.includes('Working on your reply...'),
      ),
      false,
    );
    assert.equal(
      seenPreviewTexts.some((text) => text.includes('final answer')),
      true,
    );
  },
);

function writeRpcPermissionGatePiExecutable(dir: string): string {
  const executablePath = path.join(dir, 'fake-pi-rpc-permission-gate.js');
  fs.writeFileSync(
    executablePath,
    `#!/usr/bin/env node
const args = process.argv.slice(2);
const modeIndex = args.indexOf('--mode');
const mode = modeIndex >= 0 ? args[modeIndex + 1] : 'text';

if (mode === 'json') {
  let stdinEnded = false;
  process.stdin.setEncoding('utf8');
  process.stdin.on('end', () => {
    stdinEnded = true;
    process.stdout.write(JSON.stringify({
      type: 'message_end',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'json mode completed' }],
      },
    }) + '\\n');
    setTimeout(() => process.exit(0), 10);
  });
  process.stdin.resume();
  setTimeout(() => {
    if (!stdinEnded) {
      // Match pi's non-RPC behavior: wait for EOF before starting.
    }
  }, 10);
  return;
}

if (mode !== 'rpc') {
  console.error('unsupported mode');
  process.exit(1);
}

let buffer = '';
let responded = false;
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  while (true) {
    const newlineIndex = buffer.indexOf('\\n');
    if (newlineIndex === -1) break;
    const line = buffer.slice(0, newlineIndex).trim();
    buffer = buffer.slice(newlineIndex + 1);
    if (!line) continue;
    const message = JSON.parse(line);
    if (message.type === 'prompt') {
      process.stdout.write(JSON.stringify({
        id: message.id,
        type: 'response',
        command: 'prompt',
        success: true,
      }) + '\\n');
      process.stdout.write(JSON.stringify({
        type: 'extension_ui_request',
        id: 'pg-1',
        method: 'confirm',
        title: 'Protected Path',
        message: 'Allow this edit?',
        timeout: 1000,
      }) + '\\n');
      continue;
    }
    if (message.type === 'extension_ui_response' && message.id === 'pg-1') {
      responded = true;
      process.stdout.write(JSON.stringify({
        type: 'message_end',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: message.confirmed ? 'rpc allowed' : 'rpc denied',
            },
          ],
        },
      }) + '\\n');
      setTimeout(() => process.exit(0), 10);
    }
  }
});
process.stdin.on('end', () => {
  if (!responded) process.exit(1);
});
process.stdin.resume();
`,
    'utf8',
  );
  fs.chmodSync(executablePath, 0o755);
  return executablePath;
}

test(
  'runContainerAgent uses RPC transport when extension UI is enabled',
  { timeout: 5000, concurrency: false },
  async (t) => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-pi-rpc-ui-'));
    const fakePiPath = writeRpcPermissionGatePiExecutable(tempDir);
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-workspace-'));
    const groupFolder = `testrun_${Date.now().toString(36)}`;
    const groupDir = path.join(process.cwd(), 'groups', groupFolder);
    const ipcDir = path.join(process.cwd(), 'data', 'ipc', groupFolder);
    const piDir = path.join(process.cwd(), 'data', 'pi', groupFolder);

    t.after(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
      fs.rmSync(workspaceDir, { recursive: true, force: true });
      fs.rmSync(groupDir, { recursive: true, force: true });
      fs.rmSync(ipcDir, { recursive: true, force: true });
      fs.rmSync(piDir, { recursive: true, force: true });
    });

    const group: RegisteredGroup = {
      name: 'Test Group',
      folder: groupFolder,
      trigger: '@FarmFriend',
      added_at: '2026-03-31T00:00:00.000Z',
    };

    const output = await runContainerAgent(
      group,
      {
        prompt: 'reply once',
        groupFolder,
        chatJid: 'telegram:test',
        isMain: false,
        assistantName: 'FarmFriend',
        requestId: 'req-rpc-ui-1',
        noContinue: true,
        workspaceDirOverride: workspaceDir,
        piExecutableOverride: fakePiPath,
        lifecyclePolicyOverride: {
          staleAfterMs: 300,
          hardTimeoutMs: 2500,
        },
      },
      undefined,
      undefined,
      async (request) => {
        assert.equal(request.method, 'confirm');
        return { confirmed: true };
      },
    );

    assert.equal(output.status, 'success');
    assert.equal(output.result, 'rpc allowed');
  },
);
