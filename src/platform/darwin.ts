import { exec, spawn } from 'child_process';
import { existsSync, unlinkSync } from 'fs';
import { createServer } from 'net';
import { promisify } from 'util';
import path from 'path';
import type { ChildProcess, SpawnOptions } from 'child_process';
import type { Server, Socket } from 'net';
import type { PlatformAdapter } from './types.js';

const execAsync = promisify(exec);

const LABEL = process.env.FFT_NANO_LAUNCHD_LABEL || 'com.fft_nano';
const PLIST_PATH = (): string =>
  path.join(process.env.HOME || '', 'Library/LaunchAgents', `${LABEL}.plist`);

export class DarwinAdapter implements PlatformAdapter {
  readonly name = 'darwin' as const;
  readonly supportsDocker = true;
  readonly socketType = 'unix' as const;

  async installService(): Promise<void> {
    const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${process.execPath}</string>
        <string>${path.join(process.cwd(), 'dist/index.js')}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${path.join(process.env.HOME || '', 'Library/Logs', LABEL, 'stdout.log')}</string>
    <key>StandardErrorPath</key>
    <string>${path.join(process.env.HOME || '', 'Library/Logs', LABEL, 'stderr.log')}</string>
</dict>
</plist>`;

    const plistDir = path.dirname(PLIST_PATH());
    const { mkdir } = await import('fs/promises');
    await mkdir(plistDir, { recursive: true });

    const { writeFile } = await import('fs/promises');
    await writeFile(PLIST_PATH(), plistContent, 'utf8');

    // Unload existing first
    try {
      await execAsync(`launchctl bootout gui/$(id -u) "${PLIST_PATH()}" 2>/dev/null || true`);
    } catch {
      // Ignore
    }

    // Bootstrap
    await execAsync(`launchctl bootstrap gui/$(id -u) "${PLIST_PATH()}"`);
  }

  async uninstallService(): Promise<void> {
    try {
      await execAsync(`launchctl bootout gui/$(id -u) "${PLIST_PATH()}" 2>/dev/null || true`);
    } catch {
      // Ignore
    }

    try {
      unlinkSync(PLIST_PATH());
    } catch {
      // Ignore
    }
  }

  async startService(): Promise<void> {
    await execAsync(`launchctl kickstart -k gui/$(id -u)/${LABEL}`);
    // Bootstrap if not already
    try {
      await execAsync(`launchctl print gui/$(id -u)/${LABEL} 2>/dev/null || launchctl bootstrap gui/$(id -u) "${PLIST_PATH()}"`);
    } catch {
      await execAsync(`launchctl bootstrap gui/$(id -u) "${PLIST_PATH()}"`);
    }
  }

  async stopService(): Promise<void> {
    try {
      await execAsync(`launchctl bootout gui/$(id -u)/${LABEL} 2>/dev/null || true`);
    } catch {
      // Ignore
    }
  }

  async restartService(): Promise<void> {
    await this.stopService();
    await this.startService();
  }

  async getServiceStatus(): Promise<'running' | 'stopped' | 'not_installed'> {
    try {
      const { stdout } = await execAsync(`launchctl print gui/$(id -u)/${LABEL} 2>&1`);
      if (stdout.includes(' PID:') || stdout.includes('Running')) {
        return 'running';
      }
      return 'stopped';
    } catch {
      // Check if plist exists
      if (existsSync(PLIST_PATH())) {
        return 'stopped';
      }
      return 'not_installed';
    }
  }

  async getServiceLogs(): Promise<string> {
    const logDir = path.join(process.env.HOME || '', 'Library/Logs', LABEL);
    const stdoutPath = path.join(logDir, 'stdout.log');
    const stderrPath = path.join(logDir, 'stderr.log');

    let logs = '';
    try {
      const { readFile } = await import('fs/promises');
      logs += `=== stdout ===\n${await readFile(stdoutPath, 'utf8').catch(() => '(no stdout log)')}`;
      logs += `\n=== stderr ===\n${await readFile(stderrPath, 'utf8').catch(() => '(no stderr log)')}`;
    } catch {
      logs = '(no logs available)';
    }
    return logs;
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
    });
  }

  showNotification(title: string, message: string): void {
    const script = `display notification "${message.replace(/"/g, '\\"')}" with title "${title.replace(/"/g, '\\"')}"`;
    exec(`osascript -e '${script}'`, { windowsHide: true });
  }

  getCredential(service: string, account: string): string | null {
    try {
      const { stdout } = execSync(
        `security find-generic-password -s "${service}" -a "${account}" -w 2>/dev/null`,
        { encoding: 'utf8' },
      );
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }

  setCredential(service: string, account: string, value: string): void {
    // Delete existing first
    try {
      execSync(`security delete-generic-password -s "${service}" -a "${account}" 2>/dev/null || true`);
    } catch {
      // Ignore
    }
    // Add new
    execSync(
      `security add-generic-password -s "${service}" -a "${account}" -w "${value}" -U 2>/dev/null || true`,
    );
  }

  deleteCredential(service: string, account: string): void {
    try {
      execSync(`security delete-generic-password -s "${service}" -a "${account}" 2>/dev/null || true`);
    } catch {
      // Ignore
    }
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

// Need execSync
function execSync(command: string, options?: { encoding?: string; windowsHide?: boolean }): { stdout: string } {
  const { execSync: _execSync } = require('child_process');
  return _execSync(command, options) as { stdout: string };
}
