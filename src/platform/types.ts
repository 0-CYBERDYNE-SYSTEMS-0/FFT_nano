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
  spawnDetached(command: string, args: string[], options?: SpawnOptions): ChildProcess;

  // Notifications
  showNotification(title: string, message: string): void;

  // Credentials
  getCredential(service: string, account: string): string | null;
  setCredential(service: string, account: string, value: string): void;
  deleteCredential(service: string, account: string): void;

  // Local socket (TUI gateway)
  createLocalSocket(path: string): Server;
  connectLocalSocket(path: string): Socket;

  // Paths
  normalizePath(p: string): string;
  pathsEqual(a: string, b: string): boolean;

  // Platform capabilities
  readonly supportsDocker: boolean;
  readonly socketType: 'unix' | 'named_pipe' | 'tcp';
}

export type { Server as LocalSocketServer, Socket as LocalSocketClient };
