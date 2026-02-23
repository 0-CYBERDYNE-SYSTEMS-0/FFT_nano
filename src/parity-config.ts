import fs from 'fs';
import os from 'os';
import path from 'path';

export type MemoryBackendKind = 'lexical';
export type MemoryMissingFileBehavior = 'error' | 'empty';
export type HeartbeatTargetMode =
  | 'main'
  | 'last'
  | 'none'
  | 'telegram'
  | 'whatsapp'
  | 'chat';
export type HeartbeatTimezoneMode = 'user' | 'local' | string;

export interface MemoryFlushConfig {
  enabled: boolean;
  softThresholdTokens: number;
  systemPrompt: string;
  prompt: string;
}

export interface MemoryParityConfig {
  backend: MemoryBackendKind;
  missingFileBehavior: MemoryMissingFileBehavior;
  flushBeforeCompaction: MemoryFlushConfig;
}

export interface HeartbeatActiveHoursConfig {
  start: string;
  end: string;
  timezone: HeartbeatTimezoneMode;
}

export interface HeartbeatVisibilityConfig {
  showOk: boolean;
  showAlerts: boolean;
  useIndicator: boolean;
}

export interface HeartbeatParityConfig {
  enabled: boolean;
  every: string;
  prompt: string;
  target: HeartbeatTargetMode;
  to: string | null;
  accountId: string | null;
  includeReasoning: boolean;
  ackMaxChars: number;
  activeHours: HeartbeatActiveHoursConfig | null;
  activeHoursRaw: string | null;
  visibility: HeartbeatVisibilityConfig;
}

export interface CronDeterministicStaggerConfig {
  enabled: boolean;
  maxMs: number;
}

export interface CronParityConfig {
  isolatedDefaultDelivery: 'none' | 'announce';
  deterministicTopOfHourStagger: CronDeterministicStaggerConfig;
}

export interface WorkspaceParityConfig {
  skipBootstrap: boolean;
  bootstrapMaxChars: number;
  bootstrapTotalMaxChars: number;
  enableBootMd: boolean;
}

export interface DoctorParityConfig {
  enabled: boolean;
}

export interface ParityConfig {
  memory: MemoryParityConfig;
  heartbeat: HeartbeatParityConfig;
  cron: CronParityConfig;
  workspace: WorkspaceParityConfig;
  doctor: DoctorParityConfig;
}

const DEFAULT_PARITY_CONFIG: ParityConfig = {
  memory: {
    backend: 'lexical',
    missingFileBehavior: 'empty',
    flushBeforeCompaction: {
      enabled: false,
      softThresholdTokens: 4000,
      systemPrompt:
        'Session nearing compaction. Store durable memories to markdown files before summary rollover.',
      prompt:
        'Write durable updates to MEMORY.md and memory/YYYY-MM-DD.md if needed. Reply NO_REPLY when nothing should be stored.',
    },
  },
  heartbeat: {
    enabled: true,
    every: '30m',
    prompt:
      'Read HEARTBEAT.md if it exists (workspace context). Follow it strictly. Do not infer or repeat old tasks from prior chats. If nothing needs attention, reply HEARTBEAT_OK.',
    target: 'main',
    to: null,
    accountId: null,
    includeReasoning: false,
    ackMaxChars: 300,
    activeHours: null,
    activeHoursRaw: null,
    visibility: {
      showOk: false,
      showAlerts: true,
      useIndicator: true,
    },
  },
  cron: {
    isolatedDefaultDelivery: 'announce',
    deterministicTopOfHourStagger: {
      enabled: false,
      maxMs: 5 * 60_000,
    },
  },
  workspace: {
    skipBootstrap: false,
    bootstrapMaxChars: 20_000,
    bootstrapTotalMaxChars: 150_000,
    enableBootMd: false,
  },
  doctor: {
    enabled: true,
  },
};

function envBool(value: string | undefined, fallback: boolean): boolean {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function envInt(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number.parseInt(value || '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function resolveDefaultParityConfigPath(): string {
  const home = process.env.HOME || os.homedir();
  const userPath = path.join(home, '.config', 'fft_nano', 'runtime.parity.json');
  const repoPath = path.join(process.cwd(), 'config', 'runtime.parity.json');
  if (fs.existsSync(userPath)) return userPath;
  return repoPath;
}

function readJsonIfExists(filePath: string): Partial<ParityConfig> {
  try {
    if (!fs.existsSync(filePath)) return {};
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<ParityConfig>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function sanitizeHeartbeatTarget(value: unknown, fallback: HeartbeatTargetMode): HeartbeatTargetMode {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toLowerCase();
  if (
    normalized === 'main' ||
    normalized === 'last' ||
    normalized === 'none' ||
    normalized === 'telegram' ||
    normalized === 'whatsapp' ||
    normalized === 'chat'
  ) {
    return normalized;
  }
  return fallback;
}

function sanitizeMissingBehavior(
  value: unknown,
  fallback: MemoryMissingFileBehavior,
): MemoryMissingFileBehavior {
  if (value === 'error' || value === 'empty') return value;
  return fallback;
}

function sanitizeBackend(value: unknown, fallback: MemoryBackendKind): MemoryBackendKind {
  if (value === 'lexical') return value;
  return fallback;
}

function mergeParityConfig(fileConfig: Partial<ParityConfig>): ParityConfig {
  const merged: ParityConfig = {
    memory: {
      ...DEFAULT_PARITY_CONFIG.memory,
      ...(fileConfig.memory || {}),
      flushBeforeCompaction: {
        ...DEFAULT_PARITY_CONFIG.memory.flushBeforeCompaction,
        ...(fileConfig.memory?.flushBeforeCompaction || {}),
      },
    },
    heartbeat: {
      ...DEFAULT_PARITY_CONFIG.heartbeat,
      ...(fileConfig.heartbeat || {}),
      activeHours:
        fileConfig.heartbeat?.activeHours === null
          ? null
          : fileConfig.heartbeat?.activeHours
            ? {
                ...DEFAULT_PARITY_CONFIG.heartbeat.activeHours,
                ...fileConfig.heartbeat.activeHours,
              }
            : DEFAULT_PARITY_CONFIG.heartbeat.activeHours,
      visibility: {
        ...DEFAULT_PARITY_CONFIG.heartbeat.visibility,
        ...(fileConfig.heartbeat?.visibility || {}),
      },
    },
    cron: {
      ...DEFAULT_PARITY_CONFIG.cron,
      ...(fileConfig.cron || {}),
      deterministicTopOfHourStagger: {
        ...DEFAULT_PARITY_CONFIG.cron.deterministicTopOfHourStagger,
        ...(fileConfig.cron?.deterministicTopOfHourStagger || {}),
      },
    },
    workspace: {
      ...DEFAULT_PARITY_CONFIG.workspace,
      ...(fileConfig.workspace || {}),
    },
    doctor: {
      ...DEFAULT_PARITY_CONFIG.doctor,
      ...(fileConfig.doctor || {}),
    },
  };

  merged.memory.backend = sanitizeBackend(merged.memory.backend, 'lexical');
  merged.memory.missingFileBehavior = sanitizeMissingBehavior(
    merged.memory.missingFileBehavior,
    'empty',
  );
  merged.heartbeat.target = sanitizeHeartbeatTarget(merged.heartbeat.target, 'main');
  merged.memory.flushBeforeCompaction.softThresholdTokens = Math.max(
    1,
    Number(merged.memory.flushBeforeCompaction.softThresholdTokens) || 4000,
  );
  merged.heartbeat.ackMaxChars = Math.max(0, Number(merged.heartbeat.ackMaxChars) || 300);
  merged.cron.deterministicTopOfHourStagger.maxMs = Math.max(
    0,
    Number(merged.cron.deterministicTopOfHourStagger.maxMs) || 300000,
  );
  merged.workspace.bootstrapMaxChars = Math.max(1000, Number(merged.workspace.bootstrapMaxChars) || 20000);
  merged.workspace.bootstrapTotalMaxChars = Math.max(
    merged.workspace.bootstrapMaxChars,
    Number(merged.workspace.bootstrapTotalMaxChars) || 150000,
  );

  return merged;
}

function applyEnvOverrides(config: ParityConfig): ParityConfig {
  const next: ParityConfig = JSON.parse(JSON.stringify(config)) as ParityConfig;

  const backend = process.env.FFT_NANO_MEMORY_BACKEND;
  if (backend) next.memory.backend = sanitizeBackend(backend.trim().toLowerCase(), next.memory.backend);

  const missing = process.env.FFT_NANO_MEMORY_GET_MISSING;
  if (missing) {
    next.memory.missingFileBehavior = sanitizeMissingBehavior(
      missing.trim().toLowerCase(),
      next.memory.missingFileBehavior,
    );
  }
  next.memory.flushBeforeCompaction.enabled = envBool(
    process.env.FFT_NANO_MEMORY_FLUSH_ENABLED,
    next.memory.flushBeforeCompaction.enabled,
  );
  next.memory.flushBeforeCompaction.softThresholdTokens = envInt(
    process.env.FFT_NANO_MEMORY_FLUSH_SOFT_THRESHOLD_TOKENS,
    next.memory.flushBeforeCompaction.softThresholdTokens,
    1,
    2_000_000,
  );
  if (process.env.FFT_NANO_MEMORY_FLUSH_SYSTEM_PROMPT?.trim()) {
    next.memory.flushBeforeCompaction.systemPrompt =
      process.env.FFT_NANO_MEMORY_FLUSH_SYSTEM_PROMPT.trim();
  }
  if (process.env.FFT_NANO_MEMORY_FLUSH_PROMPT?.trim()) {
    next.memory.flushBeforeCompaction.prompt = process.env.FFT_NANO_MEMORY_FLUSH_PROMPT.trim();
  }

  next.heartbeat.enabled = envBool(
    process.env.FFT_NANO_HEARTBEAT_ENABLED,
    next.heartbeat.enabled,
  );
  if (process.env.FFT_NANO_HEARTBEAT_EVERY?.trim()) {
    next.heartbeat.every = process.env.FFT_NANO_HEARTBEAT_EVERY.trim();
  }
  if (process.env.FFT_NANO_HEARTBEAT_PROMPT?.trim()) {
    next.heartbeat.prompt = process.env.FFT_NANO_HEARTBEAT_PROMPT.trim();
  }
  if (process.env.FFT_NANO_HEARTBEAT_TARGET?.trim()) {
    next.heartbeat.target = sanitizeHeartbeatTarget(
      process.env.FFT_NANO_HEARTBEAT_TARGET.trim().toLowerCase(),
      next.heartbeat.target,
    );
  }
  next.heartbeat.to = process.env.FFT_NANO_HEARTBEAT_TO?.trim() || next.heartbeat.to;
  next.heartbeat.accountId =
    process.env.FFT_NANO_HEARTBEAT_ACCOUNT_ID?.trim() || next.heartbeat.accountId;
  next.heartbeat.includeReasoning = envBool(
    process.env.FFT_NANO_HEARTBEAT_INCLUDE_REASONING,
    next.heartbeat.includeReasoning,
  );
  next.heartbeat.ackMaxChars = envInt(
    process.env.FFT_NANO_HEARTBEAT_ACK_MAX_CHARS,
    next.heartbeat.ackMaxChars,
    0,
    4000,
  );
  next.heartbeat.visibility.showOk = envBool(
    process.env.FFT_NANO_HEARTBEAT_SHOW_OK,
    next.heartbeat.visibility.showOk,
  );
  next.heartbeat.visibility.showAlerts = envBool(
    process.env.FFT_NANO_HEARTBEAT_SHOW_ALERTS,
    next.heartbeat.visibility.showAlerts,
  );
  next.heartbeat.visibility.useIndicator = envBool(
    process.env.FFT_NANO_HEARTBEAT_USE_INDICATOR,
    next.heartbeat.visibility.useIndicator,
  );

  const activeRaw = process.env.FFT_NANO_HEARTBEAT_ACTIVE_HOURS;
  if (typeof activeRaw === 'string') {
    next.heartbeat.activeHoursRaw = activeRaw.trim() || null;
  }

  if (process.env.FFT_NANO_CRON_ISOLATED_DEFAULT_DELIVERY?.trim()) {
    const mode = process.env.FFT_NANO_CRON_ISOLATED_DEFAULT_DELIVERY.trim().toLowerCase();
    if (mode === 'none' || mode === 'announce') {
      next.cron.isolatedDefaultDelivery = mode;
    }
  }
  next.cron.deterministicTopOfHourStagger.enabled = envBool(
    process.env.FFT_NANO_CRON_DETERMINISTIC_STAGGER,
    next.cron.deterministicTopOfHourStagger.enabled,
  );
  next.cron.deterministicTopOfHourStagger.maxMs = envInt(
    process.env.FFT_NANO_CRON_DETERMINISTIC_STAGGER_MAX_MS,
    next.cron.deterministicTopOfHourStagger.maxMs,
    0,
    3_600_000,
  );

  next.workspace.skipBootstrap = envBool(
    process.env.FFT_NANO_WORKSPACE_SKIP_BOOTSTRAP,
    next.workspace.skipBootstrap,
  );
  next.workspace.bootstrapMaxChars = envInt(
    process.env.FFT_NANO_WORKSPACE_BOOT_MAX_CHARS,
    next.workspace.bootstrapMaxChars,
    1000,
    200000,
  );
  next.workspace.bootstrapTotalMaxChars = envInt(
    process.env.FFT_NANO_WORKSPACE_BOOT_TOTAL_MAX_CHARS,
    next.workspace.bootstrapTotalMaxChars,
    next.workspace.bootstrapMaxChars,
    500000,
  );
  next.workspace.enableBootMd = envBool(
    process.env.FFT_NANO_WORKSPACE_ENABLE_BOOT_MD,
    next.workspace.enableBootMd,
  );

  next.doctor.enabled = envBool(process.env.FFT_NANO_DOCTOR_ENABLED, next.doctor.enabled);
  return next;
}

export const PARITY_CONFIG_PATH = path.resolve(
  process.env.FFT_NANO_PARITY_CONFIG_PATH || resolveDefaultParityConfigPath(),
);
const configFromFile = readJsonIfExists(PARITY_CONFIG_PATH);
export const PARITY_CONFIG: ParityConfig = applyEnvOverrides(
  mergeParityConfig(configFromFile),
);
