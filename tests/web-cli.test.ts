import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const REPO_ROOT = process.cwd();

type ServiceState = 'running' | 'stopped' | 'not_installed';

interface FixtureOptions {
  readonly healthCodes: readonly string[];
  readonly openerExit?: number;
  readonly serviceState: ServiceState;
}

interface Fixture {
  readonly binDir: string;
  readonly healthCodesPath: string;
  readonly logPath: string;
  readonly openerExit: number;
  readonly root: string;
  readonly serviceStatePath: string;
  readonly termuxPrefix: string;
}

function writeExecutable(filePath: string, body: string): void {
  writeFileSync(filePath, body, 'utf8');
  chmodSync(filePath, 0o755);
}

function createFixture(options: FixtureOptions): Fixture {
  const root = mkdtempSync(path.join(tmpdir(), 'fft-web-cli-'));
  const binDir = path.join(root, 'bin');
  const termuxPrefix = path.join(root, 'termux', 'usr');
  const logPath = path.join(root, 'calls.log');
  const healthCodesPath = path.join(root, 'health-codes');
  const serviceStatePath = path.join(root, 'service-state');

  mkdirSync(binDir, { recursive: true });
  mkdirSync(path.join(root, 'scripts'), { recursive: true });
  writeFileSync(path.join(root, 'package.json'), '{"name":"fft_nano"}\n', 'utf8');
  writeExecutable(path.join(root, 'scripts', 'start.sh'), '#!/usr/bin/env bash\nexit 0\n');
  copyFileSync(path.join(REPO_ROOT, 'scripts', 'web.sh'), path.join(root, 'scripts', 'web.sh'));
  copyFileSync(path.join(REPO_ROOT, 'scripts', 'service.sh'), path.join(root, 'scripts', 'service.sh'));
  chmodSync(path.join(root, 'scripts', 'web.sh'), 0o755);
  chmodSync(path.join(root, 'scripts', 'service.sh'), 0o755);

  if (options.serviceState !== 'not_installed') {
    mkdirSync(path.join(termuxPrefix, 'var', 'service', 'fft-nano'), { recursive: true });
  }
  writeFileSync(serviceStatePath, `${options.serviceState}\n`, 'utf8');
  writeFileSync(healthCodesPath, `${options.healthCodes.join('\n')}\n`, 'utf8');

  writeExecutable(
    path.join(binDir, 'uname'),
    '#!/usr/bin/env bash\nprintf \'Linux\\n\'\n',
  );
  writeExecutable(
    path.join(binDir, 'sv'),
    `#!/usr/bin/env bash
set -euo pipefail
case "\${1:-}" in
  status)
    printf 'sv status %s\\n' "\${2:-}" >> "\${FFT_WEB_TEST_LOG:?}"
    if [[ "$(cat "\${FFT_WEB_TEST_SERVICE_STATE:?}")" == "running" ]]; then
      printf 'run: fft-nano (pid 1) 1s\\n'
    else
      printf 'down: fft-nano 1s\\n'
    fi
    ;;
  up)
    printf 'sv up %s\\n' "\${2:-}" >> "\${FFT_WEB_TEST_LOG:?}"
    printf 'running\\n' > "\${FFT_WEB_TEST_SERVICE_STATE:?}"
    ;;
  *)
    exit 1
    ;;
esac
`,
  );
  writeExecutable(
    path.join(binDir, 'curl'),
    `#!/usr/bin/env bash
set -euo pipefail
printf 'curl %s\\n' "$*" >> "\${FFT_WEB_TEST_LOG:?}"
if [[ "$*" == *'/api/health'* ]]; then
  status_code="$(head -n 1 "\${FFT_WEB_TEST_HEALTH_CODES:?}")"
  tail -n +2 "\${FFT_WEB_TEST_HEALTH_CODES}" > "\${FFT_WEB_TEST_HEALTH_CODES}.next"
  mv "\${FFT_WEB_TEST_HEALTH_CODES}.next" "\${FFT_WEB_TEST_HEALTH_CODES}"
  printf '%s' "\${status_code}"
  [[ "\${status_code}" == '200' ]] && exit 0
  exit 7
fi
printf '200'
`,
  );
  writeExecutable(
    path.join(binDir, 'termux-open-url'),
    `#!/usr/bin/env bash
set -euo pipefail
printf 'termux-open-url %s\\n' "\${1:-}" >> "\${FFT_WEB_TEST_LOG:?}"
exit "\${FFT_WEB_TEST_OPENER_EXIT:-0}"
`,
  );
  for (const opener of ['open', 'xdg-open']) {
    writeExecutable(
      path.join(binDir, opener),
      `#!/usr/bin/env bash
set -euo pipefail
printf '${opener} %s\\n' "\${1:-}" >> "\${FFT_WEB_TEST_LOG:?}"
`,
    );
  }
  writeExecutable(
    path.join(binDir, 'sleep'),
    `#!/usr/bin/env bash
set -euo pipefail
printf 'sleep %s\\n' "\${1:-}" >> "\${FFT_WEB_TEST_LOG:?}"
`,
  );

  return {
    binDir,
    healthCodesPath,
    logPath,
    openerExit: options.openerExit ?? 0,
    root,
    serviceStatePath,
    termuxPrefix,
  };
}

function runWeb(fixture: Fixture): ReturnType<typeof spawnSync> {
  return spawnSync(
    'node',
    [path.join(REPO_ROOT, 'bin', 'fft.js'), '--repo', fixture.root, 'web', '--open'],
    {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        FFT_NANO_READY_TIMEOUT_SECONDS: '2',
        FFT_WEB_TEST_HEALTH_CODES: fixture.healthCodesPath,
        FFT_WEB_TEST_LOG: fixture.logPath,
        FFT_WEB_TEST_OPENER_EXIT: String(fixture.openerExit),
        FFT_WEB_TEST_SERVICE_STATE: fixture.serviceStatePath,
        HOME: path.join(fixture.root, 'home'),
        PATH: `${fixture.binDir}:${process.env.PATH}`,
        PREFIX: fixture.termuxPrefix,
        TERMUX_VERSION: '0.118.0',
      },
    },
  );
}

function calls(fixture: Fixture): string {
  if (!existsSync(fixture.logPath)) {
    return '';
  }
  return readFileSync(fixture.logPath, 'utf8');
}

function removeFixture(fixture: Fixture): void {
  rmSync(fixture.root, { recursive: true, force: true });
}

test('fft web --open opens Android only after a running Termux service is healthy', () => {
  // Given
  const fixture = createFixture({ healthCodes: ['200'], serviceState: 'running' });
  try {
    // When
    const result = runWeb(fixture);
    const log = calls(fixture);

    // Then
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(log, /sv status fft-nano\ncurl .*\/api\/health\ntermux-open-url http:\/\/127\.0\.0\.1:28990\n/);
    assert.doesNotMatch(log, /(?:^|\n)(?:open|xdg-open) /);
  } finally {
    removeFixture(fixture);
  }
});

test('fft web --open starts a stopped Termux service before waiting for health', () => {
  // Given
  const fixture = createFixture({ healthCodes: ['200'], serviceState: 'stopped' });
  try {
    // When
    const result = runWeb(fixture);

    // Then
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(calls(fixture), /sv status fft-nano\nsv up fft-nano\ncurl .*\/api\/health\ntermux-open-url /);
  } finally {
    removeFixture(fixture);
  }
});

test('fft web --open rejects a healthy unmanaged endpoint when the Termux service is missing', () => {
  // Given
  const fixture = createFixture({ healthCodes: ['200'], serviceState: 'not_installed' });
  try {
    // When
    const result = runWeb(fixture);
    const log = calls(fixture);

    // Then
    assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /service.*not installed/i);
    assert.doesNotMatch(log, /curl |termux-open-url/);
  } finally {
    removeFixture(fixture);
  }
});

test('fft web --open does not open Android when the managed service never becomes healthy', () => {
  // Given
  const fixture = createFixture({ healthCodes: ['000', '000'], serviceState: 'running' });
  try {
    // When
    const result = runWeb(fixture);
    const log = calls(fixture);

    // Then
    assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /did not become ready/i);
    assert.doesNotMatch(log, /termux-open-url/);
  } finally {
    removeFixture(fixture);
  }
});

test('fft web --open fails visibly when Android rejects the browser handoff', () => {
  // Given
  const fixture = createFixture({ healthCodes: ['200'], openerExit: 1, serviceState: 'running' });
  try {
    // When
    const result = runWeb(fixture);

    // Then
    assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /could not open.*Android browser/i);
    assert.match(calls(fixture), /termux-open-url http:\/\/127\.0\.0\.1:28990/);
  } finally {
    removeFixture(fixture);
  }
});

test('fft web --open does not fall back to a desktop opener when termux-open-url is unavailable', () => {
  // Given
  const fixture = createFixture({ healthCodes: ['200'], serviceState: 'running' });
  rmSync(path.join(fixture.binDir, 'termux-open-url'));
  try {
    // When
    const result = runWeb(fixture);
    const log = calls(fixture);

    // Then
    assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /termux-open-url is unavailable/i);
    assert.doesNotMatch(log, /(?:^|\n)(?:open|xdg-open) /);
  } finally {
    removeFixture(fixture);
  }
});
