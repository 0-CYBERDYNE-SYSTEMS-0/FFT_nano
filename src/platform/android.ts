import { exec, spawn } from 'child_process';
import {
  existsSync,
  unlinkSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from 'fs';
import { createServer, Server, Socket } from 'net';
import { promisify } from 'util';
import path from 'path';
import type { ChildProcess, SpawnOptions } from 'child_process';
import type { PlatformAdapter } from './types.js';

const execAsync = promisify(exec);

const SERVICE_NAME = 'fft-nano';
const TERMUX_PREFIX = process.env.PREFIX || '/data/data/com.termux/files/usr';
const SERVICE_DIR = `${TERMUX_PREFIX}/var/service/${SERVICE_NAME}`;
const CREDENTIALS_DIR = `${TERMUX_PREFIX}/etc/fft-nano-credentials`;

export class AndroidAdapter implements PlatformAdapter {
  readonly name = 'android' as const;
  readonly supportsDocker = false; // Android/Termux cannot run Docker
  readonly socketType = 'unix' as const;

  async installService(): Promise<void> {
    // Delegate to scripts/service.sh so macOS / Linux / Termux stay
    // consistent. The script handles termux-services dependency checks,
    // mkdir -p, run-script generation, and chmod. This keeps the
    // service definition identical between `fft service install` and
    // `service.sh install` on Android.
    const { spawn } = await import('child_process');
    const scriptPath = path.join(process.cwd(), 'scripts', 'service.sh');
    return new Promise<void>((resolve, reject) => {
      const child = spawn('bash', [scriptPath, 'install'], {
        env: { ...process.env, FFT_NANO_NONINTERACTIVE: '1' },
        stdio: 'inherit',
      });
      child.once('error', reject);
      child.once('exit', (code) => {
        if (code === 0) resolve();
        else
          reject(
            new Error(`scripts/service.sh install exited with code ${code}`),
          );
      });
    });
  }

  async uninstallService(): Promise<void> {
    await this.stopService();

    // Remove service directory
    try {
      const { rm } = await import('fs/promises');
      await rm(SERVICE_DIR, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  }

  async startService(): Promise<void> {
    // Delegate to scripts/service.sh so behavior matches the operator's
    // CLI. scripts/service.sh termux_start fails fast with a clear
    // error if termux-services is not installed.
    const { spawn } = await import('child_process');
    const scriptPath = path.join(process.cwd(), 'scripts', 'service.sh');
    return new Promise<void>((resolve, reject) => {
      const child = spawn('bash', [scriptPath, 'start'], {
        env: { ...process.env, FFT_NANO_NONINTERACTIVE: '1' },
        stdio: 'inherit',
      });
      child.once('error', reject);
      child.once('exit', (code) => {
        if (code === 0) resolve();
        else
          reject(
            new Error(`scripts/service.sh start exited with code ${code}`),
          );
      });
    });
  }

  async stopService(): Promise<void> {
    try {
      await execAsync(`sv down ${SERVICE_NAME} 2>/dev/null || true`);
    } catch {
      // Ignore
    }
  }

  async restartService(): Promise<void> {
    await this.stopService();
    await this.startService();
  }

  async getServiceStatus(): Promise<'running' | 'stopped' | 'not_installed'> {
    // Check if service directory exists
    if (!existsSync(SERVICE_DIR)) {
      return 'not_installed';
    }

    try {
      const { stdout } = await execAsync(
        `sv status ${SERVICE_NAME} 2>/dev/null || echo "down"`,
      );
      return stdout.trim().includes('run') ? 'running' : 'stopped';
    } catch {
      return 'stopped';
    }
  }

  async getServiceLogs(): Promise<string> {
    // Delegate to scripts/service.sh termux_logs so the on-disk log
    // rotation path (svlogd) is honored and both stdout and stderr are
    // surfaced.
    const { spawn } = await import('child_process');
    const scriptPath = path.join(process.cwd(), 'scripts', 'service.sh');
    return new Promise<string>((resolve) => {
      const child = spawn('bash', [scriptPath, 'logs'], {
        env: { ...process.env, FFT_NANO_NONINTERACTIVE: '1' },
      });
      let output = '';
      child.stdout?.on('data', (chunk: Buffer) => {
        output += chunk.toString('utf8');
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        output += chunk.toString('utf8');
      });
      child.once('error', () => resolve(output || '(no logs available)'));
      child.once('exit', () => resolve(output || '(no logs available)'));
    });
  }

  killProcessGroup(pid: number, signal: NodeJS.Signals): boolean {
    try {
      process.kill(-pid, signal);
      return true;
    } catch {
      return false;
    }
  }

  spawnDetached(
    command: string,
    args: string[],
    options?: SpawnOptions,
  ): ChildProcess {
    return spawn(command, args, {
      ...options,
      detached: true,
    });
  }

  showNotification(title: string, message: string): void {
    // Use termux-notification
    const escapedTitle = title.replace(/"/g, '\\"').replace(/'/g, "'\\''");
    const escapedMessage = message.replace(/"/g, '\\"').replace(/'/g, "'\\''");
    exec(
      `termux-notification --title "${escapedTitle}" --content "${escapedMessage}" 2>/dev/null || true`,
      { windowsHide: true },
    );
  }

  getCredential(service: string, account: string): string | null {
    const credFile = this.getCredentialPath(service, account);
    try {
      if (!existsSync(credFile)) {
        return null;
      }
      const content = readFileSync(credFile, 'utf8');
      return content.trim();
    } catch {
      return null;
    }
  }

  setCredential(service: string, account: string, value: string): void {
    const credFile = this.getCredentialPath(service, account);
    mkdirSync(CREDENTIALS_DIR, { recursive: true });
    writeFileSync(credFile, value, 'utf8');
  }

  deleteCredential(service: string, account: string): void {
    const credFile = this.getCredentialPath(service, account);
    try {
      unlinkSync(credFile);
    } catch {
      // Ignore
    }
  }

  private getCredentialPath(service: string, account: string): string {
    return path.join(CREDENTIALS_DIR, `${service}__${account}.cred`);
  }

  createLocalSocket(): Server {
    return createServer();
  }

  connectLocalSocket(): Socket {
    return new Socket();
  }

  resolveLocalSocketPath(): string {
    // On Android/Termux, /tmp is not writable. Use the Termux user-private
    // run directory under $PREFIX so the gateway can listen without root.
    return path.join(TERMUX_PREFIX, 'var', 'run', 'fft-nano', 'tui.sock');
  }

  normalizePath(p: string): string {
    return path.posix.normalize(p);
  }

  pathsEqual(a: string, b: string): boolean {
    return path.posix.normalize(a) === path.posix.normalize(b);
  }
}
