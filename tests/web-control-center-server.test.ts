import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { startWebControlCenterServer } from '../src/web/control-center-server.ts';

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
    server.once('error', reject);
  });
}

function createStaticDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-web-static-'));
  fs.writeFileSync(
    path.join(dir, 'index.html'),
    '<!doctype html><html><body>ok</body></html>',
    'utf-8',
  );
  return dir;
}

function createLogsDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-web-logs-'));
  fs.writeFileSync(path.join(dir, 'fft_nano.log'), 'line-a\\nline-b\\nline-c\\n', 'utf-8');
  fs.writeFileSync(path.join(dir, 'fft_nano.error.log'), 'err-a\\nerr-b\\n', 'utf-8');
  return dir;
}

test('web control center serves runtime status on localhost mode without auth', async () => {
  const port = await getFreePort();
  const staticDir = createStaticDir();
  const logsDir = createLogsDir();

  const server = await startWebControlCenterServer(
    {
      getRuntimeStatus: () => ({ runtime: 'docker', sessions: 3, activeRuns: 1 }),
      getProfileStatus: () => ({
        profile: 'farm',
        featureFarm: true,
        profileDetection: { source: 'auto_preserve', reason: 'test' },
      }),
      getBuildInfo: () => ({
        startedAt: '2026-02-26T00:00:00.000Z',
        version: '1.1.0',
        branch: 'dev',
        commit: 'abc123',
      }),
      getGatewayStatus: () => ({
        host: '127.0.0.1',
        port: 28989,
        authRequired: false,
      }),
    },
    {
      host: '127.0.0.1',
      port,
      accessMode: 'localhost',
      authToken: '',
      staticDir,
      logsDir,
      fileRoots: [
        { id: 'workspace', label: 'Workspace', path: staticDir },
      ],
    },
  );

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/runtime/status`);
    assert.equal(res.status, 200);
    const json = (await res.json()) as { ok: boolean; runtime: { sessions: number } };
    assert.equal(json.ok, true);
    assert.equal(json.runtime.sessions, 3);

    const logsRes = await fetch(`http://127.0.0.1:${port}/api/logs/recent?target=error&lines=20`);
    assert.equal(logsRes.status, 200);
    const logsJson = (await logsRes.json()) as { ok: boolean; content: string };
    assert.equal(logsJson.ok, true);
    assert.match(logsJson.content, /err-a/);
  } finally {
    await server.close();
  }
});

test('web control center requires bearer token in lan mode', async () => {
  const port = await getFreePort();
  const staticDir = createStaticDir();
  const logsDir = createLogsDir();

  const server = await startWebControlCenterServer(
    {
      getRuntimeStatus: () => ({ runtime: 'docker', sessions: 1, activeRuns: 0 }),
      getProfileStatus: () => ({
        profile: 'core',
        featureFarm: false,
        profileDetection: { source: 'explicit', reason: 'test' },
      }),
      getBuildInfo: () => ({
        startedAt: '2026-02-26T00:00:00.000Z',
        version: '1.1.0',
      }),
      getGatewayStatus: () => ({
        host: '0.0.0.0',
        port: 28989,
        authRequired: true,
      }),
    },
    {
      host: '127.0.0.1',
      port,
      accessMode: 'lan',
      authToken: 'secret-token',
      staticDir,
      logsDir,
      fileRoots: [
        { id: 'workspace', label: 'Workspace', path: staticDir },
      ],
    },
  );

  try {
    const noAuth = await fetch(`http://127.0.0.1:${port}/api/runtime/status`);
    assert.equal(noAuth.status, 401);

    const withAuth = await fetch(`http://127.0.0.1:${port}/api/runtime/status`, {
      headers: { Authorization: 'Bearer secret-token' },
    });
    assert.equal(withAuth.status, 200);
    const json = (await withAuth.json()) as { ok: boolean; gateway: { wsUrl: string } };
    assert.equal(json.ok, true);
    assert.match(json.gateway.wsUrl, /^ws:\/\/127\.0\.0\.1:28989/);
  } finally {
    await server.close();
  }
});

test('web control center file APIs list, read, and write within allowed roots', async () => {
  const port = await getFreePort();
  const staticDir = createStaticDir();
  const logsDir = createLogsDir();
  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-web-workspace-'));
  fs.writeFileSync(path.join(workspaceDir, 'hello.md'), '# hello\n', 'utf-8');

  const server = await startWebControlCenterServer(
    {
      getRuntimeStatus: () => ({ runtime: 'docker', sessions: 1, activeRuns: 0 }),
      getProfileStatus: () => ({
        profile: 'core',
        featureFarm: false,
        profileDetection: { source: 'explicit', reason: 'test' },
      }),
      getBuildInfo: () => ({
        startedAt: '2026-02-26T00:00:00.000Z',
        version: '1.1.0',
      }),
      getGatewayStatus: () => ({
        host: '127.0.0.1',
        port: 28989,
        authRequired: false,
      }),
    },
    {
      host: '127.0.0.1',
      port,
      accessMode: 'localhost',
      authToken: '',
      staticDir,
      logsDir,
      fileRoots: [
        { id: 'workspace', label: 'Workspace', path: workspaceDir },
      ],
    },
  );

  try {
    const rootsRes = await fetch(`http://127.0.0.1:${port}/api/files/roots`);
    assert.equal(rootsRes.status, 200);
    const rootsJson = (await rootsRes.json()) as {
      ok: boolean;
      roots: Array<{ id: string; label: string }>;
    };
    assert.equal(rootsJson.ok, true);
    assert.equal(rootsJson.roots[0]?.id, 'workspace');

    const treeRes = await fetch(
      `http://127.0.0.1:${port}/api/files/tree?root=workspace&path=.`,
    );
    assert.equal(treeRes.status, 200);
    const treeJson = (await treeRes.json()) as { ok: boolean; entries: Array<{ relPath: string }> };
    assert.equal(treeJson.ok, true);
    assert.equal(treeJson.entries.some((entry) => entry.relPath === 'hello.md'), true);

    const readRes = await fetch(
      `http://127.0.0.1:${port}/api/files/read?root=workspace&path=hello.md`,
    );
    assert.equal(readRes.status, 200);
    const readJson = (await readRes.json()) as { ok: boolean; content: string };
    assert.equal(readJson.ok, true);
    assert.equal(readJson.content, '# hello\n');

    const writeRes = await fetch(`http://127.0.0.1:${port}/api/files/write`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        root: 'workspace',
        path: 'hello.md',
        content: '# updated\n',
      }),
    });
    assert.equal(writeRes.status, 200);

    const updated = fs.readFileSync(path.join(workspaceDir, 'hello.md'), 'utf-8');
    assert.equal(updated, '# updated\n');
  } finally {
    await server.close();
  }
});

test('web control center file read rejects symlink escapes outside root', async (t) => {
  const port = await getFreePort();
  const staticDir = createStaticDir();
  const logsDir = createLogsDir();
  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-web-workspace-'));
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-web-outside-'));
  const outsideFile = path.join(outsideDir, 'secret.txt');
  fs.writeFileSync(outsideFile, 'top-secret\n', 'utf-8');

  try {
    fs.symlinkSync(outsideFile, path.join(workspaceDir, 'secret-link.txt'));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EPERM' || code === 'EACCES' || code === 'ENOTSUP') {
      t.skip(`symlink unsupported in test environment (${code})`);
      return;
    }
    throw err;
  }

  const server = await startWebControlCenterServer(
    {
      getRuntimeStatus: () => ({ runtime: 'docker', sessions: 1, activeRuns: 0 }),
      getProfileStatus: () => ({
        profile: 'core',
        featureFarm: false,
        profileDetection: { source: 'explicit', reason: 'test' },
      }),
      getBuildInfo: () => ({
        startedAt: '2026-02-26T00:00:00.000Z',
        version: '1.1.0',
      }),
      getGatewayStatus: () => ({
        host: '127.0.0.1',
        port: 28989,
        authRequired: false,
      }),
    },
    {
      host: '127.0.0.1',
      port,
      accessMode: 'localhost',
      authToken: '',
      staticDir,
      logsDir,
      fileRoots: [
        { id: 'workspace', label: 'Workspace', path: workspaceDir },
      ],
    },
  );

  try {
    const readRes = await fetch(
      `http://127.0.0.1:${port}/api/files/read?root=workspace&path=secret-link.txt`,
    );
    assert.equal(readRes.status, 400);
    const readJson = (await readRes.json()) as { ok: boolean; error: string };
    assert.equal(readJson.ok, false);
    assert.match(readJson.error, /escapes root directory via symlink/i);
  } finally {
    await server.close();
  }
});

test('web control center file write rejects symlink paths outside root', async (t) => {
  const port = await getFreePort();
  const staticDir = createStaticDir();
  const logsDir = createLogsDir();
  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-web-workspace-'));
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-web-outside-'));
  const outsideFile = path.join(outsideDir, 'victim.txt');
  fs.writeFileSync(outsideFile, 'safe\n', 'utf-8');

  try {
    fs.symlinkSync(outsideFile, path.join(workspaceDir, 'victim-link.txt'));
    fs.symlinkSync(outsideDir, path.join(workspaceDir, 'outside-dir'));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EPERM' || code === 'EACCES' || code === 'ENOTSUP') {
      t.skip(`symlink unsupported in test environment (${code})`);
      return;
    }
    throw err;
  }

  const server = await startWebControlCenterServer(
    {
      getRuntimeStatus: () => ({ runtime: 'docker', sessions: 1, activeRuns: 0 }),
      getProfileStatus: () => ({
        profile: 'core',
        featureFarm: false,
        profileDetection: { source: 'explicit', reason: 'test' },
      }),
      getBuildInfo: () => ({
        startedAt: '2026-02-26T00:00:00.000Z',
        version: '1.1.0',
      }),
      getGatewayStatus: () => ({
        host: '127.0.0.1',
        port: 28989,
        authRequired: false,
      }),
    },
    {
      host: '127.0.0.1',
      port,
      accessMode: 'localhost',
      authToken: '',
      staticDir,
      logsDir,
      fileRoots: [
        { id: 'workspace', label: 'Workspace', path: workspaceDir },
      ],
    },
  );

  try {
    const writeLeafRes = await fetch(`http://127.0.0.1:${port}/api/files/write`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        root: 'workspace',
        path: 'victim-link.txt',
        content: 'pwned\n',
      }),
    });
    assert.equal(writeLeafRes.status, 400);
    assert.equal(fs.readFileSync(outsideFile, 'utf-8'), 'safe\n');

    const writeParentRes = await fetch(`http://127.0.0.1:${port}/api/files/write`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        root: 'workspace',
        path: 'outside-dir/new.txt',
        content: 'pwned\n',
      }),
    });
    assert.equal(writeParentRes.status, 400);
    assert.equal(fs.existsSync(path.join(outsideDir, 'new.txt')), false);
  } finally {
    await server.close();
  }
});

test('web control center skills catalog groups skill roots with descriptions', async () => {
  const port = await getFreePort();
  const staticDir = createStaticDir();
  const logsDir = createLogsDir();
  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-web-workspace-'));
  const projectSkillsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-web-skills-project-'));
  const userSkillsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-web-skills-user-'));

  fs.mkdirSync(path.join(projectSkillsDir, 'alpha'), { recursive: true });
  fs.writeFileSync(
    path.join(projectSkillsDir, 'alpha', 'SKILL.md'),
    `---
name: alpha
description: "Alpha project skill"
---

# Alpha
`,
    'utf-8',
  );
  fs.mkdirSync(path.join(userSkillsDir, 'beta'), { recursive: true });
  fs.writeFileSync(
    path.join(userSkillsDir, 'beta', 'SKILL.md'),
    '# Beta skill\n',
    'utf-8',
  );

  const server = await startWebControlCenterServer(
    {
      getRuntimeStatus: () => ({ runtime: 'docker', sessions: 1, activeRuns: 0 }),
      getProfileStatus: () => ({
        profile: 'core',
        featureFarm: false,
        profileDetection: { source: 'explicit', reason: 'test' },
      }),
      getBuildInfo: () => ({
        startedAt: '2026-02-26T00:00:00.000Z',
        version: '1.1.0',
      }),
      getGatewayStatus: () => ({
        host: '127.0.0.1',
        port: 28989,
        authRequired: false,
      }),
    },
    {
      host: '127.0.0.1',
      port,
      accessMode: 'localhost',
      authToken: '',
      staticDir,
      logsDir,
      fileRoots: [
        { id: 'workspace', label: 'Workspace', path: workspaceDir },
        { id: 'skills-project', label: 'Project Skills', path: projectSkillsDir },
        { id: 'skills-user', label: 'User Skills', path: userSkillsDir },
      ],
    },
  );

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/skills/catalog`);
    assert.equal(res.status, 200);
    const payload = (await res.json()) as {
      ok: boolean;
      groups: Array<{
        root: { id: string; label: string };
        skills: Array<{ name: string; path: string; description: string }>;
      }>;
    };
    assert.equal(payload.ok, true);
    assert.equal(payload.groups.length, 2);
    const project = payload.groups.find((group) => group.root.id === 'skills-project');
    const user = payload.groups.find((group) => group.root.id === 'skills-user');
    assert.ok(project);
    assert.ok(user);
    assert.equal(project?.skills[0]?.name, 'alpha');
    assert.equal(project?.skills[0]?.description, 'Alpha project skill');
    assert.equal(user?.skills[0]?.name, 'beta');
    assert.equal(user?.skills[0]?.description, 'Beta skill');
  } finally {
    await server.close();
  }
});
