#!/usr/bin/env node

import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

function printUsage() {
  process.stdout.write(`Usage:
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
`);
}

function findRepoRoot(startDir) {
  let current = path.resolve(startDir);
  while (true) {
    const pkgPath = path.join(current, 'package.json');
    const startScriptPath = path.join(current, 'scripts', 'start.sh');
    if (fs.existsSync(pkgPath) && fs.existsSync(startScriptPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        if (pkg && pkg.name === 'fft_nano') return current;
      } catch {
        // continue walking
      }
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function parseCli(argv) {
  let repoOverride = null;
  const args = [];

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--repo') {
      const next = argv[i + 1];
      if (!next) {
        throw new Error('Missing value for --repo');
      }
      repoOverride = next;
      i += 1;
      continue;
    }
    args.push(token);
  }

  return { repoOverride, args };
}

function runInRepo(repoRoot, script, args) {
  const result = spawnSync('bash', [script, ...args], {
    cwd: repoRoot,
    env: process.env,
    stdio: 'inherit',
  });

  if (result.error) {
    throw result.error;
  }
  process.exit(result.status ?? 1);
}

function main() {
  let parsed;
  try {
    parsed = parseCli(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    printUsage();
    process.exit(2);
  }

  const [command, ...commandArgs] = parsed.args;
  if (!command || command === '-h' || command === '--help' || command === 'help') {
    printUsage();
    process.exit(0);
  }

  if (!['onboard', 'profile', 'start', 'stop', 'status', 'dev', 'tui', 'web', 'service', 'doctor', 'skill-manager', 'curator', 'update', 'desktop'].includes(command)) {
    process.stderr.write(`Unknown command: ${command}\n`);
    printUsage();
    process.exit(2);
  }

  const repoRoot = parsed.repoOverride
    ? findRepoRoot(path.resolve(parsed.repoOverride))
    : findRepoRoot(process.cwd());

  if (!repoRoot) {
    process.stderr.write(
      'FFT_nano repo not found. Run inside the repo or pass --repo /absolute/path/to/FFT_nano.\n',
    );
    process.exit(2);
  }

  if (command === 'service') {
    runInRepo(repoRoot, 'scripts/service.sh', commandArgs);
    return;
  }

  if (command === 'doctor') {
    const result = spawnSync('npm', ['run', 'doctor', '--', ...commandArgs], {
      cwd: repoRoot,
      env: process.env,
      stdio: 'inherit',
    });
    if (result.error) throw result.error;
    process.exit(result.status ?? 1);
  }

  if (command === 'skill-manager') {
    const result = spawnSync('npm', ['run', 'skill-manager', '--', ...commandArgs], {
      cwd: repoRoot,
      env: process.env,
      stdio: 'inherit',
    });
    if (result.error) throw result.error;
    process.exit(result.status ?? 1);
  }

  if (command === 'curator') {
    const result = spawnSync('npm', ['run', 'curator', '--', ...commandArgs], {
      cwd: repoRoot,
      env: process.env,
      stdio: 'inherit',
    });
    if (result.error) throw result.error;
    process.exit(result.status ?? 1);
  }

  if (command === 'profile') {
    const result = spawnSync('npm', ['run', 'profile', '--', ...commandArgs], {
      cwd: repoRoot,
      env: process.env,
      stdio: 'inherit',
    });
    if (result.error) throw result.error;
    process.exit(result.status ?? 1);
  }

  if (command === 'onboard') {
    runInRepo(repoRoot, 'scripts/onboard-all.sh', commandArgs);
    return;
  }

  if (command === 'web') {
    runInRepo(repoRoot, 'scripts/web.sh', commandArgs);
    return;
  }

  if (command === 'update') {
    const result = spawnSync('node', ['dist/update-worker-cli.js', '--cwd', repoRoot], {
      cwd: repoRoot,
      env: process.env,
      stdio: 'inherit',
    });
    if (result.error) throw result.error;
    process.exit(result.status ?? 1);
    return;
  }

  if (command === 'stop') {
    const result = spawnSync('bash', [path.join(repoRoot, 'scripts/start.sh'), 'stop'], {
      cwd: repoRoot,
      env: process.env,
      stdio: 'inherit',
    });
    if (result.error) throw result.error;
    process.exit(result.status ?? 1);
    return;
  }

  if (command === 'status') {
    const lockFile = path.join(repoRoot, 'data/fft_nano.lock');
    const pidFile = path.join(repoRoot, 'data/fft_nano.pid');
    const wantJson = commandArgs.includes('--json');

    let status = {
      host: 'stopped',
      pid: null,
      port: null,
      service: 'unknown',
    };

    // Check if PID file exists
    if (fs.existsSync(pidFile)) {
      try {
        const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
        if (!isNaN(pid) && pid > 0) {
          try {
            // Check if process exists
            process.kill(pid, 0);
            status.host = 'running';
            status.pid = pid;
          } catch {
            // Process doesn't exist
          }
        }
      } catch {
        // Ignore parse errors
      }
    }

    // Try to detect port from lock file
    if (fs.existsSync(lockFile)) {
      try {
        const lockContent = fs.readFileSync(lockFile, 'utf8');
        const portMatch = lockContent.match(/port[= ]*(\d+)/i);
        if (portMatch) {
          status.port = parseInt(portMatch[1], 10);
        }
      } catch {
        // Ignore
      }
    }

    if (wantJson) {
      process.stdout.write(JSON.stringify(status, null, 2) + '\n');
    } else {
      if (status.host === 'running') {
        process.stdout.write(`FFT_nano: running (PID ${status.pid})\n`);
        if (status.port) {
          process.stdout.write(`TUI port: ${status.port}\n`);
        }
      } else {
        process.stdout.write('FFT_nano: stopped\n');
      }
    }
    return;
  }

  if (command === 'desktop') {
    // Launch desktop app
    const desktopAppDir = path.join(repoRoot, 'apps/desktop');
    if (!fs.existsSync(desktopAppDir)) {
      process.stderr.write('Desktop app not found. Run from FFT_nano source directory.\n');
      process.exit(1);
    }
    const result = spawnSync('npm', ['run', 'dev'], {
      cwd: desktopAppDir,
      env: process.env,
      stdio: 'inherit',
    });
    if (result.error) throw result.error;
    process.exit(result.status ?? 1);
    return;
  }

  runInRepo(repoRoot, 'scripts/start.sh', [command, ...commandArgs]);
}

main();
