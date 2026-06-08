import assert from 'node:assert/strict';
import { execSync, spawnSync } from 'child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const REPO_ROOT = path.join(os.tmpdir(), `fft-update-cli-test-${Date.now()}`);

/**
 * Creates a minimal git repo fixture that looks like an FFT_nano checkout.
 * Uses the real bin/fft.js dispatch so the full CLI path is exercised.
 */
function createFixtureRepo(fixturePath: string): void {
  fs.mkdirSync(fixturePath, { recursive: true });
  fs.mkdirSync(path.join(fixturePath, '.git'), { recursive: true });
  fs.mkdirSync(path.join(fixturePath, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(fixturePath, 'dist'), { recursive: true });
  fs.mkdirSync(path.join(fixturePath, 'data', 'update-notifications'), { recursive: true });

  // Minimal package.json to pass findRepoRoot
  fs.writeFileSync(
    path.join(fixturePath, 'package.json'),
    JSON.stringify({ name: 'fft_nano', version: '0.0.0' }),
  );

  // Start script
  fs.writeFileSync(
    path.join(fixturePath, 'scripts', 'start.sh'),
    '#!/bin/bash\nexit 0\n',
  );

  // Service script
  fs.writeFileSync(
    path.join(fixturePath, 'scripts', 'service.sh'),
    '#!/bin/bash\n"${@}"\n',
  );
  fs.chmodSync(path.join(fixturePath, 'scripts', 'service.sh'), 0o755);
  fs.chmodSync(path.join(fixturePath, 'scripts', 'start.sh'), 0o755);

  // Stub update-worker-cli.js that emits a canned progress sequence
  fs.writeFileSync(
    path.join(fixturePath, 'dist', 'update-worker-cli.js'),
    `
const events = [
  { phase: 'starting', label: 'update worker started', status: 'started', at: new Date().toISOString() },
  { phase: 'starting', label: 'update worker started', status: 'completed', at: new Date().toISOString(), durationMs: 10, ok: true },
  { phase: 'fetching', label: 'git fetch origin', status: 'started', at: new Date().toISOString() },
  { phase: 'fetching', label: 'git fetch origin', status: 'completed', at: new Date().toISOString(), durationMs: 800 },
  { phase: 'pulling', label: 'git pull --ff-only', status: 'started', at: new Date().toISOString() },
  { phase: 'pulling', label: 'git pull --ff-only', status: 'completed', at: new Date().toISOString(), durationMs: 1200 },
  { phase: 'installing', label: 'npm ci', status: 'started', at: new Date().toISOString() },
  { phase: 'installing', label: 'npm ci', status: 'completed', at: new Date().toISOString(), durationMs: 30000 },
  { phase: 'building', label: 'npm run build', status: 'started', at: new Date().toISOString() },
  { phase: 'building', label: 'npm run build', status: 'completed', at: new Date().toISOString(), durationMs: 60000 },
  { phase: 'restarting', label: 'service.sh restart', status: 'started', at: new Date().toISOString() },
  { phase: 'restarting', label: 'service.sh restart', status: 'completed', at: new Date().toISOString(), durationMs: 5000 },
  { phase: 'verifying', label: 'service.sh status', status: 'started', at: new Date().toISOString() },
  { phase: 'verifying', label: 'service.sh status', status: 'completed', at: new Date().toISOString(), durationMs: 500 },
  { phase: 'complete', label: 'update complete', status: 'completed', at: new Date().toISOString(), ok: true },
];

const cwdArg = process.argv.find((a, i) => process.argv[i - 1] === '--cwd');
if (!cwdArg) {
  console.error('Usage: node dist/update-worker-cli.js --cwd <repo-root>');
  process.exit(1);
}

const cwd = cwdArg;
const overallStart = Date.now();
const phaseStates = new Map();

function formatTimestamp(date) {
  const h = date.getHours().toString().padStart(2, '0');
  const m = date.getMinutes().toString().padStart(2, '0');
  const s = date.getSeconds().toString().padStart(2, '0');
  return \`\${h}:\${m}:\${s}\`;
}

function formatDuration(ms) {
  if (ms < 1000) return \`\${ms}ms\`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return \`\${seconds}s\`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return \`\${minutes}m \${remainingSeconds}s\`;
}

for (const event of events) {
  const ts = formatTimestamp(new Date(event.at));
  if (event.status === 'started') {
    phaseStates.set(event.phase, { startedAt: new Date(event.at), label: event.label });
    process.stdout.write(\`[\${ts}]  \${event.phase}  ▸ \${event.label}\\n\`);
  } else if (event.status === 'completed') {
    const duration = event.durationMs ?? 0;
    if (event.phase === 'complete') {
      const totalMs = Date.now() - overallStart;
      process.stdout.write(\`Update complete in \${formatDuration(totalMs)}.\\n\`);
    } else {
      process.stdout.write(\`✓ \${event.label} (\${formatDuration(duration)})\\n\`);
    }
  } else if (event.status === 'failed') {
    process.stdout.write(\`✗ \${event.label} — \${event.message ?? 'failed'}\\n\`);
  }
}

const totalMs = Date.now() - overallStart;
process.stdout.write(\`Update complete in \${formatDuration(totalMs)}.\\n\`);
process.exit(0);
`,
  );
}

function runUpdateCli(fixturePath: string, extraArgs: string[] = []): { stdout: string; stderr: string; status: number | null } {
  const result = spawnSync('node', ['bin/fft.js', 'update', '--repo', fixturePath, ...extraArgs], {
    cwd: path.join(process.cwd()), // always run from the actual repo root
    env: { ...process.env, FFT_NANO_UPDATE_STEP_TIMEOUT_MS: '5000' },
    encoding: 'utf8',
  });
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status,
  };
}

test.before(() => {
  fs.rmSync(REPO_ROOT, { recursive: true, force: true });
  fs.mkdirSync(REPO_ROOT, { recursive: true });
  createFixtureRepo(REPO_ROOT);
});

test.after(() => {
  fs.rmSync(REPO_ROOT, { recursive: true, force: true });
});

test('fft update — success case prints a start line and completion line per phase', () => {
  const { stdout, stderr, status } = runUpdateCli(REPO_ROOT);

  assert.equal(status, 0, `expected exit 0, got ${status}. stderr: ${stderr}`);

  // Phase start lines: [HH:MM:SS]  <phase>  ▸ <message>
  assert.match(stdout, /\[(\d{2}:\d{2}:\d{2})\]  starting  ▸ update worker started/);
  assert.match(stdout, /\[(\d{2}:\d{2}:\d{2})\]  fetching  ▸ git fetch origin/);
  assert.match(stdout, /\[(\d{2}:\d{2}:\d{2})\]  pulling  ▸ git pull --ff-only/);
  assert.match(stdout, /\[(\d{2}:\d{2}:\d{2})\]  installing  ▸ npm ci/);
  assert.match(stdout, /\[(\d{2}:\d{2}:\d{2})\]  building  ▸ npm run build/);
  assert.match(stdout, /\[(\d{2}:\d{2}:\d{2})\]  restarting  ▸ service.sh restart/);
  assert.match(stdout, /\[(\d{2}:\d{2}:\d{2})\]  verifying  ▸ service.sh status/);

  // Phase completion lines: ✓ <label> (<durationMs>)
  assert.match(stdout, /✓ update worker started/);
  assert.match(stdout, /✓ git fetch origin/);
  assert.match(stdout, /✓ git pull --ff-only/);
  assert.match(stdout, /✓ npm ci/);
  assert.match(stdout, /✓ npm run build/);
  assert.match(stdout, /✓ service.sh restart/);
  assert.match(stdout, /✓ service.sh status/);

  // Final line
  assert.match(stdout, /Update complete in (\d+ms|\d+(\.\d+)?s|(\d+m )?\d+s)\./);
});

test('fft update — success case exits 0', () => {
  const { status } = runUpdateCli(REPO_ROOT);
  assert.equal(status, 0);
});

test('fft update — --repo option works', () => {
  // --repo is handled by parseCli before the command is dispatched,
  // so this just verifies the fixture path is accepted without a "repo not found" error
  const { stdout, stderr, status } = runUpdateCli(REPO_ROOT);
  assert.equal(status, 0, `expected exit 0, got ${status}. stderr: ${stderr}`);
  assert.ok(!stdout.includes('not found') && !stderr.includes('not found'));
});

test('fft update — help text lists update command', () => {
  const result = spawnSync('node', ['bin/fft.js', '--help'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  const stdout = result.stdout ?? '';
  assert.match(stdout, /fft update/);
});
