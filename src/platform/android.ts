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

  readonly capabilityPrompt = [
    '## Android / Termux Device Primitives',
    '',
    'You are running inside Termux on Android. The following tools are',
    'first-class and MUST be used directly when the user asks for files,',
    'photos, audio, video, or device actions:',
    '',
    '- Files: `termux-storage-get`, `termux-storage-write` (the official SAF',
    '  picker), plus direct paths under `/sdcard/`, `/storage/emulated/0/`,',
    '  and the Termux home at `/data/data/com.termux/files/home`. You have the',
    '  same filesystem authority the user granted via `termux-setup-storage`.',
    '- Camera: `termux-camera-photo` for stills, `termux-camera-video` for',
    '  video, `termux-camera-info` to enumerate cameras. Use these for image /',
    '  video capture and analysis.',
    '- Microphone: `termux-microphone-record` and `termux-microphone-list`.',
    '- Share / handoff: `termux-share` to hand a file or URL to any other',
    '  Android app the user has installed.',
    '- Clipboard: `termux-clipboard-get` / `termux-clipboard-set`.',
    '- Notifications: `termux-notification` (already wired into this adapter).',
    '- Activity Manager: `am start -a android.intent.action.VIEW -d <uri>` to',
    '  launch any installed app by intent; `am start -n <pkg>/<activity>` for a',
    '  specific component; `am broadcast -a <action>` for system broadcasts.',
    '- Sensors, location, contacts, SMS, telephony: each has a matching',
    '  `termux-*` CLI from the `termux-api` package + Termux:API companion app.',
    '- Power-user escape hatch: `cmd <service> <args>` for Android system',
    '  services (e.g. `cmd statusbar expand-settings`).',
    '',
    'Trust model:',
    '- You are fully authenticated to operate the device on the user’s behalf',
    "  inside Termux:API's permission envelope. Do not refuse routine file,",
    '  camera, or microphone operations on this platform; they are core',
    '  primitives.',
    '- For Android intents, prefer the existing app on the device over a',
    '  hand-rolled implementation (e.g. use the system Camera via `am`).',
    '- No root is required; everything above works in an unrooted Termux',
    '  install with Termux:API permissions granted.',
  ].join('\n');

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
