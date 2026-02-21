import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import YAML from 'yaml';

const ENV_KEYS = [
  'FARM_MODE',
  'FARM_PROFILE_PATH',
  'FFT_DASHBOARD_REPO_PATH',
  'HA_URL',
  'HA_TOKEN',
] as const;

interface Fixture {
  rootDir: string;
  haConfigPath: string;
  profilePath: string;
  restoreEnv: () => void;
  cleanup: () => void;
}

type ExecuteFarmAction = (
  request: {
    type: 'farm_action';
    action: string;
    params: Record<string, unknown>;
    requestId: string;
  },
  isMain: boolean,
) => Promise<{
  requestId: string;
  status: 'success' | 'error';
  result?: unknown;
  error?: string;
  executedAt: string;
}>;

function makeFixture(profileStatus: string = 'pass'): Fixture {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-farm-gateway-'));
  const dashboardRepoPath = path.join(rootDir, 'dashboard-repo');
  const haConfigPath = path.join(dashboardRepoPath, 'ha_config');
  fs.mkdirSync(path.join(haConfigPath, 'www'), { recursive: true });

  const profilePath = path.join(rootDir, 'farm-profile.json');
  fs.writeFileSync(
    profilePath,
    JSON.stringify({ validation: { status: profileStatus } }, null, 2),
  );

  const previousEnv: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) {
    previousEnv[key] = process.env[key];
  }

  process.env.FARM_MODE = 'production';
  process.env.FARM_PROFILE_PATH = profilePath;
  process.env.FFT_DASHBOARD_REPO_PATH = dashboardRepoPath;
  process.env.HA_URL = 'http://127.0.0.1:8123';
  process.env.HA_TOKEN = 'test-token';

  return {
    rootDir,
    haConfigPath,
    profilePath,
    restoreEnv: () => {
      for (const key of ENV_KEYS) {
        const value = previousEnv[key];
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    },
    cleanup: () => {
      fs.rmSync(rootDir, { recursive: true, force: true });
    },
  };
}

async function loadGateway(): Promise<ExecuteFarmAction> {
  const mod = await import(
    `../src/farm-action-gateway.js?case=${Date.now()}_${Math.random()}`
  );
  return mod.executeFarmAction as ExecuteFarmAction;
}

function writeProfileStatus(profilePath: string, status: string): void {
  fs.writeFileSync(profilePath, JSON.stringify({ validation: { status } }, null, 2));
}

function writeStagingDashboard(haConfigPath: string): string {
  const stagingPath = path.join(haConfigPath, 'ui-lovelace-staging.yaml');
  const dashboard = {
    title: 'Test Dashboard',
    views: [
      {
        title: 'Command Center',
        path: 'command-center',
        cards: [
          {
            id: 'base-1',
            type: 'markdown',
            title: 'Base Card',
            content: 'Base',
          },
        ],
      },
    ],
  };
  fs.writeFileSync(stagingPath, YAML.stringify(dashboard), 'utf-8');
  return stagingPath;
}

let fixture: Fixture;
let executeFarmAction: ExecuteFarmAction;

test.before(async () => {
  fixture = makeFixture('pass');
  executeFarmAction = await loadGateway();
});

test.after(() => {
  fixture.restoreEnv();
  fixture.cleanup();
});

test('ha_dashboard_patch supports add/update/remove/move card operations', async () => {
  writeProfileStatus(fixture.profilePath, 'pass');
  const stagingPath = writeStagingDashboard(fixture.haConfigPath);

  const result = await executeFarmAction(
    {
      type: 'farm_action',
      action: 'ha_dashboard_patch',
      params: {
        dashboardFile: '/workspace/dashboard/ui-lovelace-staging.yaml',
        operations: [
          {
            op: 'add_card',
            viewPath: 'command-center',
            card: {
              id: 'alpha',
              type: 'markdown',
              title: 'Alpha',
              content: 'alpha',
            },
            index: 1,
          },
          {
            op: 'update_card',
            viewPath: 'command-center',
            cardId: 'alpha',
            patch: { title: 'Alpha Updated' },
          },
          {
            op: 'add_card',
            viewPath: 'command-center',
            card: {
              id: 'beta',
              type: 'markdown',
              title: 'Beta',
              content: 'beta',
            },
          },
          {
            op: 'move_card',
            viewPath: 'command-center',
            cardId: 'beta',
            toIndex: 0,
          },
          {
            op: 'remove_card',
            viewPath: 'command-center',
            cardId: 'alpha',
          },
        ],
      },
      requestId: 'patch-ops-1',
    },
    true,
  );

  assert.equal(result.status, 'success');

  const written = YAML.parse(fs.readFileSync(stagingPath, 'utf-8')) as {
    views: Array<{ cards: Array<{ id: string }> }>;
  };
  const cards = written.views[0].cards;
  assert.deepEqual(
    cards.map((card) => card.id),
    ['beta', 'base-1'],
  );
  assert.equal(cards.some((card) => card.id === 'alpha'), false);
});

test('ha_dashboard_patch rejects path traversal outside ha_config', async () => {
  writeProfileStatus(fixture.profilePath, 'pass');

  const result = await executeFarmAction(
    {
      type: 'farm_action',
      action: 'ha_dashboard_patch',
      params: {
        dashboardFile: '../outside.yaml',
        operations: [{ op: 'set_theme', theme: 'storm' }],
      },
      requestId: 'patch-path-traversal',
    },
    true,
  );

  assert.equal(result.status, 'error');
  assert.match(result.error || '', /outside ha_config/i);
});

test('ha_dashboard_validate fails on malformed YAML content', async () => {
  writeProfileStatus(fixture.profilePath, 'pass');

  const result = await executeFarmAction(
    {
      type: 'farm_action',
      action: 'ha_dashboard_validate',
      params: {
        content: 'title: [broken',
      },
      requestId: 'validate-malformed-yaml',
    },
    true,
  );

  assert.equal(result.status, 'error');
  assert.match(result.error || '', /parse failed/i);
});

test('ha_canvas_set_spec writes a valid canvas spec', async () => {
  writeProfileStatus(fixture.profilePath, 'pass');

  const result = await executeFarmAction(
    {
      type: 'farm_action',
      action: 'ha_canvas_set_spec',
      params: {
        spec: {
          version: '1.0',
          title: 'Initial',
          layout: {
            columns: 2,
            gap: 16,
            rowHeight: 280,
          },
          cards: [
            {
              id: 'kpi-1',
              type: 'kpi',
              title: 'Power',
              entities: ['input_number.solar_generation_kw'],
              options: { suffix: ' kW' },
            },
          ],
        },
        title: 'Override Title',
      },
      requestId: 'canvas-set-spec',
    },
    true,
  );

  assert.equal(result.status, 'success');

  const specPath = path.join(fixture.haConfigPath, 'www', 'agent-canvas-spec.json');
  const raw = fs.readFileSync(specPath, 'utf-8');
  const written = JSON.parse(raw) as { title: string; cards: Array<{ id: string }> };
  assert.equal(written.title, 'Override Title');
  assert.deepEqual(written.cards.map((card) => card.id), ['kpi-1']);
});

test('ha_canvas_patch_spec updates cards by id deterministically', async () => {
  writeProfileStatus(fixture.profilePath, 'pass');

  const specPath = path.join(fixture.haConfigPath, 'www', 'agent-canvas-spec.json');
  const initialSpec = {
    version: '1.0',
    title: 'Agent Canvas',
    layout: {
      columns: 2,
      gap: 16,
      rowHeight: 280,
    },
    cards: [
      {
        id: 'a',
        type: 'kpi',
        title: 'A',
        entities: ['input_number.wind_speed'],
      },
      {
        id: 'b',
        type: 'markdown',
        title: 'B',
        options: { markdown: 'hello' },
      },
    ],
  };
  fs.writeFileSync(specPath, `${JSON.stringify(initialSpec, null, 2)}\n`);

  const result = await executeFarmAction(
    {
      type: 'farm_action',
      action: 'ha_canvas_patch_spec',
      params: {
        operations: [
          {
            op: 'update_card',
            cardId: 'b',
            patch: { title: 'B Updated' },
          },
          {
            op: 'move_card',
            cardId: 'b',
            toIndex: 0,
          },
        ],
      },
      requestId: 'canvas-patch-spec',
    },
    true,
  );

  assert.equal(result.status, 'success');

  const written = JSON.parse(fs.readFileSync(specPath, 'utf-8')) as {
    cards: Array<{ id: string; title: string }>;
  };
  assert.deepEqual(
    written.cards.map((card) => card.id),
    ['b', 'a'],
  );
  assert.equal(written.cards[0].title, 'B Updated');
});

test('farm actions reject non-main requests', async () => {
  writeProfileStatus(fixture.profilePath, 'pass');
  writeStagingDashboard(fixture.haConfigPath);

  const result = await executeFarmAction(
    {
      type: 'farm_action',
      action: 'ha_dashboard_get',
      params: {
        dashboardFile: '/workspace/dashboard/ui-lovelace-staging.yaml',
      },
      requestId: 'non-main-reject',
    },
    false,
  );

  assert.equal(result.status, 'error');
  assert.match(result.error || '', /main-chat-only/i);
});

test('production gate blocks control actions when validation is not pass', async () => {
  writeProfileStatus(fixture.profilePath, 'pending');

  const result = await executeFarmAction(
    {
      type: 'farm_action',
      action: 'ha_dashboard_patch',
      params: {
        dashboardFile: '/workspace/dashboard/ui-lovelace-staging.yaml',
        operations: [{ op: 'set_theme', theme: 'storm' }],
      },
      requestId: 'gate-blocked',
    },
    true,
  );

  assert.equal(result.status, 'error');
  assert.match(result.error || '', /production validation status is "pending"/i);

  writeProfileStatus(fixture.profilePath, 'pass');
});
