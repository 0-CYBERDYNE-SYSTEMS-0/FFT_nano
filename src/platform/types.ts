import type { ChildProcess, SpawnOptions } from 'child_process';
import type { Server, Socket } from 'net';

/**
 * PlatformAdapter - abstraction layer for platform-specific behavior
 *
 * Covers:
 * - Service management (install/uninstall/start/stop/restart/status/logs)
 * - Process management (kill process groups, spawn detached)
 * - Credential storage
 * - System notifications
 * - Local socket creation/connection
 * - Path normalization and comparison
 */
export interface PlatformAdapter {
  readonly name: 'darwin' | 'linux' | 'win32' | 'android';

  // Service management
  installService(): Promise<void>;
  uninstallService(): Promise<void>;
  startService(): Promise<void>;
  stopService(): Promise<void>;
  restartService(): Promise<void>;
  getServiceStatus(): Promise<'running' | 'stopped' | 'not_installed'>;
  getServiceLogs(): Promise<string>;

  // Process management
  killProcessGroup(pid: number, signal: NodeJS.Signals): boolean;
  spawnDetached(
    command: string,
    args: string[],
    options?: SpawnOptions,
  ): ChildProcess;

  // Notifications
  showNotification(title: string, message: string): void;

  // Credentials
  getCredential(service: string, account: string): string | null;
  setCredential(service: string, account: string, value: string): void;
  deleteCredential(service: string, account: string): void;

  // Local socket (TUI gateway)
  /**
   * Create an unbound, unlistened net server for the local TUI transport.
   * The caller is responsible for calling `.listen(...)` (or otherwise
   * attaching it) so that the platform can decide whether to bind, clean
   * up stale entries, or apply address-family specific setup first.
   */
  createLocalSocket(): Server;
  /**
   * Return an unconnected client socket for the local TUI transport.
   * The caller is responsible for calling `.connect(...)` with the
   * resolved endpoint. Returning a connected socket would conflict with
   * the caller's connect call and break platform-specific behavior
   * (e.g., Windows named pipes, Android abstract sockets).
   */
  connectLocalSocket(): Socket;

  // Paths
  /**
   * Resolve the platform-appropriate local endpoint for the TUI transport.
   * On Unix-like systems this is a filesystem path (e.g., Termux
   * $PREFIX/var/run/fft-nano/tui.sock). On Windows this is a named-pipe
   * path (e.g., \\\\.\\pipe\\fft-nano-tui). Implementations should NOT
   * hardcode /tmp because that location is not writable on Android/Termux.
   */
  resolveLocalSocketPath(): string;

  // Paths
  normalizePath(p: string): string;
  pathsEqual(a: string, b: string): boolean;

  // Platform capabilities
  readonly supportsDocker: boolean;
  readonly socketType: 'unix' | 'named_pipe' | 'tcp';
}

export type { Server as LocalSocketServer, Socket as LocalSocketClient };
