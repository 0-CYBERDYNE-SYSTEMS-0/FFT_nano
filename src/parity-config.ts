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

export interface SkillSelfImproveConfig {
  enabled: boolean;
  turnInterval: number;
  toolInterval: number;
  minIntervalMinutes: number;
}

export interface SkillManagerBackupConfig {
  enabled: boolean;
  keep: number;
}

export interface SkillManagerParityConfig {
  enabled: boolean;
  intervalHours: number;
  minIdleHours: number;
  staleAfterDays: number;
  archiveAfterDays: number;
  backup: SkillManagerBackupConfig;
}

export interface SkillsParityConfig {
  selfImprove: SkillSelfImproveConfig;
  curator: SkillManagerParityConfig;
}

export interface WorkspaceParityConfig {
  skipBootstrap: boolean;
  enforceBootstrapGate: boolean;
  enforceBootstrapGateForExisting: boolean;
  bootstrapMaxChars: number;
  bootstrapTotalMaxChars: number;
  enableBootMd: boolean;
}

export interface DoctorParityConfig {
  enabled: boolean;
}

export interface PromptParityConfig {
  cacheEnabled: boolean;
  persistLatestManifest: boolean;
  manifestPerRequestInDebugOnly: boolean;
  preflightRebaseEnabled: boolean;
  softTokenThreshold: number;
  hardTokenThreshold: number;
  skillCatalogMaxChars: number;
  recentConversationMaxMessages: number;
  recentConversationMaxChars: number;
}

export interface ParityConfig {
  memory: MemoryParityConfig;
  heartbeat: HeartbeatParityConfig;
  cron: CronParityConfig;
  skills: SkillsParityConfig;
  workspace: WorkspaceParityConfig;
  doctor: DoctorParityConfig;
  prompt: PromptParityConfig;
}

const DEFAULTS: ParityConfig = {
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
    every: '4h',
    prompt:
      'Read HEARTBEAT.md if it exists (workspace context). Follow it strictly. Do not infer or repeat old tasks from prior chats. If nothing needs attention, reply HEARTBEAT_OK.',
    target: 'main',
    to: null,
    accountId: null,
    includeReasoning: false,
    ackMaxChars: 300,
    activeHours: null,
    activeHoursRaw: null,
    visibility: { showOk: true, showAlerts: true, useIndicator: true },
  },
  cron: {
    isolatedDefaultDelivery: 'announce',
    deterministicTopOfHourStagger: { enabled: false, maxMs: 5 * 60_000 },
  },
  skills: {
    selfImprove: {
      enabled: true,
      turnInterval: 10,
      toolInterval: 10,
      minIntervalMinutes: 15,
    },
    curator: {
      enabled: true,
      intervalHours: 168,
      minIdleHours: 2,
      staleAfterDays: 30,
      archiveAfterDays: 90,
      backup: { enabled: true, keep: 5 },
    },
  },
  workspace: {
    skipBootstrap: false,
    enforceBootstrapGate: true,
    enforceBootstrapGateForExisting: false,
    bootstrapMaxChars: 20_000,
    bootstrapTotalMaxChars: 150_000,
    enableBootMd: false,
  },
  doctor: { enabled: true },
  prompt: {
    cacheEnabled: true,
    persistLatestManifest: true,
    manifestPerRequestInDebugOnly: true,
    preflightRebaseEnabled: true,
    softTokenThreshold: 120_000,
    hardTokenThreshold: 160_000,
    skillCatalogMaxChars: 20_000,
    recentConversationMaxMessages: 50,
    recentConversationMaxChars: 16_000,
  },
};

function envBool(value: string | undefined, fallback: boolean): boolean {
  if (typeof value !== 'string') return fallback;
  const v = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'off'].includes(v)) return false;
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

function clamp(value: unknown, fallback: number, min: number): number {
  return Math.max(min, Number(value) || fallback);
}

function sanitizeHeartbeatTarget(
  value: unknown,
  fallback: HeartbeatTargetMode,
): HeartbeatTargetMode {
  if (typeof value !== 'string') return fallback;
  const v = value.trim().toLowerCase();
  if (
    v === 'main' ||
    v === 'last' ||
    v === 'none' ||
    v === 'telegram' ||
    v === 'whatsapp' ||
    v === 'chat'
  ) {
    return v;
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

function sanitizeBackend(
  value: unknown,
  fallback: MemoryBackendKind,
): MemoryBackendKind {
  if (value === 'lexical') return value;
  return fallback;
}

function resolveDefaultParityConfigPath(): string {
  const home = process.env.HOME || os.homedir();
  const userPath = path.join(
    home,
    '.config',
    'fft_nano',
    'runtime.parity.json',
  );
  const repoPath = path.join(process.cwd(), 'config', 'runtime.parity.json');
  if (fs.existsSync(userPath)) return userPath;
  return repoPath;
}

function readJsonIfExists(filePath: string): Partial<ParityConfig> {
  try {
    if (!fs.existsSync(filePath)) return {};
    const parsed = JSON.parse(
      fs.readFileSync(filePath, 'utf-8'),
    ) as Partial<ParityConfig>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function mergeParityConfig(file: Partial<ParityConfig>): ParityConfig {
  const D = DEFAULTS;
  const f = file;
  const merged: ParityConfig = {
    memory: {
      ...D.memory,
      ...f.memory,
      flushBeforeCompaction: {
        ...D.memory.flushBeforeCompaction,
        ...f.memory?.flushBeforeCompaction,
      },
    },
    heartbeat: {
      ...D.heartbeat,
      ...f.heartbeat,
      activeHours:
        f.heartbeat?.activeHours === null
          ? null
          : f.heartbeat?.activeHours
            ? { ...D.heartbeat.activeHours, ...f.heartbeat.activeHours }
            : D.heartbeat.activeHours,
      visibility: { ...D.heartbeat.visibility, ...f.heartbeat?.visibility },
    },
    cron: {
      ...D.cron,
      ...f.cron,
      deterministicTopOfHourStagger: {
        ...D.cron.deterministicTopOfHourStagger,
        ...f.cron?.deterministicTopOfHourStagger,
      },
    },
    skills: {
      selfImprove: { ...D.skills.selfImprove, ...f.skills?.selfImprove },
      curator: {
        ...D.skills.curator,
        ...f.skills?.curator,
        backup: { ...D.skills.curator.backup, ...f.skills?.curator?.backup },
      },
    },
    workspace: { ...D.workspace, ...f.workspace },
    doctor: { ...D.doctor, ...f.doctor },
    prompt: { ...D.prompt, ...f.prompt },
  };

  merged.memory.backend = sanitizeBackend(merged.memory.backend, 'lexical');
  merged.memory.missingFileBehavior = sanitizeMissingBehavior(
    merged.memory.missingFileBehavior,
    'empty',
  );
  merged.heartbeat.target = sanitizeHeartbeatTarget(
    merged.heartbeat.target,
    'main',
  );
  merged.memory.flushBeforeCompaction.softThresholdTokens = clamp(
    merged.memory.flushBeforeCompaction.softThresholdTokens,
    4000,
    1,
  );
  merged.heartbeat.ackMaxChars = clamp(merged.heartbeat.ackMaxChars, 300, 0);
  merged.cron.deterministicTopOfHourStagger.maxMs = clamp(
    merged.cron.deterministicTopOfHourStagger.maxMs,
    300000,
    0,
  );
  merged.skills.selfImprove.turnInterval = clamp(
    merged.skills.selfImprove.turnInterval,
    10,
    1,
  );
  merged.skills.selfImprove.toolInterval = clamp(
    merged.skills.selfImprove.toolInterval,
    10,
    1,
  );
  merged.skills.selfImprove.minIntervalMinutes = clamp(
    merged.skills.selfImprove.minIntervalMinutes,
    15,
    0,
  );
  merged.skills.curator.intervalHours = clamp(
    merged.skills.curator.intervalHours,
    168,
    1,
  );
  merged.skills.curator.minIdleHours = clamp(
    merged.skills.curator.minIdleHours,
    2,
    0,
  );
  merged.skills.curator.staleAfterDays = clamp(
    merged.skills.curator.staleAfterDays,
    30,
    1,
  );
  merged.skills.curator.archiveAfterDays = Math.max(
    merged.skills.curator.staleAfterDays,
    clamp(merged.skills.curator.archiveAfterDays, 90, 1),
  );
  merged.skills.curator.backup.keep = clamp(
    merged.skills.curator.backup.keep,
    5,
    1,
  );
  merged.workspace.bootstrapMaxChars = clamp(
    merged.workspace.bootstrapMaxChars,
    20000,
    1000,
  );
  merged.workspace.bootstrapTotalMaxChars = Math.max(
    merged.workspace.bootstrapMaxChars,
    clamp(merged.workspace.bootstrapTotalMaxChars, 150000, 1000),
  );
  merged.prompt.softTokenThreshold = clamp(
    merged.prompt.softTokenThreshold,
    120_000,
    1,
  );
  merged.prompt.hardTokenThreshold = Math.max(
    merged.prompt.softTokenThreshold,
    clamp(merged.prompt.hardTokenThreshold, 160_000, 1),
  );
  merged.prompt.skillCatalogMaxChars = clamp(
    merged.prompt.skillCatalogMaxChars,
    20_000,
    500,
  );
  merged.prompt.recentConversationMaxMessages = clamp(
    merged.prompt.recentConversationMaxMessages,
    8,
    1,
  );
  merged.prompt.recentConversationMaxChars = clamp(
    merged.prompt.recentConversationMaxChars,
    4_000,
    200,
  );

  return merged;
}

function applyEnvOverrides(config: ParityConfig): ParityConfig {
  const c: ParityConfig = JSON.parse(JSON.stringify(config)) as ParityConfig;
  const e = process.env;

  const backend = e.FFT_NANO_MEMORY_BACKEND;
  if (backend)
    c.memory.backend = sanitizeBackend(
      backend.trim().toLowerCase(),
      c.memory.backend,
    );

  const missing = e.FFT_NANO_MEMORY_GET_MISSING;
  if (missing)
    c.memory.missingFileBehavior = sanitizeMissingBehavior(
      missing.trim().toLowerCase(),
      c.memory.missingFileBehavior,
    );

  c.memory.flushBeforeCompaction.enabled = envBool(
    e.FFT_NANO_MEMORY_FLUSH_ENABLED,
    c.memory.flushBeforeCompaction.enabled,
  );
  c.memory.flushBeforeCompaction.softThresholdTokens = envInt(
    e.FFT_NANO_MEMORY_FLUSH_SOFT_THRESHOLD_TOKENS,
    c.memory.flushBeforeCompaction.softThresholdTokens,
    1,
    2_000_000,
  );
  if (e.FFT_NANO_MEMORY_FLUSH_SYSTEM_PROMPT?.trim())
    c.memory.flushBeforeCompaction.systemPrompt =
      e.FFT_NANO_MEMORY_FLUSH_SYSTEM_PROMPT.trim();
  if (e.FFT_NANO_MEMORY_FLUSH_PROMPT?.trim())
    c.memory.flushBeforeCompaction.prompt =
      e.FFT_NANO_MEMORY_FLUSH_PROMPT.trim();

  c.heartbeat.enabled = envBool(
    e.FFT_NANO_HEARTBEAT_ENABLED,
    c.heartbeat.enabled,
  );
  if (e.FFT_NANO_HEARTBEAT_EVERY?.trim())
    c.heartbeat.every = e.FFT_NANO_HEARTBEAT_EVERY.trim();
  if (e.FFT_NANO_HEARTBEAT_PROMPT?.trim())
    c.heartbeat.prompt = e.FFT_NANO_HEARTBEAT_PROMPT.trim();
  if (e.FFT_NANO_HEARTBEAT_TARGET?.trim())
    c.heartbeat.target = sanitizeHeartbeatTarget(
      e.FFT_NANO_HEARTBEAT_TARGET.trim().toLowerCase(),
      c.heartbeat.target,
    );
  c.heartbeat.to = e.FFT_NANO_HEARTBEAT_TO?.trim() || c.heartbeat.to;
  c.heartbeat.accountId =
    e.FFT_NANO_HEARTBEAT_ACCOUNT_ID?.trim() || c.heartbeat.accountId;
  c.heartbeat.includeReasoning = envBool(
    e.FFT_NANO_HEARTBEAT_INCLUDE_REASONING,
    c.heartbeat.includeReasoning,
  );
  c.heartbeat.ackMaxChars = envInt(
    e.FFT_NANO_HEARTBEAT_ACK_MAX_CHARS,
    c.heartbeat.ackMaxChars,
    0,
    4000,
  );
  c.heartbeat.visibility.showOk = envBool(
    e.FFT_NANO_HEARTBEAT_SHOW_OK,
    c.heartbeat.visibility.showOk,
  );
  c.heartbeat.visibility.showAlerts = envBool(
    e.FFT_NANO_HEARTBEAT_SHOW_ALERTS,
    c.heartbeat.visibility.showAlerts,
  );
  c.heartbeat.visibility.useIndicator = envBool(
    e.FFT_NANO_HEARTBEAT_USE_INDICATOR,
    c.heartbeat.visibility.useIndicator,
  );

  const activeRaw = e.FFT_NANO_HEARTBEAT_ACTIVE_HOURS;
  if (typeof activeRaw === 'string')
    c.heartbeat.activeHoursRaw = activeRaw.trim() || null;

  if (e.FFT_NANO_CRON_ISOLATED_DEFAULT_DELIVERY?.trim()) {
    const mode = e.FFT_NANO_CRON_ISOLATED_DEFAULT_DELIVERY.trim().toLowerCase();
    if (mode === 'none' || mode === 'announce')
      c.cron.isolatedDefaultDelivery = mode;
  }
  c.cron.deterministicTopOfHourStagger.enabled = envBool(
    e.FFT_NANO_CRON_DETERMINISTIC_STAGGER,
    c.cron.deterministicTopOfHourStagger.enabled,
  );
  c.cron.deterministicTopOfHourStagger.maxMs = envInt(
    e.FFT_NANO_CRON_DETERMINISTIC_STAGGER_MAX_MS,
    c.cron.deterministicTopOfHourStagger.maxMs,
    0,
    3_600_000,
  );

  c.skills.selfImprove.enabled = envBool(
    e.FFT_NANO_SKILL_SELF_IMPROVE_ENABLED,
    c.skills.selfImprove.enabled,
  );
  c.skills.selfImprove.turnInterval = envInt(
    e.FFT_NANO_SKILL_SELF_IMPROVE_TURN_INTERVAL,
    c.skills.selfImprove.turnInterval,
    1,
    10_000,
  );
  c.skills.selfImprove.toolInterval = envInt(
    e.FFT_NANO_SKILL_SELF_IMPROVE_TOOL_INTERVAL,
    c.skills.selfImprove.toolInterval,
    1,
    10_000,
  );
  c.skills.selfImprove.minIntervalMinutes = envInt(
    e.FFT_NANO_SKILL_SELF_IMPROVE_MIN_INTERVAL_MINUTES,
    c.skills.selfImprove.minIntervalMinutes,
    0,
    100_000,
  );
  c.skills.curator.enabled = envBool(
    e.FFT_NANO_SKILL_CURATOR_ENABLED,
    c.skills.curator.enabled,
  );
  c.skills.curator.intervalHours = envInt(
    e.FFT_NANO_SKILL_CURATOR_INTERVAL_HOURS,
    c.skills.curator.intervalHours,
    1,
    100_000,
  );
  c.skills.curator.minIdleHours = envInt(
    e.FFT_NANO_SKILL_CURATOR_MIN_IDLE_HOURS,
    c.skills.curator.minIdleHours,
    0,
    100_000,
  );
  c.skills.curator.staleAfterDays = envInt(
    e.FFT_NANO_SKILL_CURATOR_STALE_AFTER_DAYS,
    c.skills.curator.staleAfterDays,
    1,
    100_000,
  );
  c.skills.curator.archiveAfterDays = envInt(
    e.FFT_NANO_SKILL_CURATOR_ARCHIVE_AFTER_DAYS,
    c.skills.curator.archiveAfterDays,
    c.skills.curator.staleAfterDays,
    100_000,
  );
  c.skills.curator.backup.enabled = envBool(
    e.FFT_NANO_SKILL_CURATOR_BACKUP_ENABLED,
    c.skills.curator.backup.enabled,
  );
  c.skills.curator.backup.keep = envInt(
    e.FFT_NANO_SKILL_CURATOR_BACKUP_KEEP,
    c.skills.curator.backup.keep,
    1,
    1000,
  );

  c.workspace.skipBootstrap = envBool(
    e.FFT_NANO_WORKSPACE_SKIP_BOOTSTRAP,
    c.workspace.skipBootstrap,
  );
  c.workspace.enforceBootstrapGate = envBool(
    e.FFT_NANO_WORKSPACE_ENFORCE_BOOTSTRAP_GATE,
    c.workspace.enforceBootstrapGate,
  );
  c.workspace.enforceBootstrapGateForExisting = envBool(
    e.FFT_NANO_WORKSPACE_ENFORCE_BOOTSTRAP_GATE_EXISTING,
    c.workspace.enforceBootstrapGateForExisting,
  );
  c.workspace.bootstrapMaxChars = envInt(
    e.FFT_NANO_WORKSPACE_BOOT_MAX_CHARS,
    c.workspace.bootstrapMaxChars,
    1000,
    200000,
  );
  c.workspace.bootstrapTotalMaxChars = envInt(
    e.FFT_NANO_WORKSPACE_BOOT_TOTAL_MAX_CHARS,
    c.workspace.bootstrapTotalMaxChars,
    c.workspace.bootstrapMaxChars,
    500000,
  );
  c.workspace.enableBootMd = envBool(
    e.FFT_NANO_WORKSPACE_ENABLE_BOOT_MD,
    c.workspace.enableBootMd,
  );

  c.doctor.enabled = envBool(e.FFT_NANO_DOCTOR_ENABLED, c.doctor.enabled);
  c.prompt.cacheEnabled = envBool(
    e.FFT_NANO_PROMPT_CACHE_ENABLED,
    c.prompt.cacheEnabled,
  );
  c.prompt.persistLatestManifest = envBool(
    e.FFT_NANO_PROMPT_PERSIST_LATEST_MANIFEST,
    c.prompt.persistLatestManifest,
  );
  c.prompt.manifestPerRequestInDebugOnly = envBool(
    e.FFT_NANO_PROMPT_MANIFEST_DEBUG_ONLY,
    c.prompt.manifestPerRequestInDebugOnly,
  );
  c.prompt.preflightRebaseEnabled = envBool(
    e.FFT_NANO_PROMPT_PREFLIGHT_REBASE_ENABLED,
    c.prompt.preflightRebaseEnabled,
  );
  c.prompt.softTokenThreshold = envInt(
    e.FFT_NANO_PROMPT_SOFT_TOKEN_THRESHOLD,
    c.prompt.softTokenThreshold,
    1,
    2_000_000,
  );
  c.prompt.hardTokenThreshold = envInt(
    e.FFT_NANO_PROMPT_HARD_TOKEN_THRESHOLD,
    c.prompt.hardTokenThreshold,
    c.prompt.softTokenThreshold,
    2_000_000,
  );
  c.prompt.skillCatalogMaxChars = envInt(
    e.FFT_NANO_SKILL_CATALOG_MAX_CHARS,
    c.prompt.skillCatalogMaxChars,
    500,
    200_000,
  );
  c.prompt.recentConversationMaxMessages = envInt(
    e.FFT_NANO_PROMPT_RECENT_CONVERSATION_MAX_MESSAGES,
    c.prompt.recentConversationMaxMessages,
    1,
    100,
  );
  c.prompt.recentConversationMaxChars = envInt(
    e.FFT_NANO_PROMPT_RECENT_CONVERSATION_MAX_CHARS,
    c.prompt.recentConversationMaxChars,
    200,
    200_000,
  );

  return c;
}

export const PARITY_CONFIG_PATH = path.resolve(
  process.env.FFT_NANO_PARITY_CONFIG_PATH || resolveDefaultParityConfigPath(),
);
export const PARITY_CONFIG: ParityConfig = applyEnvOverrides(
  mergeParityConfig(readJsonIfExists(PARITY_CONFIG_PATH)),
);
