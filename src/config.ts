import path from 'path';

export const ASSISTANT_NAME = process.env.ASSISTANT_NAME || 'FarmFriend';
export const POLL_INTERVAL = 2000;
export const SCHEDULER_POLL_INTERVAL = 60000;
export const SCHEDULER_MODE =
  (process.env.FFT_NANO_SCHEDULER_MODE || 'v2').trim().toLowerCase() === 'legacy'
    ? 'legacy'
    : 'v2';

// Absolute paths needed for container mounts
const PROJECT_ROOT = process.cwd();
const HOME_DIR = process.env.HOME || '/Users/user';

function expandHomePath(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return HOME_DIR;
  if (trimmed === '~') return HOME_DIR;
  if (trimmed.startsWith('~/')) return path.join(HOME_DIR, trimmed.slice(2));
  return trimmed;
}

// Mount security: allowlist stored OUTSIDE project root, never mounted into containers
export const MOUNT_ALLOWLIST_PATH = path.join(
  HOME_DIR,
  '.config',
  'fft_nano',
  'mount-allowlist.json',
);
export const STORE_DIR = path.resolve(PROJECT_ROOT, 'store');
export const GROUPS_DIR = path.resolve(PROJECT_ROOT, 'groups');
export const DATA_DIR = path.resolve(PROJECT_ROOT, 'data');
export const MAIN_GROUP_FOLDER = 'main';
export const MAIN_WORKSPACE_DIR = path.resolve(
  expandHomePath(process.env.FFT_NANO_MAIN_WORKSPACE_DIR || '~/nano'),
);
export const FARM_STATE_ENABLED = envFlag(process.env.FARM_STATE_ENABLED, false);
export const FARM_MODE = (process.env.FARM_MODE || 'demo').trim().toLowerCase();
export const FARM_STATE_DIR = path.resolve(DATA_DIR, 'farm-state');
export const FARM_PROFILE_PATH = path.resolve(
  expandHomePath(process.env.FARM_PROFILE_PATH || path.join(DATA_DIR, 'farm-profile.json')),
);
export const FARM_STATE_FAST_MS = envInt(
  process.env.FARM_STATE_FAST_MS,
  15000,
  5000,
  60000,
);
export const FARM_STATE_MEDIUM_MS = envInt(
  process.env.FARM_STATE_MEDIUM_MS,
  120000,
  30000,
  600000,
);
export const FARM_STATE_SLOW_MS = envInt(
  process.env.FARM_STATE_SLOW_MS,
  900000,
  300000,
  3600000,
);
export const HA_URL = process.env.HA_URL || 'http://localhost:8123';
export const HA_TOKEN = process.env.HA_TOKEN || '';
export const FFT_DASHBOARD_REPO_PATH = process.env.FFT_DASHBOARD_REPO_PATH || '';

export const CONTAINER_IMAGE =
  process.env.CONTAINER_IMAGE || 'fft-nano-agent:latest';
export const CONTAINER_TIMEOUT = parseInt(
  process.env.CONTAINER_TIMEOUT || '300000',
  10,
);
export const CONTAINER_MAX_OUTPUT_SIZE = parseInt(
  process.env.CONTAINER_MAX_OUTPUT_SIZE || '10485760',
  10,
); // 10MB default
export const IPC_POLL_INTERVAL = 1000;
export const TELEGRAM_MEDIA_MAX_MB = Math.max(
  1,
  parseInt(process.env.TELEGRAM_MEDIA_MAX_MB || '20', 10),
);

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

export const MEMORY_RETRIEVAL_GATE_ENABLED = envFlag(
  process.env.MEMORY_RETRIEVAL_GATE_ENABLED,
  true,
);
export const MEMORY_TOP_K = envInt(process.env.MEMORY_TOP_K, 8, 1, 32);
export const MEMORY_CONTEXT_CHAR_BUDGET = envInt(
  process.env.MEMORY_CONTEXT_CHAR_BUDGET,
  6000,
  1000,
  50000,
);

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const aliasEnv = process.env.ASSISTANT_ALIASES || '';
const parsedAliases = aliasEnv
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const defaultAliases = ['F-15'];

export const ASSISTANT_TRIGGER_ALIASES = Array.from(
  new Set([ASSISTANT_NAME, ...defaultAliases, ...parsedAliases]),
);

export const TRIGGER_PATTERN = new RegExp(
  `^(?:${ASSISTANT_TRIGGER_ALIASES.map(
    (name) => `@${escapeRegex(name)}\\b`,
  ).join('|')})`,
  'i',
);

// Timezone for scheduled tasks (cron expressions, etc.)
// Uses system timezone by default
export const TIMEZONE =
  process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;
