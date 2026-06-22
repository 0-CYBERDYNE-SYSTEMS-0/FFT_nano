import fs from 'fs';
import path from 'path';
import { spawn, spawnSync } from 'child_process';

function resolveProjectDir(): string {
  const argv1 = process.argv[1] || '';
  const abs = path.resolve(argv1);
  if (abs.includes(`${path.sep}src${path.sep}tui${path.sep}start.ts`)) {
    return path.resolve(path.dirname(abs), '..', '..');
  }
  if (abs.includes(`${path.sep}dist${path.sep}tui${path.sep}start.js`)) {
    return path.resolve(path.dirname(abs), '..', '..');
  }
  return process.cwd();
}

function readLockPid(lockFile: string): number | null {
  try {
    const raw = fs.readFileSync(lockFile, 'utf8');
    const data = JSON.parse(raw) as { pid?: number };
    return typeof data.pid === 'number' ? data.pid : null;
  } catch {
    return null;
  }
}

function isPidAlive(pid: number | null): boolean {
  if (!pid || !Number.isFinite(pid) || pid <= 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function waitForHostReady(webUrl: string, timeoutSeconds: number): boolean {
  const start = Date.now();
  const deadline = start + timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    try {
      const res = spawnSync(
        'curl',
        ['-sS', '-o', '/dev/null', '--max-time', '2', `${webUrl}/api/health`],
        { stdio: 'ignore' },
      );
      if (res.status === 0) return true;
    } catch {
      // ignore
    }
    sleepMs(500);
  }
  return false;
}

function sleepMs(ms: number): void {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    /* spin briefly */
  }
}

function openBrowser(url: string): void {
  if (process.env.FFT_NANO_NO_BROWSER === '1') return;
  try {
    if (process.platform === 'darwin') {
      spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
    } else if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', url], {
        stdio: 'ignore',
        detached: true,
      }).unref();
    } else {
      const cmd = spawn('xdg-open', [url], {
        stdio: 'ignore',
        detached: true,
      });
      cmd.unref();
    }
  } catch {
    // best-effort
  }
}

function ensureHostRunning(projectDir: string): boolean {
  const lockFile = path.join(projectDir, 'data', 'fft_nano.lock');
  const existing = readLockPid(lockFile);
  if (isPidAlive(existing)) {
    process.stdout.write(`FFT_nano host already running (PID ${existing}).\n`);
    return true;
  }
  if (fs.existsSync(lockFile)) {
    try {
      fs.unlinkSync(lockFile);
    } catch {
      /* best effort */
    }
  }

  const webHost = process.env.FFT_NANO_WEB_HOST || '127.0.0.1';
  const webPort = process.env.FFT_NANO_WEB_PORT || '28990';
  const webUrl =
    webHost === '0.0.0.0' || webHost === '::'
      ? `http://127.0.0.1:${webPort}`
      : `http://${webHost}:${webPort}`;

  process.stdout.write('Starting FFT_nano host in the background...\n');
  const hostExe = process.execPath;
  const hostScript = path.join(projectDir, 'dist', 'index.js');
  const child = spawn(hostExe, [hostScript], {
    cwd: projectDir,
    env: process.env,
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  const timeoutSeconds = Number(
    process.env.FFT_NANO_READY_TIMEOUT_SECONDS || '30',
  );
  if (waitForHostReady(webUrl, timeoutSeconds)) {
    process.stdout.write('FFT_nano host is ready.\n');
    return true;
  }
  process.stderr.write(
    `ERROR: FFT_nano host did not become ready within ${timeoutSeconds}s.\n`,
  );
  return false;
}

function maybeOpenWebui(): void {
  if (process.env.FFT_NANO_NO_BROWSER === '1') return;
  if (process.env.FFT_NANO_WEB_ENABLED === '0') return;
  if (process.argv.includes('--no-open')) return;
  const webHost = process.env.FFT_NANO_WEB_HOST || '127.0.0.1';
  const webPort = process.env.FFT_NANO_WEB_PORT || '28990';
  const url =
    webHost === '0.0.0.0' || webHost === '::'
      ? `http://127.0.0.1:${webPort}`
      : `http://${webHost}:${webPort}`;
  process.stdout.write(`Opening web control center: ${url}\n`);
  openBrowser(url);
}

async function main(): Promise<void> {
  const projectDir = resolveProjectDir();
  const argv1 = process.argv[1] || '';
  const isDevTs = argv1.endsWith('.ts') || argv1.endsWith('.tsx');

  const localTsx = path.join(
    projectDir,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'tsx.cmd' : 'tsx',
  );
  const tsxCmd = fs.existsSync(localTsx) ? localTsx : 'tsx';

  // When invoked as the tui entry, ensure the host is up and the webui is
  // open. `fft tui:client` (the raw client) skips this and just attaches.
  const isEntrypoint =
    import.meta.url === `file://${process.argv[1]}` ||
    process.argv[1]?.endsWith('tui/start.js') ||
    process.argv[1]?.endsWith('tui/start.ts');
  if (isEntrypoint) {
    ensureHostRunning(projectDir);
    maybeOpenWebui();
  }

  const clientCmd = isDevTs ? tsxCmd : process.execPath;
  const clientArgs = isDevTs
    ? ['src/tui/client.ts', ...process.argv.slice(2)]
    : ['dist/tui/client.js', ...process.argv.slice(2)];

  const clientEnv = {
    ...process.env,
    FFT_NANO_TUI_LOCAL: process.env.FFT_NANO_TUI_LOCAL || '0',
  };

  const client = spawn(clientCmd, clientArgs, {
    cwd: projectDir,
    env: clientEnv,
    stdio: 'inherit',
  });

  client.on('exit', (code) => {
    process.exit(code || 0);
  });

  client.on('error', (err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
