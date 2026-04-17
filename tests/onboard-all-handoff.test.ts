import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

function setupOnboardAllFixture(options: {
  withMainChatId: boolean;
  envConfigured?: boolean;
}): string {
  const repoRoot = process.cwd();
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'fft-onboard-all-'));
  const scriptsDir = path.join(fixtureRoot, 'scripts');
  const dataDir = path.join(fixtureRoot, 'data');
  const homeDir = path.join(fixtureRoot, 'home');
  mkdirSync(scriptsDir, { recursive: true });
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(homeDir, { recursive: true });

  const onboardAllSource = readFileSync(path.join(repoRoot, 'scripts', 'onboard-all.sh'), 'utf8');
  const onboardAllPath = path.join(scriptsDir, 'onboard-all.sh');
  writeFileSync(onboardAllPath, onboardAllSource, 'utf8');
  chmodSync(onboardAllPath, 0o755);

  writeFileSync(
    path.join(scriptsDir, 'onboard.sh'),
    `#!/usr/bin/env bash
set -euo pipefail
log_file="\${FFT_TEST_ONBOARD_LOG:-}"
if [[ -n "$log_file" ]]; then
  printf 'args:%s\\n' "$*" > "$log_file"
fi
echo "stub onboard complete"
`,
    'utf8',
  );
  chmodSync(path.join(scriptsDir, 'onboard.sh'), 0o755);

  writeFileSync(
    path.join(scriptsDir, 'setup.sh'),
    `#!/usr/bin/env bash
set -euo pipefail
log_file="\${FFT_TEST_SETUP_LOG:-}"
if [[ -n "$log_file" ]]; then
  {
    printf 'args:%s\\n' "$*"
    printf 'allow_host:%s\\n' "\${FFT_NANO_ALLOW_HOST_RUNTIME:-}"
  } > "$log_file"
fi
if [[ "\${FFT_TEST_SETUP_WRITE_HOST_ENV:-0}" == "1" ]]; then
  {
    printf 'CONTAINER_RUNTIME=host\\n'
    printf 'FFT_NANO_ALLOW_HOST_RUNTIME=1\\n'
  } >> .env
fi
echo "stub setup complete"
`,
    'utf8',
  );
  chmodSync(path.join(scriptsDir, 'setup.sh'), 0o755);

  writeFileSync(
    path.join(scriptsDir, 'service.sh'),
    `#!/usr/bin/env bash
set -euo pipefail
state_file="\${FFT_TEST_SERVICE_STATE:?}"
log_file="\${FFT_TEST_SERVICE_LOG:-}"
action="\${1:-status}"
if [[ -n "$log_file" ]]; then
  printf 'action:%s\\n' "$action" >> "$log_file"
fi
case "$action" in
  install|start|restart)
    printf 'running\\n' > "$state_file"
    echo "stub service \${action}"
    ;;
  status)
    [[ -f "$state_file" ]] || exit 1
    ;;
  *)
    ;;
esac
`,
    'utf8',
  );
  chmodSync(path.join(scriptsDir, 'service.sh'), 0o755);

  writeFileSync(
    path.join(scriptsDir, 'web.sh'),
    `#!/usr/bin/env bash
set -euo pipefail
log_file="\${FFT_TEST_WEB_LOG:-}"
if [[ -n "$log_file" ]]; then
  printf 'args:%s\\n' "$*" > "$log_file"
fi
echo "stub web open"
`,
    'utf8',
  );
  chmodSync(path.join(scriptsDir, 'web.sh'), 0o755);

  writeFileSync(
    path.join(fixtureRoot, '.env'),
    (
      options.envConfigured === false
        ? [
            'PI_API=replace-me',
            'PI_MODEL=replace-me',
            'OPENAI_API_KEY=replace-me',
            'TELEGRAM_BOT_TOKEN=replace-me',
            'TELEGRAM_ADMIN_SECRET=test-secret',
          ]
        : [
            'PI_API=openai',
            'PI_MODEL=gpt-4o-mini',
            'OPENAI_API_KEY=test-key',
            'TELEGRAM_BOT_TOKEN=test-token',
            'TELEGRAM_ADMIN_SECRET=test-secret',
            options.withMainChatId ? 'TELEGRAM_MAIN_CHAT_ID=12345' : '',
          ]
    )
      .filter(Boolean)
      .join('\n') + '\n',
    'utf8',
  );

  return fixtureRoot;
}

function runOnboardAllFixture(
  fixtureRoot: string,
  options: { runtime?: 'auto' | 'docker' | 'host'; skipSetup?: boolean } = {},
): string {
  const serviceState = path.join(fixtureRoot, 'service.state');
  const serviceLog = path.join(fixtureRoot, 'service.log');
  const setupLog = path.join(fixtureRoot, 'setup.log');
  const onboardLog = path.join(fixtureRoot, 'onboard.log');
  const webLog = path.join(fixtureRoot, 'web.log');
  const args = [
    'scripts/onboard-all.sh',
    '--non-interactive',
    '--accept-risk',
    '--operator',
    'Test Operator',
    '--assistant-name',
    'FarmFriend',
    '--flow',
    'quickstart',
    '--mode',
    'local',
    '--auth-choice',
    'skip',
    '--hatch',
    'later',
    '--skip-channels',
    '--skip-skills',
    '--skip-health',
    '--skip-ui',
    '--skip-doctor',
    '--no-backup',
  ];
  if (options.skipSetup !== false) {
    args.push('--skip-setup');
  }
  if (options.runtime) {
    args.push('--runtime', options.runtime);
  }

  const result = spawnSync('bash', args, {
    cwd: fixtureRoot,
    env: {
      ...process.env,
      HOME: path.join(fixtureRoot, 'home'),
      FFT_TEST_SERVICE_STATE: serviceState,
      FFT_TEST_SERVICE_LOG: serviceLog,
      FFT_TEST_SETUP_LOG: setupLog,
      FFT_TEST_ONBOARD_LOG: onboardLog,
      FFT_TEST_WEB_LOG: webLog,
    },
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  return result.stdout;
}

test('onboard-all prints required Telegram claim steps for first-run users', () => {
  const fixtureRoot = setupOnboardAllFixture({ withMainChatId: false });
  const output = runOnboardAllFixture(fixtureRoot);

  assert.match(output, /ONBOARDING COMPLETE: USER ACTION REQUIRED/);
  assert.match(output, /Required now:/);
  assert.match(output, /In Telegram DM with your bot: \/id then \/main <secret>/);
});

test('onboard-all prints READY when Telegram main chat is already configured', () => {
  const fixtureRoot = setupOnboardAllFixture({ withMainChatId: true });
  const output = runOnboardAllFixture(fixtureRoot);

  assert.match(output, /ONBOARDING COMPLETE: READY/);
});

test('onboard-all passes explicit host opt-in to setup when runtime=host', () => {
  const fixtureRoot = setupOnboardAllFixture({ withMainChatId: false });
  runOnboardAllFixture(fixtureRoot, { runtime: 'host', skipSetup: false });
  const setupLog = readFileSync(path.join(fixtureRoot, 'setup.log'), 'utf8');
  assert.match(setupLog, /args:--runtime host/);
  assert.match(setupLog, /allow_host:1/);
});

test('onboard-all passes runtime persisted by setup into onboarding', () => {
  const fixtureRoot = setupOnboardAllFixture({ withMainChatId: false });
  const result = spawnSync(
    'bash',
    [
      'scripts/onboard-all.sh',
      '--non-interactive',
      '--accept-risk',
      '--operator',
      'Test Operator',
      '--assistant-name',
      'FarmFriend',
      '--flow',
      'quickstart',
      '--mode',
      'local',
      '--auth-choice',
      'skip',
      '--hatch',
      'later',
      '--skip-channels',
      '--skip-skills',
      '--skip-health',
      '--skip-ui',
      '--skip-doctor',
      '--no-backup',
    ],
    {
      cwd: fixtureRoot,
      env: {
        ...process.env,
        HOME: path.join(fixtureRoot, 'home'),
        FFT_TEST_SERVICE_STATE: path.join(fixtureRoot, 'service.state'),
        FFT_TEST_SETUP_LOG: path.join(fixtureRoot, 'setup.log'),
        FFT_TEST_ONBOARD_LOG: path.join(fixtureRoot, 'onboard.log'),
        FFT_TEST_SETUP_WRITE_HOST_ENV: '1',
      },
      encoding: 'utf8',
    },
  );

  assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  const onboardLog = readFileSync(path.join(fixtureRoot, 'onboard.log'), 'utf8');
  assert.match(onboardLog, /args:.*--runtime host/);
});

test('onboard-all launches browser-first onboarding handoff when env is incomplete', () => {
  const fixtureRoot = setupOnboardAllFixture({
    withMainChatId: false,
    envConfigured: false,
  });
  const output = runOnboardAllFixture(fixtureRoot);

  const webLog = readFileSync(path.join(fixtureRoot, 'web.log'), 'utf8');
  assert.match(webLog, /args:--open/);

  const serviceLog = readFileSync(path.join(fixtureRoot, 'service.log'), 'utf8');
  assert.match(serviceLog, /action:install/);
  assert.match(serviceLog, /action:restart/);

  const envBody = readFileSync(path.join(fixtureRoot, '.env'), 'utf8');
  assert.match(envBody, /^FFT_NANO_ONBOARDING_MODE=1$/m);
  assert.match(envBody, /^WHATSAPP_ENABLED=0$/m);

  assert.doesNotMatch(output, /\[3\/5\] Running onboarding/);
  assert.match(output, /Launching first-run onboarding wizard/);
  assert.match(output, /Continue setup in FFT CONTROL CENTER/);
});
