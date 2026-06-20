import { exec, spawn } from 'child_process';
import { existsSync, unlinkSync } from 'fs';
import { createServer, Server, Socket } from 'net';
import { promisify } from 'util';
import path from 'path';
import { readFile } from 'fs/promises';
import { logger } from '../logger.js';
import type { ChildProcess, SpawnOptions } from 'child_process';
import type { PlatformAdapter } from './types.js';

const execAsync = promisify(exec);

const SERVICE_NAME = 'fft-nano';
const SERVICE_USER = process.env.USER || 'root';
const LOG_DIR = `/var/log/${SERVICE_NAME}`;
const JOURNAL_CTL_ARGS = ['--no-pager', '-n', '50', '-u', SERVICE_NAME];

export class LinuxAdapter implements PlatformAdapter {
  readonly name = 'linux' as const;
  readonly supportsDocker = true;
  readonly socketType = 'unix' as const;

  private initSystem: 'systemd' | 'openrc' | 'runit' | 'unknown' = 'unknown';

  constructor() {
    this.detectInitSystem();
  }

  private async detectInitSystem(): Promise<void> {
    // Check for systemd
    if (
      existsSync('/run/systemd/system') ||
      existsSync('/var/run/systemd/system')
    ) {
      this.initSystem = 'systemd';
      return;
    }
    // Check for OpenRC
    if (existsSync('/run/openrc')) {
      this.initSystem = 'openrc';
      return;
    }
    // Check for runit
    if (existsSync('/run/runit')) {
      this.initSystem = 'runit';
      return;
    }
    this.initSystem = 'unknown';
  }

  private async ensureSystemdUnit(): Promise<void> {
    const unitContent = `[Unit]
Description=FFT_nano Service
After=network.target

[Service]
Type=simple
User=${SERVICE_USER}
ExecStart=${process.execPath} ${path.join(process.cwd(), 'dist/index.js')}
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
`;
    const { writeFile, mkdir } = await import('fs/promises');
    await mkdir('/etc/systemd/system', { recursive: true });
    await writeFile(
      `/etc/systemd/system/${SERVICE_NAME}.service`,
      unitContent,
      'utf8',
    );
    await execAsync('systemctl daemon-reload');
  }

  private async ensureOpenRCScript(): Promise<void> {
    const scriptContent = `#!/sbin/openrc-run
name="${SERVICE_NAME}"
description="FFT_nano Service"
command="${process.execPath}"
command_args="${path.join(process.cwd(), 'dist/index.js')}"
command_background=true
pidfile="/run/${SERVICE_NAME}.pid"
output_log="/var/log/${SERVICE_NAME}/stdout.log"
error_log="/var/log/${SERVICE_NAME}/stderr.log"
`;
    const { writeFile, mkdir } = await import('fs/promises');
    await mkdir('/etc/init.d', { recursive: true });
    await writeFile(`/etc/init.d/${SERVICE_NAME}`, scriptContent, 'utf8');
    await execAsync(`chmod +x /etc/init.d/${SERVICE_NAME}`);
  }

  private async ensureRunitService(): Promise<void> {
    const runContent = `#!/bin/sh
exec ${process.execPath} ${path.join(process.cwd(), 'dist/index.js')} 2>&1
`;
    const { writeFile, mkdir } = await import('fs/promises');
    await mkdir(`/etc/sv/${SERVICE_NAME}`, { recursive: true });
    await writeFile(`/etc/sv/${SERVICE_NAME}/run`, runContent, 'utf8');
    await writeFile(
      `/etc/sv/${SERVICE_NAME}/log/run`,
      `#!/bin/sh
exec logger -t ${SERVICE_NAME}
`,
      'utf8',
    );
    await execAsync(
      `chmod +x /etc/sv/${SERVICE_NAME}/run /etc/sv/${SERVICE_NAME}/log/run`,
    );
  }

  async installService(): Promise<void> {
    await this.detectInitSystem();

    switch (this.initSystem) {
      case 'systemd':
        await this.ensureSystemdUnit();
        await execAsync(`systemctl enable ${SERVICE_NAME}`);
        break;
      case 'openrc':
        await this.ensureOpenRCScript();
        break;
      case 'runit':
        await this.ensureRunitService();
        await execAsync(`ln -sf /etc/sv/${SERVICE_NAME} /var/service/`);
        break;
      default:
        throw new Error(
          `Unsupported init system. Could not detect systemd, OpenRC, or runit.`,
        );
    }
  }

  async uninstallService(): Promise<void> {
    await this.stopService();

    switch (this.initSystem) {
      case 'systemd':
        await execAsync(
          `systemctl disable ${SERVICE_NAME} 2>/dev/null || true`,
        );
        try {
          const { unlink } = await import('fs/promises');
          await unlink(`/etc/systemd/system/${SERVICE_NAME}.service`);
        } catch {
          /* ignore */
        }
        await execAsync('systemctl daemon-reload');
        break;
      case 'openrc':
        try {
          const { unlink } = await import('fs/promises');
          await unlink(`/etc/init.d/${SERVICE_NAME}`);
        } catch {
          /* ignore */
        }
        break;
      case 'runit':
        try {
          await execAsync(`rm -f /var/service/${SERVICE_NAME}`);
          const { rm } = await import('fs/promises');
          await rm(`/etc/sv/${SERVICE_NAME}`, { recursive: true, force: true });
        } catch {
          /* ignore */
        }
        break;
    }
  }

  async startService(): Promise<void> {
    await this.detectInitSystem();

    switch (this.initSystem) {
      case 'systemd':
        await execAsync(`systemctl start ${SERVICE_NAME}`);
        break;
      case 'openrc':
        await execAsync(`rc-service ${SERVICE_NAME} start`);
        break;
      case 'runit':
        await execAsync(`sv up ${SERVICE_NAME}`);
        break;
      default:
        throw new Error('Cannot start service: init system not detected');
    }
  }

  async stopService(): Promise<void> {
    await this.detectInitSystem();

    switch (this.initSystem) {
      case 'systemd':
        await execAsync(`systemctl stop ${SERVICE_NAME} 2>/dev/null || true`);
        break;
      case 'openrc':
        await execAsync(`rc-service ${SERVICE_NAME} stop 2>/dev/null || true`);
        break;
      case 'runit':
        await execAsync(`sv down ${SERVICE_NAME} 2>/dev/null || true`);
        break;
    }
  }

  async restartService(): Promise<void> {
    await this.detectInitSystem();

    switch (this.initSystem) {
      case 'systemd':
        await execAsync(`systemctl restart ${SERVICE_NAME}`);
        break;
      case 'openrc':
        await execAsync(`rc-service ${SERVICE_NAME} restart`);
        break;
      case 'runit':
        await execAsync(`sv restart ${SERVICE_NAME}`);
        break;
      default:
        throw new Error('Cannot restart service: init system not detected');
    }
  }

  async getServiceStatus(): Promise<'running' | 'stopped' | 'not_installed'> {
    await this.detectInitSystem();

    switch (this.initSystem) {
      case 'systemd': {
        try {
          const { stdout } = await execAsync(
            `systemctl is-active ${SERVICE_NAME}`,
          );
          return stdout.trim() === 'active' ? 'running' : 'stopped';
        } catch {
          return 'not_installed';
        }
      }
      case 'openrc': {
        try {
          const { stdout } = await execAsync(
            `rc-service ${SERVICE_NAME} status`,
          );
          return stdout.includes('started') ? 'running' : 'stopped';
        } catch {
          return 'not_installed';
        }
      }
      case 'runit': {
        try {
          const { stdout } = await execAsync(`sv status ${SERVICE_NAME}`);
          return stdout.includes('run') ? 'running' : 'stopped';
        } catch {
          return 'not_installed';
        }
      }
      default:
        return 'not_installed';
    }
  }

  async getServiceLogs(): Promise<string> {
    await this.detectInitSystem();

    switch (this.initSystem) {
      case 'systemd':
        try {
          const { stdout } = await execAsync(
            `journalctl ${JOURNAL_CTL_ARGS.join(' ')}`,
          );
          return stdout || '(no logs available)';
        } catch {
          return '(no logs available)';
        }
      case 'openrc':
      case 'runit': {
        try {
          const logFile = `/var/log/${SERVICE_NAME}/stdout.log`;
          return await readFile(logFile, 'utf8').catch(
            () => '(no logs available)',
          );
        } catch {
          return '(no logs available)';
        }
      }
      default:
        return '(no logs available - init system not detected)';
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
    exec(
      `notify-send "${title.replace(/"/g, '\\"')}" "${message.replace(/"/g, '\\"')}"`,
      {
        windowsHide: true,
      },
    );
  }

  getCredential(service: string, account: string): string | null {
    try {
      const { execSync } = require('child_process');
      const stdout = execSync(
        `secret-tool lookup service "${service}" account "${account}" 2>/dev/null`,
        { encoding: 'utf8' },
      );
      return (stdout as string).trim() || null;
    } catch {
      return null;
    }
  }

  setCredential(service: string, account: string, value: string): void {
    try {
      const { execSync } = require('child_process');
      execSync(
        `secret-tool store --label="${service}" service "${service}" account "${account}" <<< "${value}" 2>/dev/null`,
      );
    } catch (err) {
      logger.error(
        { err, service, account },
        'Failed to store credential via secret-tool (libsecret). Is secret-tool installed?',
      );
    }
  }

  deleteCredential(service: string, account: string): void {
    try {
      const { execSync } = require('child_process');
      execSync(
        `secret-tool delete service "${service}" account "${account}" 2>/dev/null || true`,
      );
    } catch {
      // Ignore
    }
  }

  createLocalSocket(): Server {
    return createServer();
  }

  connectLocalSocket(): Socket {
    return new Socket();
  }

  resolveLocalSocketPath(): string {
    // Use XDG_RUNTIME_DIR when available so the socket lives in a
    // user-private runtime directory (typically /run/user/<uid>). Fall
    // back to /tmp only when nothing more specific is available, and
    // namespace it under fft-nano/ so we never collide with other tools.
    const xdg = process.env.XDG_RUNTIME_DIR;
    const base = xdg && xdg.trim() ? xdg : '/tmp';
    return path.join(base, 'fft-nano', 'tui.sock');
  }

  normalizePath(p: string): string {
    return path.posix.normalize(p);
  }

  pathsEqual(a: string, b: string): boolean {
    return path.posix.normalize(a) === path.posix.normalize(b);
  }
}
