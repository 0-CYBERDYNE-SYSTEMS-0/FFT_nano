import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import test from 'node:test';

const PROFILE_ENV_KEYS = [
  'FFT_PROFILE',
  'FEATURE_FARM',
  'FARM_STATE_ENABLED',
  'FARM_PROFILE_PATH',
  'FFT_DASHBOARD_REPO_PATH',
  'HA_TOKEN',
] as const;

async function withIsolatedProfileEnv<T>(
  fn: (workspace: string) => Promise<T>,
): Promise<T> {
  const previousCwd = process.cwd();
  const previousEnv: Record<string, string | undefined> = {};
  for (const key of PROFILE_ENV_KEYS) previousEnv[key] = process.env[key];

  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-profile-test-'));
  fs.mkdirSync(path.join(workspace, 'data'), { recursive: true });

  for (const key of PROFILE_ENV_KEYS) delete process.env[key];
  process.chdir(workspace);

  try {
    return await fn(workspace);
  } finally {
    process.chdir(previousCwd);
    for (const key of PROFILE_ENV_KEYS) {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key];
    }
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

async function importProfileModule() {
  return import(`../src/profile.ts?case=${Date.now()}_${Math.random()}`);
}

test('profile defaults to core when no farm signals exist', async () => {
  await withIsolatedProfileEnv(async () => {
    const mod = await importProfileModule();
    assert.equal(mod.FFT_PROFILE, 'core');
    assert.equal(mod.FEATURE_FARM, false);
    assert.equal(mod.PROFILE_DETECTION.source, 'default');
  });
});

test('profile resolves to farm when explicit FFT_PROFILE=farm is set', async () => {
  await withIsolatedProfileEnv(async () => {
    process.env.FFT_PROFILE = 'farm';
    const mod = await importProfileModule();
    assert.equal(mod.FFT_PROFILE, 'farm');
    assert.equal(mod.FEATURE_FARM, true);
    assert.equal(mod.PROFILE_DETECTION.source, 'env');
  });
});

test('profile auto-preserves farm when legacy farm artifacts exist', async () => {
  await withIsolatedProfileEnv(async (workspace) => {
    const farmProfilePath = path.join(workspace, 'data', 'farm-profile.json');
    fs.writeFileSync(farmProfilePath, '{}\n', 'utf-8');
    const mod = await importProfileModule();
    assert.equal(mod.FFT_PROFILE, 'farm');
    assert.equal(mod.FEATURE_FARM, true);
    assert.equal(mod.PROFILE_DETECTION.source, 'auto_preserve');
  });
});

test('feature override can disable farm paths even when profile resolves to farm', async () => {
  await withIsolatedProfileEnv(async () => {
    process.env.FFT_PROFILE = 'farm';
    process.env.FEATURE_FARM = '0';
    const mod = await importProfileModule();
    assert.equal(mod.FFT_PROFILE, 'farm');
    assert.equal(mod.FEATURE_FARM, false);
  });
});
