import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

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
