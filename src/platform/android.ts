import { exec, spawn } from 'child_process';
import { existsSync, unlinkSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { createServer } from 'net';
import { promisify } from 'util';
import path from 'path';
import type { ChildProcess, SpawnOptions } from 'child_process';
import type { Server, Socket } from 'net';
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
    // Create service directory
    mkdirSync(`${SERVICE_DIR}/log`, { recursive: true });

    // Create run script
    const runScript = `#!/data/data/com.termux/files/usr/bin/sh
exec ${process.execPath} ${path.join(process.cwd(), 'dist/index.js')} 2>&1
`;
    writeFileSync(`${SERVICE_DIR}/run`, runScript, 'utf8');

    // Create log/run script
    const logRunScript = `#!/data/data/com.termux/files/usr/bin/sh
exec logger -t ${SERVICE_NAME}
`;
    writeFileSync(`${SERVICE_DIR}/log/run`, logRunScript, 'utf8');

    // Make executable
    try {
      await execAsync(`chmod +x "${SERVICE_DIR}/run" "${SERVICE_DIR}/log/run"`);
    } catch {
      // May fail if running as non-Termux user
    }
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
    try {
      await execAsync(`sv up ${SERVICE_NAME}`);
    } catch {
      throw new Error('Failed to start service. Ensure termux-services is installed and service exists.');
    }
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
      const { stdout } = await execAsync(`sv status ${SERVICE_NAME} 2>/dev/null || echo "down"`);
      return stdout.trim().includes('run') ? 'running' : 'stopped';
    } catch {
      return 'stopped';
    }
  }

  async getServiceLogs(): Promise<string> {
    const logDir = `${TERMUX_PREFIX}/var/log/${SERVICE_NAME}`;
    const logFile = `${logDir}/stdout.log`;

    try {
      return readFileSync(logFile, 'utf8');
    } catch {
      // Try to get logs via sv log
      try {
        const { stdout } = await execAsync(`sv log ${SERVICE_NAME} 2>/dev/null || echo "(no logs)"`);
        return stdout || '(no logs available)';
      } catch {
        return '(no logs available)';
      }
    }
  }

  killProcessGroup(pid: number, signal: NodeJS.Signals): boolean {
    try {
      process.kill(-pid, signal);
      return true;
    } catch {
      return false;
    }
  }

  spawnDetached(command: string, args: string[], options?: SpawnOptions): ChildProcess {
    return spawn(command, args, {
      ...options,
      detached: true,
      stdio: 'ignore',
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

  createLocalSocket(socketPath: string): Server {
    if (existsSync(socketPath)) {
      unlinkSync(socketPath);
    }
    return createServer().listen(socketPath);
  }

  connectLocalSocket(socketPath: string): Socket {
    const { createConnection } = require('net');
    return createConnection(socketPath);
  }

  normalizePath(p: string): string {
    return path.posix.normalize(p);
  }

  pathsEqual(a: string, b: string): boolean {
    return path.posix.normalize(a) === path.posix.normalize(b);
  }
}
