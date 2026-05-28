import fs from 'fs';
import path from 'path';

import type { ActiveChatRun, ActiveCoderRun } from './app-state.js';
import { writeJsonFileAtomic } from './atomic-write.js';

export type WatchdogIncidentKind =
  | 'stale_run'
  | 'corrupt_json'
  | 'suspicious_markdown'
  | 'watchdog_error';
export type WatchdogIncidentSeverity = 'warn' | 'fail';
export type WatchdogIncidentAction =
  | 'alerted'
  | 'aborted'
  | 'quarantined'
  | 'restored_from_backup';

export interface WatchdogIncident {
  key: string;
  kind: WatchdogIncidentKind;
  severity: WatchdogIncidentSeverity;
  action: WatchdogIncidentAction;
  message: string;
  runId?: string;
  chatJid?: string;
  filePath?: string;
  quarantinePath?: string;
  backupPath?: string;
  ageMs?: number;
  staleMs?: number;
  createdAt: string;
}

export interface WatchdogStatus {
  enabled: boolean;
  lastScanAt?: string;
  lastFileScanAt?: string;
  incidentCounts: Record<WatchdogIncidentKind, number>;
  quarantinedFileCount: number;
  staleRunCount: number;
  latestIncident?: WatchdogIncident;
}

export interface WatchdogConfig {
  enabled: boolean;
  intervalMs: number;
  chatRunMaxMs: number;
  chatStaleMs: number;
  coderRunMaxMs: number;
  coderStaleMs: number;
  fileScanMs: number;
  alertCooldownMs: number;
}

export interface WatchdogDeps {
  activeChatRuns: Map<string, ActiveChatRun>;
  activeChatRunsById: Map<string, ActiveChatRun>;
  activeCoderRuns: Map<string, ActiveCoderRun>;
  dataDir: string;
  groupsDir: string;
  mainWorkspaceDir: string;
  isShuttingDown?: () => boolean;
  sendAlert?: (
    text: string,
    incident: WatchdogIncident,
  ) => Promise<void> | void;
  logger?: {
    debug?: (payload: unknown, message?: string) => void;
    info?: (payload: unknown, message?: string) => void;
    warn?: (payload: unknown, message?: string) => void;
    error?: (payload: unknown, message?: string) => void;
  };
  now?: () => number;
}

const WATCHDOG_STATUS_VERSION = 1;
const MAIN_MARKDOWN_FILES = [
  'MEMORY.md',
  'SOUL.md',
  'TODOS.md',
  'HEARTBEAT.md',
  'NANO.md',
] as const;
const GROUP_MARKDOWN_FILES = [
  'MEMORY.md',
  'SOUL.md',
  'TODOS.md',
  'NANO.md',
] as const;
const IPC_QUEUE_DIRS = [
  'messages',
  'tasks',
  'actions',
  'deliver_files',
] as const;

const MAIN_GROUP_FOLDER = 'main';

function normalizeRegisteredGroupFolderName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === MAIN_GROUP_FOLDER) return null;
  if (trimmed === '.' || trimmed === '..') return null;
  return path.basename(trimmed) === trimmed ? trimmed : null;
}

function resolveRegisteredGroupDirs(
  dataDir: string,
  groupsDir: string,
): string[] {
  const registeredPath = path.join(dataDir, 'registered_groups.json');
  if (!fs.existsSync(registeredPath)) return [];

  let parsed: unknown;
  try {
    parsed = safeReadJson(registeredPath);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== 'object') return [];

  const folders = new Set<string>();
  for (const value of Object.values(parsed as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue;
    const folder = normalizeRegisteredGroupFolderName(
      (value as Record<string, unknown>).folder,
    );
    if (folder) folders.add(folder);
  }

  return Array.from(folders).map((folder) => path.join(groupsDir, folder));
}

function envFlag(value: string | undefined, defaultValue: boolean): boolean {
  if (typeof value !== 'string') return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function envInt(
  value: string | undefined,
  defaultValue: number,
  min: number,
  max: number,
): number {
  const parsed = Number.parseInt(value || '', 10);
  if (!Number.isFinite(parsed)) return defaultValue;
  return Math.min(max, Math.max(min, parsed));
}

export function getWatchdogConfig(): WatchdogConfig {
  return {
    enabled: envFlag(process.env.FFT_NANO_WATCHDOG_ENABLED, true),
    intervalMs: envInt(
      process.env.FFT_NANO_WATCHDOG_INTERVAL_MS,
      30_000,
      1_000,
      24 * 60 * 60 * 1000,
    ),
    chatRunMaxMs: envInt(
      process.env.FFT_NANO_WATCHDOG_CHAT_RUN_MAX_MS,
      30 * 60 * 1000,
      1_000,
      24 * 60 * 60 * 1000,
    ),
    chatStaleMs: envInt(
      process.env.FFT_NANO_WATCHDOG_CHAT_STALE_MS,
      5 * 60 * 1000,
      1_000,
      24 * 60 * 60 * 1000,
    ),
    coderRunMaxMs: envInt(
      process.env.FFT_NANO_WATCHDOG_CODER_RUN_MAX_MS,
      30 * 60 * 1000,
      1_000,
      24 * 60 * 60 * 1000,
    ),
    coderStaleMs: envInt(
      process.env.FFT_NANO_WATCHDOG_CODER_STALE_MS,
      5 * 60 * 1000,
      1_000,
      24 * 60 * 60 * 1000,
    ),
    fileScanMs: envInt(
      process.env.FFT_NANO_WATCHDOG_FILE_SCAN_MS,
      5 * 60 * 1000,
      1_000,
      24 * 60 * 60 * 1000,
    ),
    alertCooldownMs: envInt(
      process.env.FFT_NANO_WATCHDOG_ALERT_COOLDOWN_MS,
      10 * 60 * 1000,
      0,
      24 * 60 * 60 * 1000,
    ),
  };
}

function emptyStatus(enabled: boolean): WatchdogStatus {
  return {
    enabled,
    incidentCounts: {
      stale_run: 0,
      corrupt_json: 0,
      suspicious_markdown: 0,
      watchdog_error: 0,
    },
    quarantinedFileCount: 0,
    staleRunCount: 0,
  };
}

function statusPath(dataDir: string): string {
  return path.join(dataDir, 'watchdog', 'status.json');
}

function safeReadJson(filePath: string): unknown {
  const raw = fs.readFileSync(filePath, 'utf-8');
  return raw.trim() ? JSON.parse(raw) : null;
}

function formatIncidentAlert(incident: WatchdogIncident): string {
  const lines = [
    '[WATCHDOG]',
    `${incident.severity.toUpperCase()} ${incident.kind}: ${incident.message}`,
    `action=${incident.action}`,
  ];
  if (incident.runId) lines.push(`run=${incident.runId}`);
  if (incident.chatJid) lines.push(`chat=${incident.chatJid}`);
  if (typeof incident.ageMs === 'number') {
    lines.push(`age=${Math.round(incident.ageMs / 1000)}s`);
  }
  if (typeof incident.staleMs === 'number') {
    lines.push(`stale=${Math.round(incident.staleMs / 1000)}s`);
  }
  if (incident.filePath) lines.push(`file=${incident.filePath}`);
  if (incident.quarantinePath) {
    lines.push(`quarantine=${incident.quarantinePath}`);
  }
  if (incident.backupPath) lines.push(`backup=${incident.backupPath}`);
  return lines.join('\n');
}

function isJsonFileName(fileName: string): boolean {
  return fileName.endsWith('.json');
}

function timestampForPath(now: number): string {
  return new Date(now).toISOString().replace(/[:.]/g, '-');
}

function restoreFromBackup(filePath: string, backupPath: string): boolean {
  if (!fs.existsSync(backupPath)) return false;
  const backupStat = fs.statSync(backupPath);
  if (!backupStat.isFile() || backupStat.size <= 0) return false;
  fs.copyFileSync(backupPath, filePath);
  return true;
}

function hasInterruptedWriteMarker(content: string): boolean {
  return (
    content.includes('\u0000') ||
    content.includes('<<<<<<<') ||
    content.includes('>>>>>>>') ||
    content.includes('FFT_NANO_WRITE_INTERRUPTED')
  );
}

export function createWatchdog(
  deps: WatchdogDeps,
  config: WatchdogConfig = getWatchdogConfig(),
): {
  scan: () => Promise<WatchdogStatus>;
  start: () => void;
  stop: () => void;
  getStatus: () => WatchdogStatus;
} {
  let status = emptyStatus(config.enabled);
  let timer: NodeJS.Timeout | null = null;
  let lastFileScanAtMs = 0;
  const markdownSizes = new Map<string, number>();
  const alertedAt = new Map<string, number>();

  function now(): number {
    return deps.now ? deps.now() : Date.now();
  }

  function persistStatus(): void {
    try {
      writeJsonFileAtomic(statusPath(deps.dataDir), {
        version: WATCHDOG_STATUS_VERSION,
        ...status,
      });
    } catch (err) {
      deps.logger?.warn?.({ err }, 'Failed to persist watchdog status');
    }
  }

  async function emitIncident(
    incident: Omit<WatchdogIncident, 'createdAt'>,
  ): Promise<void> {
    const at = now();
    const full: WatchdogIncident = {
      ...incident,
      createdAt: new Date(at).toISOString(),
    };
    status.incidentCounts[full.kind] += 1;
    if (full.kind === 'corrupt_json' && full.action === 'quarantined') {
      status.quarantinedFileCount += 1;
    }
    status.latestIncident = full;
    persistStatus();

    const lastAlertAt = alertedAt.get(full.key) || 0;
    if (
      lastAlertAt > 0 &&
      config.alertCooldownMs > 0 &&
      at - lastAlertAt < config.alertCooldownMs
    ) {
      return;
    }
    alertedAt.set(full.key, at);
    deps.logger?.warn?.(full, 'Watchdog incident');
    await deps.sendAlert?.(formatIncidentAlert(full), full);
  }

  async function scanRuns(): Promise<void> {
    const at = now();
    let staleCount = 0;

    for (const run of Array.from(deps.activeChatRunsById.values())) {
      const ageMs = at - run.startedAt;
      const staleMs = at - (run.lastProgressAt || run.startedAt);
      const staleByProgress = staleMs >= config.chatStaleMs;
      const staleByMax = ageMs >= config.chatRunMaxMs;
      if (!staleByProgress && !staleByMax) continue;
      staleCount += 1;

      if (run.watchdogAbortAt) {
        if (deps.activeChatRuns.get(run.chatJid) === run) {
          deps.activeChatRuns.delete(run.chatJid);
        }
        deps.activeChatRunsById.delete(run.requestId);
        await emitIncident({
          key: `stale-chat-cleanup:${run.requestId}`,
          kind: 'stale_run',
          severity: 'fail',
          action: 'aborted',
          message: 'Removed stale chat run bookkeeping after watchdog abort',
          runId: run.requestId,
          chatJid: run.chatJid,
          ageMs,
          staleMs,
        });
        continue;
      }

      run.watchdogAbortAt = at;
      run.abortController.abort(
        new Error(
          staleByMax
            ? 'Aborted by FFT_nano watchdog: max chat run age exceeded'
            : 'Aborted by FFT_nano watchdog: chat run made no progress',
        ),
      );
      await emitIncident({
        key: `stale-chat:${run.requestId}`,
        kind: 'stale_run',
        severity: 'fail',
        action: 'aborted',
        message: staleByMax
          ? 'Chat run exceeded watchdog max age'
          : 'Chat run exceeded watchdog stale threshold',
        runId: run.requestId,
        chatJid: run.chatJid,
        ageMs,
        staleMs,
      });
    }

    for (const run of Array.from(deps.activeCoderRuns.values())) {
      if (
        run.state === 'completed' ||
        run.state === 'failed' ||
        run.state === 'aborted'
      ) {
        continue;
      }
      const ageMs = at - run.startedAt;
      const staleMs = at - (run.lastProgressAt || run.startedAt);
      const staleByProgress = staleMs >= config.coderStaleMs;
      const staleByMax = ageMs >= config.coderRunMaxMs;
      if (!staleByProgress && !staleByMax) continue;
      staleCount += 1;

      if (run.watchdogAbortAt) {
        deps.activeCoderRuns.delete(run.requestId);
        await emitIncident({
          key: `stale-coder-cleanup:${run.requestId}`,
          kind: 'stale_run',
          severity: 'fail',
          action: 'aborted',
          message: 'Removed stale coder run bookkeeping after watchdog abort',
          runId: run.requestId,
          chatJid: run.chatJid,
          ageMs,
          staleMs,
        });
        continue;
      }

      run.watchdogAbortAt = at;
      run.state = 'aborted';
      run.abortController?.abort(
        new Error(
          staleByMax
            ? 'Aborted by FFT_nano watchdog: max coder run age exceeded'
            : 'Aborted by FFT_nano watchdog: coder run made no progress',
        ),
      );
      await emitIncident({
        key: `stale-coder:${run.requestId}`,
        kind: 'stale_run',
        severity: 'fail',
        action: 'aborted',
        message: staleByMax
          ? 'Coder run exceeded watchdog max age'
          : 'Coder run exceeded watchdog stale threshold',
        runId: run.requestId,
        chatJid: run.chatJid,
        ageMs,
        staleMs,
      });
    }

    status.staleRunCount = staleCount;
  }

  async function validateJsonFile(filePath: string): Promise<void> {
    if (!fs.existsSync(filePath)) return;
    try {
      safeReadJson(filePath);
    } catch {
      await emitIncident({
        key: `corrupt-json:${filePath}`,
        kind: 'corrupt_json',
        severity: 'fail',
        action: 'alerted',
        message: 'Critical JSON file is unreadable',
        filePath,
      });
    }
  }

  async function scanIpcJson(): Promise<void> {
    const ipcDir = path.join(deps.dataDir, 'ipc');
    if (!fs.existsSync(ipcDir)) return;
    const errorDir = path.join(ipcDir, 'errors');
    const groupDirs = fs
      .readdirSync(ipcDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== 'errors')
      .map((entry) => entry.name);

    for (const group of groupDirs) {
      for (const queue of IPC_QUEUE_DIRS) {
        const queueDir = path.join(ipcDir, group, queue);
        if (!fs.existsSync(queueDir)) continue;
        const files = fs
          .readdirSync(queueDir, { withFileTypes: true })
          .filter((entry) => entry.isFile() && isJsonFileName(entry.name))
          .map((entry) => entry.name);
        for (const file of files) {
          const filePath = path.join(queueDir, file);
          try {
            safeReadJson(filePath);
          } catch {
            fs.mkdirSync(errorDir, { recursive: true });
            const quarantinePath = path.join(
              errorDir,
              `${queue}-${group}-${timestampForPath(now())}-${file}`,
            );
            fs.renameSync(filePath, quarantinePath);
            await emitIncident({
              key: `ipc-json:${group}:${queue}:${file}`,
              kind: 'corrupt_json',
              severity: 'fail',
              action: 'quarantined',
              message: 'Invalid IPC JSON quarantined',
              filePath,
              quarantinePath,
            });
          }
        }
      }
    }
  }

  async function scanMarkdownFile(filePath: string): Promise<void> {
    const backupPath = `${filePath}.bak`;
    if (!fs.existsSync(filePath)) {
      await emitIncident({
        key: `markdown-missing:${filePath}`,
        kind: 'suspicious_markdown',
        severity: 'warn',
        action: 'alerted',
        message: 'Critical markdown file is missing',
        filePath,
      });
      return;
    }

    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return;
    const previousSize = markdownSizes.get(filePath);
    const content = fs.readFileSync(filePath, 'utf-8');
    const zeroByte = stat.size === 0;
    const shrankSuspiciously =
      typeof previousSize === 'number' &&
      previousSize >= 1024 &&
      stat.size < Math.max(128, Math.floor(previousSize * 0.25));
    const interrupted = hasInterruptedWriteMarker(content);
    markdownSizes.set(filePath, stat.size);

    if (!zeroByte && !shrankSuspiciously && !interrupted) return;

    if (restoreFromBackup(filePath, backupPath)) {
      const restoredSize = fs.statSync(filePath).size;
      markdownSizes.set(filePath, restoredSize);
      await emitIncident({
        key: `markdown-restore:${filePath}`,
        kind: 'suspicious_markdown',
        severity: 'fail',
        action: 'restored_from_backup',
        message: 'Suspicious markdown restored from host backup',
        filePath,
        backupPath,
      });
      return;
    }

    await emitIncident({
      key: `markdown-suspicious:${filePath}`,
      kind: 'suspicious_markdown',
      severity: 'fail',
      action: 'alerted',
      message: zeroByte
        ? 'Critical markdown file is zero-byte'
        : shrankSuspiciously
          ? 'Critical markdown file shrank suspiciously'
          : 'Critical markdown file contains interrupted-write markers',
      filePath,
    });
  }

  async function scanMarkdownRoot(
    rootDir: string,
    files: readonly string[],
  ): Promise<void> {
    for (const file of files) {
      await scanMarkdownFile(path.join(rootDir, file));
    }
  }

  async function scanCriticalFiles(): Promise<void> {
    await validateJsonFile(
      path.join(
        deps.dataDir,
        'pi',
        'main',
        '.pi',
        'fft_nano',
        'prompt-state.json',
      ),
    );
    await validateJsonFile(
      path.join(deps.mainWorkspaceDir, 'logs', 'system-prompt.latest.json'),
    );
    await scanIpcJson();
    await scanMarkdownRoot(deps.mainWorkspaceDir, MAIN_MARKDOWN_FILES);

    if (!fs.existsSync(deps.groupsDir)) return;
    const groupDirs = resolveRegisteredGroupDirs(deps.dataDir, deps.groupsDir);
    for (const groupDir of groupDirs) {
      if (!fs.existsSync(groupDir)) continue;
      await scanMarkdownRoot(groupDir, GROUP_MARKDOWN_FILES);
    }
  }

  async function scan(): Promise<WatchdogStatus> {
    if (!config.enabled) {
      status.enabled = false;
      persistStatus();
      return status;
    }
    if (deps.isShuttingDown?.()) return status;

    const scanAt = now();
    status.enabled = true;
    status.lastScanAt = new Date(scanAt).toISOString();

    try {
      await scanRuns();
      if (scanAt - lastFileScanAtMs >= config.fileScanMs) {
        lastFileScanAtMs = scanAt;
        status.lastFileScanAt = new Date(scanAt).toISOString();
        await scanCriticalFiles();
      }
    } catch (err) {
      await emitIncident({
        key: `watchdog-error:${err instanceof Error ? err.message : String(err)}`,
        kind: 'watchdog_error',
        severity: 'warn',
        action: 'alerted',
        message: err instanceof Error ? err.message : String(err),
      });
    }

    persistStatus();
    return status;
  }

  function start(): void {
    if (!config.enabled || timer) return;
    timer = setInterval(() => {
      void scan();
    }, config.intervalMs);
    void scan();
    deps.logger?.info?.(
      { everyMs: config.intervalMs },
      'Watchdog loop started',
    );
  }

  function stop(): void {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  }

  return {
    scan,
    start,
    stop,
    getStatus: () => status,
  };
}

export function readWatchdogStatus(dataDir: string): WatchdogStatus {
  const filePath = statusPath(dataDir);
  const config = getWatchdogConfig();
  if (!fs.existsSync(filePath)) return emptyStatus(config.enabled);
  try {
    const parsed = safeReadJson(filePath) as Partial<WatchdogStatus> & {
      version?: number;
    };
    return {
      ...emptyStatus(config.enabled),
      ...parsed,
      enabled: config.enabled,
      incidentCounts: {
        ...emptyStatus(config.enabled).incidentCounts,
        ...(parsed.incidentCounts || {}),
      },
    };
  } catch {
    return {
      ...emptyStatus(config.enabled),
      latestIncident: {
        key: `watchdog-status:${filePath}`,
        kind: 'watchdog_error',
        severity: 'warn',
        action: 'alerted',
        message: 'Watchdog status file is unreadable',
        filePath,
        createdAt: new Date().toISOString(),
      },
    };
  }
}
