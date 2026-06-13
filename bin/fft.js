#!/usr/bin/env node

import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

// Get the directory of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Dynamically import the platform adapter from src/platform
// This is a Node.js CLI script, so we use dynamic import for ESM
async function getPlatformAdapter() {
  const platformPath = path.resolve(__dirname, '..', 'dist', 'platform', 'index.js');
  const module = await import(`file://${platformPath}`);
  return module.getPlatformAdapter();
}

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

/**
 * Parse FFT_NANO_READY port=<N> from host stdout
 */
function parseReadyPort(stdout) {
  const match = stdout.match(/FFT_NANO_READY\s+port=(\d+)/i);
  if (match) {
    return parseInt(match[1], 10);
  }
  return null;
}

/**
 * Read lock file and return all fields
 * @returns {{ pid: number|null, port: number|null, hostname: string, startedAt: string }|null}
 */
function readPidFromLock(lockFile) {
  try {
    if (fs.existsSync(lockFile)) {
      const content = fs.readFileSync(lockFile, 'utf8');
      const data = JSON.parse(content);
      return {
        pid: data.pid || null,
        port: data.port || null,
        hostname: data.hostname || os.hostname(),
        startedAt: data.startedAt || null,
      };
    }
  } catch {
    // Ignore parse errors
  }
  return null;
}

/**
 * Write PID and port to lock file
 */
function writePidToLock(lockFile, pid, port) {
  const data = {
    pid,
    port,
    hostname: os.hostname(),
    startedAt: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  fs.writeFileSync(lockFile, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

/**
 * Check if a process is running by PID
 */
function isProcessRunning(pid) {
  if (!pid || !Number.isFinite(pid) || pid <= 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function main() {
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

  // Handle service commands with platformAdapter
  if (command === 'service') {
    const [serviceAction, ...serviceActionArgs] = commandArgs;
    const platformAdapter = await getPlatformAdapter();

    try {
      switch (serviceAction) {
        case 'install': {
          await platformAdapter.installService();
          process.stdout.write('Service installed successfully.\n');
          break;
        }
        case 'uninstall': {
          await platformAdapter.uninstallService();
          process.stdout.write('Service uninstalled successfully.\n');
          break;
        }
        case 'start': {
          await platformAdapter.startService();
          process.stdout.write('Service started successfully.\n');
          break;
        }
        case 'stop': {
          await platformAdapter.stopService();
          process.stdout.write('Service stopped successfully.\n');
          break;
        }
        case 'restart': {
          await platformAdapter.restartService();
          process.stdout.write('Service restarted successfully.\n');
          break;
        }
        case 'status': {
          const serviceStatus = await platformAdapter.getServiceStatus();
          process.stdout.write(`Service status: ${serviceStatus}\n`);
          break;
        }
        case 'logs': {
          const logs = await platformAdapter.getServiceLogs();
          process.stdout.write(logs + '\n');
          break;
        }
        default: {
          process.stderr.write(`Unknown service action: ${serviceAction}\n`);
          process.stderr.write('Valid actions: install, uninstall, start, stop, restart, status, logs\n');
          process.exit(2);
        }
      }
    } catch (err) {
      process.stderr.write(`Service command failed: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    }
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
    return;
  }

  if (command === 'skill-manager') {
    const result = spawnSync('npm', ['run', 'skill-manager', '--', ...commandArgs], {
      cwd: repoRoot,
      env: process.env,
      stdio: 'inherit',
    });
    if (result.error) throw result.error;
    process.exit(result.status ?? 1);
    return;
  }

  if (command === 'curator') {
    const result = spawnSync('npm', ['run', 'curator', '--', ...commandArgs], {
      cwd: repoRoot,
      env: process.env,
      stdio: 'inherit',
    });
    if (result.error) throw result.error;
    process.exit(result.status ?? 1);
    return;
  }

  if (command === 'profile') {
    const result = spawnSync('npm', ['run', 'profile', '--', ...commandArgs], {
      cwd: repoRoot,
      env: process.env,
      stdio: 'inherit',
    });
    if (result.error) throw result.error;
    process.exit(result.status ?? 1);
    return;
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
    const platformAdapter = await getPlatformAdapter();
    const lockFile = path.join(repoRoot, 'data/fft_nano.lock');

    // Read PID from lock file
    const pid = readPidFromLock(lockFile);

    if (!pid) {
      process.stderr.write('No PID found in lock file. Is FFT_nano running?\n');
      process.exit(1);
    }

    // Check if process is running
    if (!isProcessRunning(pid)) {
      process.stdout.write('FFT_nano is not running (stale lock file).\n');
      // Remove stale lock file
      try {
        fs.unlinkSync(lockFile);
      } catch {
        // Ignore
      }
      process.exit(0);
    }

    // Try graceful shutdown first
    const killed = platformAdapter.killProcessGroup(pid, 'SIGTERM');

    if (!killed) {
      // Try SIGKILL as fallback
      platformAdapter.killProcessGroup(pid, 'SIGKILL');
    }

    // Remove lock file
    try {
      fs.unlinkSync(lockFile);
    } catch {
      // Ignore
    }

    process.stdout.write('FFT_nano stopped.\n');
    process.exit(0);
  }

  if (command === 'status') {
    const platformAdapter = await getPlatformAdapter();
    const lockFile = path.join(repoRoot, 'data/fft_nano.lock');
    const wantJson = commandArgs.includes('--json');

    let status = {
      host: 'stopped',
      pid: null,
      port: null,
      service: 'unknown',
    };

    // Get service status from platform adapter
    try {
      const serviceStatus = await platformAdapter.getServiceStatus();
      status.service = serviceStatus;
    } catch {
      // Ignore service status errors
    }

    // Read lock file data
    const lockData = readPidFromLock(lockFile);
    const defaultPort = parseInt(process.env.FFT_NANO_TUI_PORT || '28989', 10);

    if (lockData && lockData.pid && isProcessRunning(lockData.pid)) {
      status.host = 'running';
      status.pid = lockData.pid;
      // Use port from lock file if available, otherwise use default
      status.port = lockData.port || defaultPort;
    } else {
      status.port = defaultPort;
    }

    if (wantJson) {
      process.stdout.write(JSON.stringify(status, null, 2) + '\n');
    } else {
      if (status.host === 'running') {
        process.stdout.write(`FFT_nano: running (PID ${status.pid})\n`);
        process.stdout.write(`TUI port: ${status.port}\n`);
      } else {
        process.stdout.write('FFT_nano: stopped\n');
      }
      process.stdout.write(`Service: ${status.service}\n`);
    }
    return;
  }

  if (command === 'start') {
    const platformAdapter = await getPlatformAdapter();
    const lockFile = path.join(repoRoot, 'data/fft_nano.lock');

    // Check if already running
    const existingPid = readPidFromLock(lockFile);
    if (existingPid && isProcessRunning(existingPid)) {
      process.stderr.write(`FFT_nano is already running (PID ${existingPid}).\n`);
      process.stderr.write('Use "fft stop" first, or "fft restart" to restart.\n');
      process.exit(1);
    }

    // Clean up stale lock file if exists
    if (fs.existsSync(lockFile)) {
      try {
        fs.unlinkSync(lockFile);
      } catch {
        // Ignore
      }
    }

    // Spawn the host process
    const hostExe = process.execPath;
    const hostScript = path.join(repoRoot, 'dist/index.js');

    // Build environment with telegram-only if requested
    const env = { ...process.env };
    if (commandArgs.includes('telegram-only')) {
      env.WHATSAPP_ENABLED = '0';
    }

    process.stdout.write('Starting FFT_nano...\n');

    // Spawn detached process
    const child = spawn(hostExe, [hostScript], {
      cwd: repoRoot,
      env,
      detached: false, // We manage the process directly
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdoutData = '';
    let stderrData = '';

    child.stdout.on('data', (data) => {
      const chunk = data.toString();
      stdoutData += chunk;
      process.stdout.write(chunk);
    });

    child.stderr.on('data', (data) => {
      const chunk = data.toString();
      stderrData += chunk;
      process.stderr.write(chunk);
    });

    // Wait for FFT_NANO_READY or process exit
    const timeoutMs = 30000; // 30 seconds
    const startTime = Date.now();

    await new Promise((resolve, reject) => {
      const checkReady = () => {
        const port = parseReadyPort(stdoutData);
        if (port) {
          // Host is ready, write PID and port to lock file
          writePidToLock(lockFile, child.pid, port);
          process.stdout.write(`FFT_nano started (PID ${child.pid}) and ready on port ${port}\n`);
          resolve(undefined);
          return true;
        }
        return false;
      };

      // Check if process exited unexpectedly
      child.on('exit', (code, signal) => {
        if (code !== 0 && code !== null) {
          reject(new Error(`FFT_nano exited with code ${code}`));
        } else if (signal) {
          reject(new Error(`FFT_nano was killed by signal ${signal}`));
        }
      });

      // Poll for ready signal
      const interval = setInterval(() => {
        if (checkReady()) {
          clearInterval(interval);
          return;
        }
        if (Date.now() - startTime > timeoutMs) {
          clearInterval(interval);
          // Timeout but process might still be running - try to get PID and port
          if (child.pid) {
            const port = parseReadyPort(stdoutData) || parseInt(process.env.FFT_NANO_TUI_PORT || '28989', 10);
            writePidToLock(lockFile, child.pid, port);
            process.stdout.write(`FFT_nano started (PID ${child.pid}) - ready signal timeout\n`);
          }
          resolve(undefined);
        }
      }, 100);
    });

    // Detach the child - it now runs independently
    child.unref();
    process.exit(0);
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
