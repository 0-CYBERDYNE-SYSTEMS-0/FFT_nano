import { spawn } from 'child_process';
import { createServer, Server, Socket } from 'net';
import path from 'path';
import type { ChildProcess, SpawnOptions } from 'child_process';
import type { PlatformAdapter } from './types.js';

const SERVICE_NAME = 'fft-nano';

// Dynamic imports for node-windows (only available on Windows)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type WindowsServiceType = new (options: {
  name: string;
  description?: string;
  script: string;
}) => {
  install: (cb: (err: Error | null) => void) => void;
  start: (cb: (err: Error | null) => void) => void;
  stop: (cb: (err: Error | null) => void) => void;
  delete: (cb: (err: Error | null) => void) => void;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let WindowsService: WindowsServiceType | null | undefined = undefined;

async function getWindowsService(): Promise<WindowsServiceType | null> {
  if (WindowsService === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      WindowsService =
        ((await import('node-windows')) as any).default ||
        ((await import('node-windows')) as any);
    } catch {
      WindowsService = null;
    }
  }
  return WindowsService as WindowsServiceType | null;
}

// tree-kill for process tree killing on Windows
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let treeKill:
  | ((pid: number, signal: string, cb: (err: Error | null) => void) => void)
  | null = null;

async function getTreeKill(): Promise<
  | ((pid: number, signal: string, cb: (err: Error | null) => void) => void)
  | null
> {
  if (treeKill === null) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      treeKill = (await import('tree-kill')).default as any;
    } catch {
      // Keep as null
    }
  }
  return treeKill;
}

// node-notifier for Windows toast notifications
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type NotifierType = {
  notify: (options: { title: string; message: string }) => void;
};
let notifier: NotifierType | null | undefined = undefined;

async function getNotifier(): Promise<NotifierType | null> {
  if (notifier === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      notifier =
        ((await import('node-notifier')) as any).default ||
        ((await import('node-notifier')) as any);
    } catch {
      notifier = null;
    }
  }
  return notifier as NotifierType | null;
}

async function execAsync(
  command: string,
): Promise<{ stdout: string; stderr: string }> {
  const { exec } = await import('child_process');
  return new Promise((resolve) => {
    exec(
      command,
      { encoding: 'utf8' },
      (err: Error | null, stdout: string, stderr: string) => {
        resolve({ stdout: stdout || '', stderr: stderr || '' });
      },
    );
  });
}

function promisifyCallback<T>(
  fn: (cb: (err: Error | null, result?: T) => void) => void,
): () => Promise<T> {
  return () =>
    new Promise((resolve, reject) => {
      fn((err, result) => {
        if (err) reject(err);
        else resolve(result as T);
      });
    });
}

export class Win32Adapter implements PlatformAdapter {
  readonly name = 'win32' as const;
  readonly supportsDocker = true;
  readonly socketType = 'named_pipe' as const;

  async installService(): Promise<void> {
    const Service = await getWindowsService();
    if (!Service) {
      throw new Error(
        'node-windows is not installed. Run: npm install node-windows',
      );
    }

    const serviceScript = path.join(process.cwd(), 'dist', 'index.js');
    const service = new Service({
      name: SERVICE_NAME,
      description: 'FFT_nano AI Agent Service',
      script: serviceScript,
    });

    const install = promisifyCallback<void>(service.install.bind(service));
    await install();
  }

  async uninstallService(): Promise<void> {
    const Service = await getWindowsService();
    if (!Service) {
      throw new Error('node-windows is not installed');
    }

    await this.stopService();

    const service = new Service({
      name: SERVICE_NAME,
      description: '',
      script: '',
    });
    const deleteSvc = promisifyCallback<void>(service.delete.bind(service));
    try {
      await deleteSvc();
    } catch {
      // Service may not exist
    }
  }

  async startService(): Promise<void> {
    const Service = await getWindowsService();
    if (!Service) {
      throw new Error('node-windows is not installed');
    }

    const service = new Service({
      name: SERVICE_NAME,
      description: '',
      script: '',
    });
    const start = promisifyCallback<void>(service.start.bind(service));
    await start();
  }

  async stopService(): Promise<void> {
    const Service = await getWindowsService();
    if (!Service) {
      // Fall back to net stop
      await execAsync(`net stop "${SERVICE_NAME}" 2>nul || true`);
      return;
    }

    const service = new Service({
      name: SERVICE_NAME,
      description: '',
      script: '',
    });
    const stop = promisifyCallback<void>(service.stop.bind(service));
    try {
      await stop();
    } catch {
      // Service may not be running
    }
  }

  async restartService(): Promise<void> {
    await this.stopService();
    await this.startService();
  }

  async getServiceStatus(): Promise<'running' | 'stopped' | 'not_installed'> {
    const Service = await getWindowsService();

    if (!Service) {
      // Fall back to sc query
      const { stdout } = await execAsync(`sc query "${SERVICE_NAME}" 2>nul`);
      if (stdout.includes('STATE') && stdout.includes('RUNNING')) {
        return 'running';
      }
      if (stdout.includes('STATE') && stdout.includes('STOPPED')) {
        return 'stopped';
      }
      return 'not_installed';
    }

    return new Promise((resolve) => {
      const service = new Service({
        name: SERVICE_NAME,
        description: '',
        script: '',
      });
      // Check if service exists
      const { exec } = require('child_process');
      exec(
        `sc query "${SERVICE_NAME}"`,
        (err: Error | null, stdout: string) => {
          if (
            err ||
            stdout.includes('does not exist') ||
            stdout.includes('not found')
          ) {
            resolve('not_installed');
            return;
          }
          if (stdout.includes('RUNNING')) {
            resolve('running');
          } else {
            resolve('stopped');
          }
        },
      );
    });
  }

  async getServiceLogs(): Promise<string> {
    // Try to read from Windows Event Log via wevtutil
    try {
      const { stdout } = await execAsync(
        `wevtutil qe Application /c:20 /f:text /q:"*[System[Provider[@Name='FFT_nano'] or Provider[@Name='node']]]" 2>nul || echo "No logs available"`,
      );
      return stdout || '(no logs available)';
    } catch {
      return '(no logs available)';
    }
  }

  killProcessGroup(pid: number, signal: NodeJS.Signals): boolean {
    // Windows doesn't support Unix signals the same way
    // Try tree-kill first if available, otherwise use taskkill
    const tk = treeKill;
    if (tk) {
      try {
        // treeKill has a sync variant not in the types
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (tk as any).sync(pid, 'SIGKILL');
        return true;
      } catch {
        return false;
      }
    }

    // Fallback to synchronous taskkill
    try {
      const { execSync } = require('child_process');
      execSync(`taskkill /T /F /PID ${pid}`, { windowsHide: true });
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
    // Windows CREATE_NEW_PROCESS_GROUP flag - needed for proper process group isolation
    // on detached processes. The createProcessGroup flag allows the spawned process
    // to be killed as a group via taskkill /T.
    const spawnOpts = {
      ...options,
      detached: false, // Windows handles detachment differently
      windowsHide: true,
      windowsVerbatimArguments: false,
      windowsCreateProcessOptions: {
        createProcessGroup: true,
      },
    };

    // Cast to allow windowsCreateProcessOptions which may not be in all TS definitions
    return spawn(
      command,
      args,
      spawnOpts as SpawnOptions & {
        windowsCreateProcessOptions?: { createProcessGroup: boolean };
      },
    );
  }

  showNotification(title: string, message: string): void {
    // Try node-notifier first
    getNotifier().then((n) => {
      if (n) {
        n.notify({ title, message });
        return;
      }
      // Fallback to PowerShell toast
      const { exec } = require('child_process');
      const escapedTitle = title.replace(/"/g, '\\"');
      const escapedMessage = message.replace(/"/g, '\\"');
      const psCommand = `
        [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
        [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
        $template = @"
        <toast>
          <visual>
            <binding template="ToastText02">
              <text id="1">${escapedTitle}</text>
              <text id="2">${escapedMessage}</text>
            </binding>
          </visual>
        </toast>
"@
        $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
        $xml.LoadXml($template)
        $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
        [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("FFT_nano").Show($toast)
      `;
      exec(`powershell -Command "${psCommand}"`, { windowsHide: true });
    });
  }

  getCredential(service: string, account: string): string | null {
    try {
      const { execSync } = require('child_process');
      // Use cmdkey to list credentials
      const target = `${service}/${account}`;
      const stdout = execSync(`cmdkey /list:${target} 2>nul`, {
        encoding: 'utf8',
        windowsHide: true,
      });
      // Parse the password from output using line-by-line parsing
      const lines = (stdout as string).split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.toLowerCase().startsWith('password:')) {
          const password = trimmed.substring(9).trim();
          if (password) {
            return password;
          }
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  setCredential(service: string, account: string, value: string): void {
    try {
      const { execSync } = require('child_process');
      const target = `${service}/${account}`;
      // First delete any existing credential
      execSync(`cmdkey /delete:${target} 2>nul || true`, { windowsHide: true });
      // Then add new one
      execSync(`cmdkey /generic:${target} /pass:"${value}" 2>nul || true`, {
        windowsHide: true,
      });
    } catch {
      // cmdkey may fail in some environments
    }
  }

  deleteCredential(service: string, account: string): void {
    try {
      const { execSync } = require('child_process');
      const target = `${service}/${account}`;
      execSync(`cmdkey /delete:${target} 2>nul || true`, { windowsHide: true });
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
    // Use a Windows named pipe. The local transport on Windows is a
    // named pipe rather than a filesystem path.
    return '\\\\.\\pipe\\fft-nano-tui';
  }

  normalizePath(p: string): string {
    return path.win32.normalize(p);
  }

  pathsEqual(a: string, b: string): boolean {
    return (
      path.win32.normalize(a).toLowerCase() ===
      path.win32.normalize(b).toLowerCase()
    );
  }
}
