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
  fs.writeFileSync(
    path.join(dir, 'fft_nano.log'),
    'line-a\\nline-b\\nline-c\\n',
    'utf-8',
  );
  fs.writeFileSync(
    path.join(dir, 'fft_nano.error.log'),
    'err-a\\nerr-b\\n',
    'utf-8',
  );
  return dir;
}

test('web control center serves runtime status on localhost mode without auth', async () => {
  const port = await getFreePort();
  const staticDir = createStaticDir();
  const logsDir = createLogsDir();

  const server = await startWebControlCenterServer(
    {
      getRuntimeStatus: () => ({
        runtime: 'docker',
        sessions: 3,
        activeRuns: 1,
      }),
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
      fileRoots: [{ id: 'workspace', label: 'Workspace', path: staticDir }],
    },
  );

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/runtime/status`);
    assert.equal(res.status, 200);
    const json = (await res.json()) as {
      ok: boolean;
      runtime: { sessions: number };
    };
    assert.equal(json.ok, true);
    assert.equal(json.runtime.sessions, 3);

    const logsRes = await fetch(
      `http://127.0.0.1:${port}/api/logs/recent?target=error&lines=20`,
    );
    assert.equal(logsRes.status, 200);
    const logsJson = (await logsRes.json()) as { ok: boolean; content: string };
    assert.equal(logsJson.ok, true);
    assert.match(logsJson.content, /err-a/);
  } finally {
    await server.close();
  }
});

test('web control center redacts evaluator verdict details from recent logs endpoint', async () => {
  const port = await getFreePort();
  const staticDir = createStaticDir();
  const logsDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'fft-web-logs-redact-'),
  );
  fs.writeFileSync(
    path.join(logsDir, 'fft_nano.log'),
    [
      'normal line',
      '{"pass":false,"score":1,"issues":["missing artifact"],"feedback":"retry"}',
      '"pass": false,',
      '"score": 1,',
      '"issues": ["missing artifact"],',
      '"feedback": "retry"',
      '}',
    ].join('\n'),
    'utf-8',
  );
  fs.writeFileSync(
    path.join(logsDir, 'fft_nano.error.log'),
    'err-a\n',
    'utf-8',
  );

  const server = await startWebControlCenterServer(
    {
      getRuntimeStatus: () => ({
        runtime: 'docker',
        sessions: 0,
        activeRuns: 0,
      }),
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
      fileRoots: [{ id: 'workspace', label: 'Workspace', path: staticDir }],
    },
  );

  try {
    const res = await fetch(
      `http://127.0.0.1:${port}/api/logs/recent?target=host&lines=50`,
    );
    assert.equal(res.status, 200);
    const json = (await res.json()) as { ok: boolean; content: string };
    assert.equal(json.ok, true);
    assert.match(json.content, /normal line/);
    assert.match(json.content, /verification_failed/);
    assert.doesNotMatch(json.content, /"pass"\s*:/);
    assert.doesNotMatch(json.content, /"score"\s*:/);
    assert.doesNotMatch(json.content, /"issues"\s*:/);
    assert.doesNotMatch(json.content, /"feedback"\s*:/);
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
      getRuntimeStatus: () => ({
        runtime: 'docker',
        sessions: 1,
        activeRuns: 0,
      }),
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
      fileRoots: [{ id: 'workspace', label: 'Workspace', path: staticDir }],
    },
  );

  try {
    const noAuth = await fetch(`http://127.0.0.1:${port}/api/runtime/status`);
    assert.equal(noAuth.status, 401);

    const withAuth = await fetch(
      `http://127.0.0.1:${port}/api/runtime/status`,
      {
        headers: { Authorization: 'Bearer secret-token' },
      },
    );
    assert.equal(withAuth.status, 200);
    const json = (await withAuth.json()) as {
      ok: boolean;
      gateway: { wsUrl: string };
    };
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
  const workspaceDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'fft-web-workspace-'),
  );
  fs.writeFileSync(path.join(workspaceDir, 'hello.md'), '# hello\n', 'utf-8');

  const server = await startWebControlCenterServer(
    {
      getRuntimeStatus: () => ({
        runtime: 'docker',
        sessions: 1,
        activeRuns: 0,
      }),
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
      fileRoots: [{ id: 'workspace', label: 'Workspace', path: workspaceDir }],
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
    const treeJson = (await treeRes.json()) as {
      ok: boolean;
      entries: Array<{ relPath: string }>;
    };
    assert.equal(treeJson.ok, true);
    assert.equal(
      treeJson.entries.some((entry) => entry.relPath === 'hello.md'),
      true,
    );

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

    const updated = fs.readFileSync(
      path.join(workspaceDir, 'hello.md'),
      'utf-8',
    );
    assert.equal(updated, '# updated\n');
  } finally {
    await server.close();
  }
});

test('web control center keeps configured roots even when missing at startup', async () => {
  const port = await getFreePort();
  const staticDir = createStaticDir();
  const logsDir = createLogsDir();
  const parentDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'fft-web-root-parent-'),
  );
  const lazyRootDir = path.join(parentDir, 'lazy-workspace');

  const server = await startWebControlCenterServer(
    {
      getRuntimeStatus: () => ({
        runtime: 'docker',
        sessions: 1,
        activeRuns: 0,
      }),
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
      fileRoots: [{ id: 'workspace', label: 'Workspace', path: lazyRootDir }],
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
    assert.equal(
      rootsJson.roots.some((root) => root.id === 'workspace'),
      true,
    );

    const writeRes = await fetch(`http://127.0.0.1:${port}/api/files/write`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        root: 'workspace',
        path: 'bootstrapped.txt',
        content: 'created-after-startup\n',
      }),
    });
    assert.equal(writeRes.status, 200);
    assert.equal(
      fs.readFileSync(path.join(lazyRootDir, 'bootstrapped.txt'), 'utf-8'),
      'created-after-startup\n',
    );
  } finally {
    await server.close();
  }
});

test('web control center exposes onboarding status and accepts onboarding config writes', async () => {
  const port = await getFreePort();
  const staticDir = createStaticDir();
  const logsDir = createLogsDir();
  let receivedConfig: {
    providerPreset?: string;
    model?: string;
    apiKey?: string;
    telegramBotToken?: string;
    whatsappEnabled?: boolean;
  } | null = null;

  const server = await startWebControlCenterServer(
    {
      getRuntimeStatus: () => ({ runtime: 'host', sessions: 0, activeRuns: 0 }),
      getProfileStatus: () => ({
        profile: 'core',
        featureFarm: false,
        profileDetection: { source: 'explicit', reason: 'test' },
      }),
      getBuildInfo: () => ({
        startedAt: '2026-04-17T00:00:00.000Z',
        version: '1.6.1',
      }),
      getGatewayStatus: () => ({
        host: '127.0.0.1',
        port: 28989,
        authRequired: false,
      }),
      getOnboardingStatus: () => ({
        active: true,
        providerPreset: 'openrouter',
        model: 'anthropic/claude-3.5-sonnet',
        apiKeyConfigured: false,
        telegramBotConfigured: false,
        telegramAdminSecretConfigured: true,
        whatsappEnabled: false,
        configComplete: false,
      }),
      applyOnboardingConfig: async (payload) => {
        receivedConfig = payload;
        return { ok: true, requiresRestart: true };
      },
    },
    {
      host: '127.0.0.1',
      port,
      accessMode: 'localhost',
      authToken: '',
      staticDir,
      logsDir,
      fileRoots: [{ id: 'workspace', label: 'Workspace', path: staticDir }],
    },
  );

  try {
    const statusRes = await fetch(
      `http://127.0.0.1:${port}/api/onboarding/status`,
    );
    assert.equal(statusRes.status, 200);
    const statusJson = (await statusRes.json()) as {
      ok: boolean;
      onboarding: {
        active: boolean;
        providerPreset: string;
        telegramBotConfigured: boolean;
      };
    };
    assert.equal(statusJson.ok, true);
    assert.equal(statusJson.onboarding.active, true);
    assert.equal(statusJson.onboarding.providerPreset, 'openrouter');
    assert.equal(statusJson.onboarding.telegramBotConfigured, false);

    const configRes = await fetch(
      `http://127.0.0.1:${port}/api/onboarding/configure`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerPreset: 'openrouter',
          model: 'openai/gpt-4.1-mini',
          apiKey: 'or-key',
          telegramBotToken: '123:abc',
          whatsappEnabled: false,
        }),
      },
    );
    assert.equal(configRes.status, 200);
    const configJson = (await configRes.json()) as {
      ok: boolean;
      requiresRestart: boolean;
    };
    assert.equal(configJson.ok, true);
    assert.equal(configJson.requiresRestart, true);
    assert.deepEqual(receivedConfig, {
      providerPreset: 'openrouter',
      model: 'openai/gpt-4.1-mini',
      apiKey: 'or-key',
      telegramBotToken: '123:abc',
      whatsappEnabled: false,
    });
  } finally {
    await server.close();
  }
});

test('web control center file read rejects symlink escapes outside root', async (t) => {
  const port = await getFreePort();
  const staticDir = createStaticDir();
  const logsDir = createLogsDir();
  const workspaceDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'fft-web-workspace-'),
  );
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
      getRuntimeStatus: () => ({
        runtime: 'docker',
        sessions: 1,
        activeRuns: 0,
      }),
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
      fileRoots: [{ id: 'workspace', label: 'Workspace', path: workspaceDir }],
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
  const workspaceDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'fft-web-workspace-'),
  );
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
      getRuntimeStatus: () => ({
        runtime: 'docker',
        sessions: 1,
        activeRuns: 0,
      }),
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
      fileRoots: [{ id: 'workspace', label: 'Workspace', path: workspaceDir }],
    },
  );

  try {
    const writeLeafRes = await fetch(
      `http://127.0.0.1:${port}/api/files/write`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          root: 'workspace',
          path: 'victim-link.txt',
          content: 'pwned\n',
        }),
      },
    );
    assert.equal(writeLeafRes.status, 400);
    assert.equal(fs.readFileSync(outsideFile, 'utf-8'), 'safe\n');

    const writeParentRes = await fetch(
      `http://127.0.0.1:${port}/api/files/write`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          root: 'workspace',
          path: 'outside-dir/new.txt',
          content: 'pwned\n',
        }),
      },
    );
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
  const workspaceDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'fft-web-workspace-'),
  );
  const projectSkillsDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'fft-web-skills-project-'),
  );
  const userSkillsDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'fft-web-skills-user-'),
  );

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
      getRuntimeStatus: () => ({
        runtime: 'docker',
        sessions: 1,
        activeRuns: 0,
      }),
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
        {
          id: 'skills-project',
          label: 'Project Skills',
          path: projectSkillsDir,
        },
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
    const project = payload.groups.find(
      (group) => group.root.id === 'skills-project',
    );
    const user = payload.groups.find(
      (group) => group.root.id === 'skills-user',
    );
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

test('web control center exposes provider setup, runtime settings, and model inventory APIs', async () => {
  const port = await getFreePort();
  const staticDir = createStaticDir();
  const logsDir = createLogsDir();
  let receivedSettings: unknown = null;

  const server = await startWebControlCenterServer(
    {
      getRuntimeStatus: () => ({ runtime: 'host', sessions: 0, activeRuns: 0 }),
      getProfileStatus: () => ({
        profile: 'core',
        featureFarm: false,
        profileDetection: { source: 'explicit', reason: 'test' },
      }),
      getBuildInfo: () => ({
        startedAt: '2026-05-22T00:00:00.000Z',
        version: '0.2.2',
      }),
      getGatewayStatus: () => ({
        host: '127.0.0.1',
        port: 28989,
        authRequired: false,
      }),
      getProviderSetup: () => [
        {
          id: 'openrouter',
          label: 'OpenRouter',
          piApi: 'openrouter',
          defaultModel: 'anthropic/claude-3.5-sonnet',
          apiKeyEnv: 'OPENROUTER_API_KEY',
          apiKeyRequired: true,
          signupUrl: 'https://openrouter.ai/keys',
        },
      ],
      getRuntimeSettings: () => ({
        providerPreset: 'openrouter',
        provider: 'openrouter',
        model: 'anthropic/claude-3.5-sonnet',
        apiKeyEnv: 'OPENROUTER_API_KEY',
        apiKeyConfigured: false,
        telegramBotConfigured: true,
        whatsappEnabled: false,
        heartbeatEnabled: true,
        heartbeatEvery: '30m',
      }),
      applyRuntimeSettings: async (payload) => {
        receivedSettings = payload;
        return {
          ok: true,
          requiresRestart: true,
          adminSecret: 'generated-secret',
        };
      },
      listRuntimeModels: async () => ({
        ok: true,
        models: [
          { provider: 'openrouter', model: 'anthropic/claude-3.5-sonnet' },
        ],
      }),
    },
    {
      host: '127.0.0.1',
      port,
      accessMode: 'localhost',
      authToken: '',
      staticDir,
      logsDir,
      fileRoots: [{ id: 'workspace', label: 'Workspace', path: staticDir }],
    },
  );

  try {
    const providersRes = await fetch(
      `http://127.0.0.1:${port}/api/settings/providers`,
    );
    assert.equal(providersRes.status, 200);
    const providersJson = (await providersRes.json()) as {
      ok: boolean;
      providers: Array<{ id: string; signupUrl?: string }>;
    };
    assert.equal(providersJson.ok, true);
    assert.equal(providersJson.providers[0]?.id, 'openrouter');
    assert.equal(
      providersJson.providers[0]?.signupUrl,
      'https://openrouter.ai/keys',
    );

    const settingsRes = await fetch(
      `http://127.0.0.1:${port}/api/settings/runtime`,
    );
    assert.equal(settingsRes.status, 200);
    const settingsJson = (await settingsRes.json()) as {
      ok: boolean;
      settings: { apiKeyEnv: string; apiKeyConfigured: boolean };
    };
    assert.equal(settingsJson.settings.apiKeyEnv, 'OPENROUTER_API_KEY');
    assert.equal(settingsJson.settings.apiKeyConfigured, false);

    const modelsRes = await fetch(
      `http://127.0.0.1:${port}/api/settings/models`,
    );
    assert.equal(modelsRes.status, 200);
    const modelsJson = (await modelsRes.json()) as {
      ok: boolean;
      models: Array<{ provider: string; model: string }>;
    };
    assert.equal(modelsJson.models[0]?.provider, 'openrouter');

    const saveRes = await fetch(
      `http://127.0.0.1:${port}/api/settings/runtime`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerPreset: 'openrouter',
          model: 'm1',
          endpoint: '',
          clearEndpoint: true,
          telegramBotToken: '123:abc',
        }),
      },
    );
    assert.equal(saveRes.status, 200);
    const saveJson = (await saveRes.json()) as {
      ok: boolean;
      requiresRestart: boolean;
      adminSecret?: string;
    };
    assert.equal(saveJson.adminSecret, 'generated-secret');
    assert.deepEqual(receivedSettings, {
      providerPreset: 'openrouter',
      model: 'm1',
      endpoint: '',
      clearEndpoint: true,
      telegramBotToken: '123:abc',
    });
  } finally {
    await server.close();
  }
});

test('web control center exposes system prompt preview without persisting system messages', async () => {
  const port = await getFreePort();
  const staticDir = createStaticDir();
  const logsDir = createLogsDir();
  let previewCalls = 0;

  const server = await startWebControlCenterServer(
    {
      getRuntimeStatus: () => ({ runtime: 'host', sessions: 0, activeRuns: 0 }),
      getProfileStatus: () => ({
        profile: 'core',
        featureFarm: false,
        profileDetection: { source: 'explicit', reason: 'test' },
      }),
      getBuildInfo: () => ({
        startedAt: '2026-05-22T00:00:00.000Z',
        version: '0.2.2',
      }),
      getGatewayStatus: () => ({
        host: '127.0.0.1',
        port: 28989,
        authRequired: false,
      }),
      getSystemPromptPreview: () => {
        previewCalls += 1;
        return {
          text: 'system text',
          report: { totalChars: 11 },
          persisted: false,
          note: 'Preview only; no role:system message is stored or sent.',
        };
      },
    },
    {
      host: '127.0.0.1',
      port,
      accessMode: 'localhost',
      authToken: '',
      staticDir,
      logsDir,
      fileRoots: [{ id: 'workspace', label: 'Workspace', path: staticDir }],
    },
  );

  try {
    const res = await fetch(
      `http://127.0.0.1:${port}/api/system-prompt?sessionKey=main`,
    );
    assert.equal(res.status, 200);
    const json = (await res.json()) as {
      ok: boolean;
      preview: { text: string; persisted: boolean; note: string };
    };
    assert.equal(json.ok, true);
    assert.equal(json.preview.text, 'system text');
    assert.equal(json.preview.persisted, false);
    assert.match(json.preview.note, /no role:system message/i);
    assert.equal(previewCalls, 1);
  } finally {
    await server.close();
  }
});

test('web control center exposes tasks, pipelines, memory, and knowledge APIs', async () => {
  const port = await getFreePort();
  const staticDir = createStaticDir();
  const logsDir = createLogsDir();
  let taskAction: unknown = null;
  let captured: unknown = null;

  const server = await startWebControlCenterServer(
    {
      getRuntimeStatus: () => ({ runtime: 'host', sessions: 0, activeRuns: 0 }),
      getProfileStatus: () => ({
        profile: 'core',
        featureFarm: false,
        profileDetection: { source: 'explicit', reason: 'test' },
      }),
      getBuildInfo: () => ({
        startedAt: '2026-05-22T00:00:00.000Z',
        version: '0.2.2',
      }),
      getGatewayStatus: () => ({
        host: '127.0.0.1',
        port: 28989,
        authRequired: false,
      }),
      listTasks: () => ({
        tasks: [{ id: 'task-1', status: 'active' }],
        due: ['task-1'],
        runs: {},
      }),
      taskAction: (payload) => {
        taskAction = payload;
        return { ok: true };
      },
      getPipelines: () => ({
        activeRuns: [],
        activeCoderRuns: [],
        tasks: { total: 1 },
      }),
      getMemoryOverview: () => ({
        docs: [{ name: 'MEMORY.md', exists: true }],
      }),
      getKnowledgeStatus: () => ({
        status: { ready: true, rawCaptureCount: 0, wikiDocCount: 3 },
        wiki: { index: '# Wiki Index', progress: '# Progress', log: '# Log' },
      }),
      knowledgeCapture: (payload) => {
        captured = payload;
        return { relativePath: 'knowledge/raw/test.md' };
      },
      knowledgeLint: () => ({ ok: true, warnings: [] }),
      validateSkills: () => ({ ok: true, stdout: 'valid' }),
    },
    {
      host: '127.0.0.1',
      port,
      accessMode: 'localhost',
      authToken: '',
      staticDir,
      logsDir,
      fileRoots: [{ id: 'workspace', label: 'Workspace', path: staticDir }],
    },
  );

  try {
    const tasksRes = await fetch(`http://127.0.0.1:${port}/api/tasks`);
    assert.equal(tasksRes.status, 200);
    const tasksJson = (await tasksRes.json()) as {
      ok: boolean;
      tasks: Array<{ id: string }>;
    };
    assert.equal(tasksJson.tasks[0]?.id, 'task-1');

    const actionRes = await fetch(`http://127.0.0.1:${port}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'task-1', action: 'pause' }),
    });
    assert.equal(actionRes.status, 200);
    assert.deepEqual(taskAction, { id: 'task-1', action: 'pause' });

    for (const endpoint of [
      '/api/pipelines',
      '/api/memory',
      '/api/knowledge',
    ]) {
      const res = await fetch(`http://127.0.0.1:${port}${endpoint}`);
      assert.equal(res.status, 200);
      const json = (await res.json()) as { ok: boolean };
      assert.equal(json.ok, true);
    }

    const captureRes = await fetch(
      `http://127.0.0.1:${port}/api/knowledge/capture`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'new fact', source: 'test' }),
      },
    );
    assert.equal(captureRes.status, 200);
    assert.deepEqual(captured, { text: 'new fact', source: 'test' });

    const lintRes = await fetch(`http://127.0.0.1:${port}/api/knowledge/lint`, {
      method: 'POST',
    });
    assert.equal(lintRes.status, 200);

    const skillsRes = await fetch(
      `http://127.0.0.1:${port}/api/skills/validate`,
      { method: 'POST' },
    );
    assert.equal(skillsRes.status, 200);
  } finally {
    await server.close();
  }
});
