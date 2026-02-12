import path from 'path';

export const ASSISTANT_NAME = process.env.ASSISTANT_NAME || 'FarmFriend';
export const POLL_INTERVAL = 2000;
export const SCHEDULER_POLL_INTERVAL = 60000;

// Absolute paths needed for container mounts
const PROJECT_ROOT = process.cwd();
const HOME_DIR = process.env.HOME || '/Users/user';

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

export const TRIGGER_PATTERN = new RegExp(
  `^@${escapeRegex(ASSISTANT_NAME)}\\b`,
  'i',
);

// Timezone for scheduled tasks (cron expressions, etc.)
// Uses system timezone by default
export const TIMEZONE =
  process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;
