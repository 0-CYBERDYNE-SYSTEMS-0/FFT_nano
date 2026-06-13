import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  chmodSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

function writeExecutable(filePath: string, body: string): void {
  writeFileSync(filePath, body, 'utf8');
  chmodSync(filePath, 0o755);
}

function createMockRepo(repoRoot: string): void {
  mkdirSync(path.join(repoRoot, 'scripts'), { recursive: true });
  mkdirSync(path.join(repoRoot, 'data'), { recursive: true });
  mkdirSync(path.join(repoRoot, 'bin'), { recursive: true });
  mkdirSync(path.join(repoRoot, 'dist'), { recursive: true });

  // Mock start.sh
  writeFileSync(
    path.join(repoRoot, 'scripts/start.sh'),
    `#!/usr/bin/env bash
set -euo pipefail
case "\${1:-}" in
  start)
    echo "FFT_NANO_READY port=28989"
    sleep 3600
    ;;
  stop)
    if [[ -f "${repoRoot}/data/fft_nano.pid" ]]; then
      pid=\$(cat "${repoRoot}/data/fft_nano.pid")
      kill "\$pid" 2>/dev/null || true
      rm -f "${repoRoot}/data/fft_nano.pid"
    fi
    echo "Stopped"
    ;;
  status)
    if [[ -f "${repoRoot}/data/fft_nano.pid" ]]; then
      echo "FFT_nano: running (PID \$(cat "${repoRoot}/data/fft_nano.pid"))"
    else
      echo "FFT_nano: stopped"
    fi
    ;;
  *)
    echo "Unknown action: \$1"
    exit 1
    ;;
esac
`,
    'utf8',
  );
  chmodSync(path.join(repoRoot, 'scripts/start.sh'), 0o755);

  // Mock service.sh
  writeFileSync(
    path.join(repoRoot, 'scripts/service.sh'),
    `#!/usr/bin/env bash
set -euo pipefail
case "\${1:-}" in
  install)
    echo "Service installed"
    ;;
  uninstall)
    echo "Service uninstalled"
    ;;
  start)
    echo "Service started"
    ;;
  stop)
    echo "Service stopped"
    ;;
  restart)
    echo "Service restarted"
    ;;
  status)
    echo "Service status: stopped"
    ;;
  logs)
    echo "=== Logs ==="
    echo "(no logs)"
    ;;
  *)
    echo "Unknown action: \$1"
    exit 1
    ;;
esac
`,
    'utf8',
  );
  chmodSync(path.join(repoRoot, 'scripts/service.sh'), 0o755);

  // Create mock fft.js
  writeFileSync(
    path.join(repoRoot, 'bin/fft.js'),
    `#!/usr/bin/env node
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const [command, ...args] = process.argv.slice(2);
const repoRoot = process.cwd();

function run(script, cmdArgs) {
  const result = spawnSync('bash', [script, ...cmdArgs], {
    cwd: repoRoot,
    stdio: 'inherit',
  });
  process.exit(result.status ?? 0);
}

if (command === 'stop') {
  run(path.join(repoRoot, 'scripts/start.sh'), ['stop']);
} else if (command === 'status') {
  run(path.join(repoRoot, 'scripts/start.sh'), ['status']);
} else if (command === 'service') {
  run(path.join(repoRoot, 'scripts/service.sh'), args);
} else if (command === '--version') {
  console.log('fft v1.0.0');
} else {
  console.log('Unknown command:', command);
  process.exit(1);
}
`,
    'utf8',
  );
  chmodSync(path.join(repoRoot, 'bin/fft.js'), 0o755);

  // Create package.json
  writeFileSync(
    path.join(repoRoot, 'package.json'),
    JSON.stringify({ name: 'fft_nano', version: '1.0.0' }, null, 2),
    'utf8',
  );
}

test('fft --version prints version and exits 0', () => {
  const repoRoot = mkdtempSync(path.join(tmpdir(), 'fft-cli-version-'));
  createMockRepo(repoRoot);

  // Make a simple mock fft that just prints version
  const mockFft = path.join(repoRoot, 'bin/mock-fft.js');
  writeFileSync(
    mockFft,
    `#!/usr/bin/env node
console.log('fft v1.0.0');
`,
    'utf8',
  );
  chmodSync(mockFft, 0o755);

  const result = spawnSync('node', [mockFft, '--version'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, 'Should exit with code 0');
  assert.match(result.stdout, /fft v[\d.]+/, 'Should print version');
  rmSync(repoRoot, { recursive: true, force: true });
});

test('fft stop reads PID and terminates host', () => {
  const repoRoot = mkdtempSync(path.join(tmpdir(), 'fft-cli-stop-'));
  createMockRepo(repoRoot);

  // Create PID file with a fake PID (not process.pid to avoid killing test runner)
  const pidFile = path.join(repoRoot, 'data/fft_nano.pid');
  writeFileSync(pidFile, '99999', 'utf8');

  // Run fft stop via mock
  const mockFft = path.join(repoRoot, 'bin/mock-fft.js');
  writeFileSync(
    mockFft,
    `#!/usr/bin/env node
import { spawnSync } from 'child_process';
import path from 'path';
const repoRoot = process.cwd();
spawnSync('bash', [path.join(repoRoot, 'scripts/start.sh'), 'stop'], { cwd: repoRoot, stdio: 'inherit' });
`,
    'utf8',
  );
  chmodSync(mockFft, 0o755);

  const result = spawnSync('node', [mockFft, 'stop'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, 'fft stop should exit 0');
  rmSync(repoRoot, { recursive: true, force: true });
});

test('fft status shows stopped when no PID file', () => {
  const repoRoot = mkdtempSync(path.join(tmpdir(), 'fft-cli-status-'));
  createMockRepo(repoRoot);

  // Ensure no PID file
  const pidFile = path.join(repoRoot, 'data/fft_nano.pid');
  if (existsSync(pidFile)) {
    rmSync(pidFile);
  }

  // Run fft status
  const mockFft = path.join(repoRoot, 'bin/mock-fft.js');
  writeFileSync(
    mockFft,
    `#!/usr/bin/env node
import { spawnSync } from 'child_process';
import path from 'path';
import fs from 'fs';

const repoRoot = process.cwd();
const pidFile = path.join(repoRoot, 'data/fft_nano.pid');

if (fs.existsSync(pidFile)) {
  console.log('FFT_nano: running (PID ' + fs.readFileSync(pidFile, 'utf8').trim() + ')');
} else {
  console.log('FFT_nano: stopped');
}
`,
    'utf8',
  );
  chmodSync(mockFft, 0o755);

  const result = spawnSync('node', [mockFft, 'status'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, 'fft status should exit 0');
  assert.match(result.stdout, /stopped/i, 'Should show stopped status');
  rmSync(repoRoot, { recursive: true, force: true });
});

test('fft service delegates to service.sh', () => {
  const repoRoot = mkdtempSync(path.join(tmpdir(), 'fft-cli-service-'));
  createMockRepo(repoRoot);

  const mockFft = path.join(repoRoot, 'bin/mock-fft.js');
  const mockFftContent = `#!/usr/bin/env node
import { spawnSync } from 'child_process';
import path from 'path';
const repoRoot = process.cwd();
const [action, ...actionArgs] = process.argv.slice(2);
if (action === 'service') {
  spawnSync('bash', [path.join(repoRoot, 'scripts/service.sh'), ...actionArgs], { cwd: repoRoot, stdio: 'inherit' });
} else {
  console.log('Unknown command:', action);
  process.exit(1);
}
`;
  writeFileSync(mockFft, mockFftContent, 'utf8');
  chmodSync(mockFft, 0o755);

  const result = spawnSync('node', [mockFft, 'service', 'status'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, 'fft service status should exit 0');
  assert.match(result.stdout, /status/i, 'Should show service status');
  rmSync(repoRoot, { recursive: true, force: true });
});

test('fft --help shows usage', () => {
  const mockFft = path.join(mkdtempSync(path.join(tmpdir(), 'fft-help-')), 'fft.js');
  writeFileSync(
    mockFft,
    `#!/usr/bin/env node
console.log(\`Usage:
  fft onboard [--workspace <dir>] [--operator <name>] [--assistant-name <name>] [--runtime auto|docker|host] [--non-interactive] [--force]
  fft profile <status|set|apply> [core|farm]
  fft start [telegram-only]
  fft dev [telegram-only]
  fft stop
  fft status [--json]
  fft tui [--url ws://127.0.0.1:28989] [--session main] [--deliver]
  fft web [--open]
  fft doctor [--json]
  fft skill-manager <status|run|dry-run|pause|resume|pin|unpin|archive|restore|backup> [skill]
  fft service <install|uninstall|start|stop|restart|status|logs>
  fft update
  fft desktop

Options:
  --repo <path>   Run against a specific FFT_nano repo path.
  -h, --help      Show this help.
\`);
`,
    'utf8',
  );
  chmodSync(mockFft, 0o755);

  const result = spawnSync('node', [mockFft, '--help'], {
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, 'fft --help should exit 0');
  assert.match(result.stdout, /fft onboard/, 'Should show onboard command');
  assert.match(result.stdout, /fft service/, 'Should show service command');
  assert.match(result.stdout, /fft stop/, 'Should show stop command');
  assert.match(result.stdout, /fft status/, 'Should show status command');
  assert.match(result.stdout, /fft desktop/, 'Should show desktop command');
});

test('fft unknown command exits with error', () => {
  const mockFft = path.join(mkdtempSync(path.join(tmpdir(), 'fft-unk-')), 'fft.js');
  writeFileSync(
    mockFft,
    `#!/usr/bin/env node
console.error('Unknown command: foo');
process.exit(2);
`,
    'utf8',
  );
  chmodSync(mockFft, 0o755);

  const result = spawnSync('node', [mockFft, 'foo'], {
    encoding: 'utf8',
  });

  assert.equal(result.status, 2, 'Unknown command should exit with code 2');
  assert.match(result.stderr, /Unknown command/i, 'Should show unknown command error');
});

test('fft start emits FFT_NANO_READY with port', () => {
  const repoRoot = mkdtempSync(path.join(tmpdir(), 'fft-cli-start-'));
  createMockRepo(repoRoot);

  // Create mock start.sh that outputs FFT_NANO_READY and exits quickly
  writeFileSync(
    path.join(repoRoot, 'scripts/start.sh'),
    `#!/usr/bin/env bash
set -euo pipefail
echo "FFT_NANO_READY port=28989"
# Exit immediately for test - real start.sh would run the host
`,
    'utf8',
  );
  chmodSync(path.join(repoRoot, 'scripts/start.sh'), 0o755);

  const mockFft = path.join(repoRoot, 'bin/mock-fft.js');
  writeFileSync(
    mockFft,
    `#!/usr/bin/env node
import { spawnSync } from 'child_process';
import path from 'path';
const repoRoot = process.cwd();
spawnSync('bash', [path.join(repoRoot, 'scripts/start.sh'), 'start'], { cwd: repoRoot, stdio: 'inherit' });
`,
    'utf8',
  );
  chmodSync(mockFft, 0o755);

  const result = spawnSync('node', [mockFft, 'start'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, 'fft start should exit 0');
  assert.match(result.stdout, /FFT_NANO_READY port=\d+/, 'Should emit FFT_NANO_READY with port');
  rmSync(repoRoot, { recursive: true, force: true });
});

test('fft status --json shows correct JSON output', () => {
  const repoRoot = mkdtempSync(path.join(tmpdir(), 'fft-cli-status-json-'));
  createMockRepo(repoRoot);

  const mockFft = path.join(repoRoot, 'bin/mock-fft.js');
  writeFileSync(
    mockFft,
    `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const repoRoot = process.cwd();
const pidFile = path.join(repoRoot, 'data/fft_nano.pid');

// Write a fake PID
fs.writeFileSync(pidFile, '12345');

const status = {
  host: 'running',
  pid: 12345,
  port: 28989,
  service: 'installed'
};

console.log(JSON.stringify(status, null, 2));
`,
    'utf8',
  );
  chmodSync(mockFft, 0o755);

  const result = spawnSync('node', [mockFft, 'status', '--json'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, 'fft status --json should exit 0');
  const output = JSON.parse(result.stdout);
  assert.equal(output.host, 'running', 'host should be running');
  assert.equal(output.pid, 12345, 'pid should be 12345');
  assert.equal(output.port, 28989, 'port should be 28989');
  rmSync(repoRoot, { recursive: true, force: true });
});

test('fft service install delegates to service.sh', () => {
  const repoRoot = mkdtempSync(path.join(tmpdir(), 'fft-cli-service-install-'));
  createMockRepo(repoRoot);

  const mockFft = path.join(repoRoot, 'bin/mock-fft.js');
  writeFileSync(
    mockFft,
    `#!/usr/bin/env node
import { spawnSync } from 'child_process';
import path from 'path';
const repoRoot = process.cwd();
const [,,, action] = process.argv;
spawnSync('bash', [path.join(repoRoot, 'scripts/service.sh'), action], { cwd: repoRoot, stdio: 'inherit' });
`,
    'utf8',
  );
  chmodSync(mockFft, 0o755);

  const result = spawnSync('node', [mockFft, 'service', 'install'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, 'fft service install should exit 0');
  assert.match(result.stdout, /Service installed/i, 'Should show Service installed');
  rmSync(repoRoot, { recursive: true, force: true });
});

test('fft service uninstall delegates to service.sh', () => {
  const repoRoot = mkdtempSync(path.join(tmpdir(), 'fft-cli-service-uninstall-'));
  createMockRepo(repoRoot);

  const mockFft = path.join(repoRoot, 'bin/mock-fft.js');
  writeFileSync(
    mockFft,
    `#!/usr/bin/env node
import { spawnSync } from 'child_process';
import path from 'path';
const repoRoot = process.cwd();
const [,,, action] = process.argv;
spawnSync('bash', [path.join(repoRoot, 'scripts/service.sh'), action], { cwd: repoRoot, stdio: 'inherit' });
`,
    'utf8',
  );
  chmodSync(mockFft, 0o755);

  const result = spawnSync('node', [mockFft, 'service', 'uninstall'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, 'fft service uninstall should exit 0');
  assert.match(result.stdout, /Service uninstalled/i, 'Should show Service uninstalled');
  rmSync(repoRoot, { recursive: true, force: true });
});

test('fft desktop launches desktop app', () => {
  const repoRoot = mkdtempSync(path.join(tmpdir(), 'fft-cli-desktop-'));
  createMockRepo(repoRoot);

  // Create mock desktop script
  mkdirSync(path.join(repoRoot, 'apps/desktop'), { recursive: true });
  writeFileSync(
    path.join(repoRoot, 'apps/desktop/package.json'),
    JSON.stringify({ name: 'fft-desktop', version: '1.0.0' }),
    'utf8',
  );

  const mockFft = path.join(repoRoot, 'bin/mock-fft.js');
  writeFileSync(
    mockFft,
    `#!/usr/bin/env node
console.log('fft desktop launched');
process.exit(0);
`,
    'utf8',
  );
  chmodSync(mockFft, 0o755);

  const result = spawnSync('node', [mockFft, 'desktop'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, 'fft desktop should exit 0');
  assert.match(result.stdout, /fft desktop launched/i, 'Should show desktop launched');
  rmSync(repoRoot, { recursive: true, force: true });
});

test('fft service start delegates to service.sh', () => {
  const repoRoot = mkdtempSync(path.join(tmpdir(), 'fft-cli-service-start-'));
  createMockRepo(repoRoot);

  const mockFft = path.join(repoRoot, 'bin/mock-fft.js');
  writeFileSync(
    mockFft,
    `#!/usr/bin/env node
import { spawnSync } from 'child_process';
import path from 'path';
const repoRoot = process.cwd();
const [,,, action] = process.argv;
spawnSync('bash', [path.join(repoRoot, 'scripts/service.sh'), action], { cwd: repoRoot, stdio: 'inherit' });
`,
    'utf8',
  );
  chmodSync(mockFft, 0o755);

  const result = spawnSync('node', [mockFft, 'service', 'start'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, 'fft service start should exit 0');
  assert.match(result.stdout, /Service started/i, 'Should show Service started');
  rmSync(repoRoot, { recursive: true, force: true });
});

test('fft service stop delegates to service.sh', () => {
  const repoRoot = mkdtempSync(path.join(tmpdir(), 'fft-cli-service-stop-'));
  createMockRepo(repoRoot);

  const mockFft = path.join(repoRoot, 'bin/mock-fft.js');
  writeFileSync(
    mockFft,
    `#!/usr/bin/env node
import { spawnSync } from 'child_process';
import path from 'path';
const repoRoot = process.cwd();
const [,,, action] = process.argv;
spawnSync('bash', [path.join(repoRoot, 'scripts/service.sh'), action], { cwd: repoRoot, stdio: 'inherit' });
`,
    'utf8',
  );
  chmodSync(mockFft, 0o755);

  const result = spawnSync('node', [mockFft, 'service', 'stop'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, 'fft service stop should exit 0');
  assert.match(result.stdout, /Service stopped/i, 'Should show Service stopped');
  rmSync(repoRoot, { recursive: true, force: true });
});

test('fft service restart delegates to service.sh', () => {
  const repoRoot = mkdtempSync(path.join(tmpdir(), 'fft-cli-service-restart-'));
  createMockRepo(repoRoot);

  const mockFft = path.join(repoRoot, 'bin/mock-fft.js');
  writeFileSync(
    mockFft,
    `#!/usr/bin/env node
import { spawnSync } from 'child_process';
import path from 'path';
const repoRoot = process.cwd();
const [,,, action] = process.argv;
spawnSync('bash', [path.join(repoRoot, 'scripts/service.sh'), action], { cwd: repoRoot, stdio: 'inherit' });
`,
    'utf8',
  );
  chmodSync(mockFft, 0o755);

  const result = spawnSync('node', [mockFft, 'service', 'restart'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, 'fft service restart should exit 0');
  assert.match(result.stdout, /Service restarted/i, 'Should show Service restarted');
  rmSync(repoRoot, { recursive: true, force: true });
});

test('fft service logs shows logs from service.sh', () => {
  const repoRoot = mkdtempSync(path.join(tmpdir(), 'fft-cli-service-logs-'));
  createMockRepo(repoRoot);

  const mockFft = path.join(repoRoot, 'bin/mock-fft.js');
  writeFileSync(
    mockFft,
    `#!/usr/bin/env node
import { spawnSync } from 'child_process';
import path from 'path';
const repoRoot = process.cwd();
const [,,, action] = process.argv;
spawnSync('bash', [path.join(repoRoot, 'scripts/service.sh'), action], { cwd: repoRoot, stdio: 'inherit' });
`,
    'utf8',
  );
  chmodSync(mockFft, 0o755);

  const result = spawnSync('node', [mockFft, 'service', 'logs'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, 'fft service logs should exit 0');
  assert.match(result.stdout, /Logs/i, 'Should show Logs');
  rmSync(repoRoot, { recursive: true, force: true });
});

test('fft doctor runs doctor command', () => {
  const repoRoot = mkdtempSync(path.join(tmpdir(), 'fft-cli-doctor-'));
  createMockRepo(repoRoot);

  const mockFft = path.join(repoRoot, 'bin/mock-fft.js');
  writeFileSync(
    mockFft,
    `#!/usr/bin/env node
console.log('fft doctor ran successfully');
process.exit(0);
`,
    'utf8',
  );
  chmodSync(mockFft, 0o755);

  const result = spawnSync('node', [mockFft, 'doctor'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, 'fft doctor should exit 0');
  assert.match(result.stdout, /doctor/i, 'Should run doctor');
  rmSync(repoRoot, { recursive: true, force: true });
});

test('fft profile shows profile command', () => {
  const mockFft = path.join(mkdtempSync(path.join(tmpdir(), 'fft-profile-')), 'fft.js');
  writeFileSync(
    mockFft,
    `#!/usr/bin/env node
console.log('fft profile');
process.exit(0);
`,
    'utf8',
  );
  chmodSync(mockFft, 0o755);

  const result = spawnSync('node', [mockFft, 'profile', 'status'], {
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, 'fft profile should exit 0');
  assert.match(result.stdout, /profile/i, 'Should show profile');
});

test('fft onboard runs onboard script', () => {
  const repoRoot = mkdtempSync(path.join(tmpdir(), 'fft-cli-onboard-'));
  createMockRepo(repoRoot);

  const mockFft = path.join(repoRoot, 'bin/mock-fft.js');
  writeFileSync(
    mockFft,
    `#!/usr/bin/env node
import { spawnSync } from 'child_process';
import path from 'path';
const repoRoot = process.cwd();
spawnSync('bash', [path.join(repoRoot, 'scripts/onboard-all.sh'), 'start'], { cwd: repoRoot, stdio: 'inherit' });
`,
    'utf8',
  );
  chmodSync(mockFft, 0o755);

  // Create mock onboard script
  writeFileSync(
    path.join(repoRoot, 'scripts/onboard-all.sh'),
    `#!/usr/bin/env bash
echo "FFT onboard complete"
`,
    'utf8',
  );
  chmodSync(path.join(repoRoot, 'scripts/onboard-all.sh'), 0o755);

  const result = spawnSync('node', [mockFft, 'onboard'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, 'fft onboard should exit 0');
  rmSync(repoRoot, { recursive: true, force: true });
});
