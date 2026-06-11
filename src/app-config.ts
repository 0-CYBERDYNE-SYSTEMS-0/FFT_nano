import fs from 'fs';
import os from 'os';
import path from 'path';

import { PARITY_CONFIG, PARITY_CONFIG_PATH } from './parity-config.js';

// ── Profile detection ─────────────────────────────────────────────────────────

export type FFTProfile = 'core' | 'farm';

export interface ProfileDetection {
  source: 'env' | 'auto_preserve' | 'default';
  reason: string;
}

function parseBool(value: string | undefined): boolean | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return null;
}

function normalizeProfile(value: string | undefined): FFTProfile | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'core' || normalized === 'farm') return normalized;
  return null;
}

function hasFarmEnvSignals(env: NodeJS.ProcessEnv): string[] {
  const reasons: string[] = [];
  const farmEnabled = parseBool(env.FARM_STATE_ENABLED);
  const featureFarm = parseBool(env.FEATURE_FARM);

  if (farmEnabled === true) reasons.push('FARM_STATE_ENABLED=true');
  if (featureFarm === true) reasons.push('FEATURE_FARM=true');
  if ((env.FARM_PROFILE_PATH || '').trim())
    reasons.push('FARM_PROFILE_PATH set');
  if ((env.FFT_DASHBOARD_REPO_PATH || '').trim())
    reasons.push('FFT_DASHBOARD_REPO_PATH set');
  if ((env.HA_TOKEN || '').trim()) reasons.push('HA_TOKEN set');

  return reasons;
}

function hasFarmArtifacts(projectRoot: string): string[] {
  const reasons: string[] = [];
  const checks = [
    {
      path: path.join(projectRoot, 'data', 'farm-profile.json'),
      reason: 'data/farm-profile.json exists',
    },
    {
      path: path.join(projectRoot, 'data', 'farm-state', 'current.json'),
      reason: 'data/farm-state/current.json exists',
    },
    {
      path: path.join(projectRoot, 'data', 'farm-state', 'telemetry.ndjson'),
      reason: 'data/farm-state/telemetry.ndjson exists',
    },
  ];
  for (const check of checks) {
    if (fs.existsSync(check.path)) reasons.push(check.reason);
  }
  return reasons;
}

function resolveProfile(): {
  profile: FFTProfile;
  detection: ProfileDetection;
} {
  const explicit = normalizeProfile(process.env.FFT_PROFILE);
  if (explicit) {
    return {
      profile: explicit,
      detection: { source: 'env', reason: `FFT_PROFILE=${explicit}` },
    };
  }

  const projectRoot = process.cwd();
  const reasons = [
    ...hasFarmEnvSignals(process.env),
    ...hasFarmArtifacts(projectRoot),
  ];

  if (reasons.length > 0) {
    return {
      profile: 'farm',
      detection: { source: 'auto_preserve', reason: reasons.join('; ') },
    };
  }

  return {
    profile: 'core',
    detection: {
      source: 'default',
      reason: 'no farm env or artifacts detected',
    },
  };
}

const _profileResolution = resolveProfile();
const _featureFarmOverride = parseBool(process.env.FEATURE_FARM);

export const FFT_PROFILE: FFTProfile = _profileResolution.profile;
export const PROFILE_DETECTION: ProfileDetection = _profileResolution.detection;
export const FEATURE_FARM: boolean =
  _featureFarmOverride ?? FFT_PROFILE === 'farm';

// ── Core config ───────────────────────────────────────────────────────────────

const DEFAULT_ASSISTANT_NAME =
  FFT_PROFILE === 'farm' ? 'FarmFriend' : 'fft_nano';

export const ASSISTANT_NAME =
  process.env.ASSISTANT_NAME || DEFAULT_ASSISTANT_NAME;
export const POLL_INTERVAL = 2000;
export const SCHEDULER_POLL_INTERVAL = 60000;
export const SCHEDULER_MODE =
  (process.env.FFT_NANO_SCHEDULER_MODE || 'v2').trim().toLowerCase() ===
  'legacy'
    ? 'legacy'
    : 'v2';

const PROJECT_ROOT = process.cwd();
const HOME_DIR = process.env.HOME || os.homedir();

function expandHomePath(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return HOME_DIR;
  if (trimmed === '~') return HOME_DIR;
  if (trimmed.startsWith('~/')) return path.join(HOME_DIR, trimmed.slice(2));
  return trimmed;
}

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

export const FARM_STATE_ENABLED =
  FEATURE_FARM &&
  envFlag(process.env.FARM_STATE_ENABLED, FFT_PROFILE === 'farm');
export const FARM_MODE = (process.env.FARM_MODE || 'demo').trim().toLowerCase();
export const FARM_STATE_DIR = path.resolve(DATA_DIR, 'farm-state');
export const FARM_PROFILE_PATH = path.resolve(
  expandHomePath(
    process.env.FARM_PROFILE_PATH || path.join(DATA_DIR, 'farm-profile.json'),
  ),
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
export const HA_URL_CANDIDATES = parseHaUrlCandidates(
  HA_URL,
  process.env.HA_URL_CANDIDATES,
);
export const HA_TOKEN = process.env.HA_TOKEN || '';
export const FFT_DASHBOARD_REPO_PATH =
  process.env.FFT_DASHBOARD_REPO_PATH || '';

export const CONTAINER_IMAGE =
  process.env.CONTAINER_IMAGE || 'fft-nano-agent:latest';
const DEFAULT_CONTAINER_TIMEOUT_MS = 6 * 60 * 60 * 1000;
export const CONTAINER_TIMEOUT = parseInt(
  process.env.CONTAINER_TIMEOUT || String(DEFAULT_CONTAINER_TIMEOUT_MS),
  10,
);
export const IDLE_TIMEOUT = parseInt(
  process.env.IDLE_TIMEOUT ||
    process.env.CONTAINER_TIMEOUT ||
    String(DEFAULT_CONTAINER_TIMEOUT_MS),
  10,
);
export const CONTAINER_MAX_OUTPUT_SIZE = parseInt(
  process.env.CONTAINER_MAX_OUTPUT_SIZE || '10485760',
  10,
);
export const IPC_POLL_INTERVAL = 1000;
export const TELEGRAM_MEDIA_MAX_MB = Math.max(
  1,
  parseInt(process.env.TELEGRAM_MEDIA_MAX_MB || '20', 10),
);
export const FFT_NANO_TELEGRAM_GROUP_EDIT_INTERVAL_MS = parseInt(
  process.env.FFT_NANO_TELEGRAM_GROUP_EDIT_INTERVAL_MS || '3000',
  10,
);
export const FFT_NANO_TELEGRAM_HEARTBEAT_MS = parseInt(
  process.env.FFT_NANO_TELEGRAM_HEARTBEAT_MS || '30000',
  10,
);
export type WebAccessMode = 'localhost' | 'lan' | 'remote';

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

function parseWebAccessMode(value: string | undefined): WebAccessMode {
  const normalized = (value || 'localhost').trim().toLowerCase();
  if (normalized === 'lan') return 'lan';
  if (normalized === 'remote') return 'remote';
  return 'localhost';
}

function resolveWebHost(accessMode: WebAccessMode): string {
  const explicit = (process.env.FFT_NANO_WEB_HOST || '').trim();
  if (explicit) return explicit;
  if (accessMode === 'localhost') return '127.0.0.1';
  return '0.0.0.0';
}

function resolveTuiHost(accessMode: WebAccessMode): string {
  const explicit = (process.env.FFT_NANO_TUI_HOST || '').trim();
  if (explicit) return explicit;
  if (accessMode === 'localhost') return '127.0.0.1';
  return '0.0.0.0';
}

function normalizeUrlCandidate(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.replace(/\/$/, '');
}

function parseHaUrlCandidates(primaryUrl: string, rawList?: string): string[] {
  const fallbacks = ['http://localhost:8123', 'http://192.168.64.1:8123'];
  const explicit =
    rawList
      ?.split(',')
      .map((entry) => normalizeUrlCandidate(entry))
      .filter((entry): entry is string => Boolean(entry)) || [];
  const ordered = [primaryUrl, ...explicit, ...fallbacks]
    .map((entry) => normalizeUrlCandidate(entry))
    .filter((entry): entry is string => Boolean(entry));
  return Array.from(new Set(ordered));
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

// Semantic memory: opt-in re-ranking of lexical candidates by embedding
// similarity from a LOCAL Ollama embedding model. Default off so the live
// service is unchanged; when on but the embedder is unavailable, retrieval
// falls back to pure lexical (no behavior change, no external API).
export const MEMORY_SEMANTIC_ENABLED = envFlag(
  process.env.MEMORY_SEMANTIC_ENABLED,
  false,
);
export const MEMORY_SEMANTIC_MODEL = (
  process.env.MEMORY_SEMANTIC_MODEL || 'nomic-embed-text'
).trim();
export const MEMORY_SEMANTIC_WEIGHT = (() => {
  const parsed = Number.parseFloat(process.env.MEMORY_SEMANTIC_WEIGHT || '');
  if (!Number.isFinite(parsed)) return 0.5;
  return Math.min(1, Math.max(0, parsed));
})();
export const MEMORY_SEMANTIC_CANDIDATES = envInt(
  process.env.MEMORY_SEMANTIC_CANDIDATES,
  24,
  4,
  128,
);
// Hard wall-clock budget (ms) for blocking embed calls per query. The embedder
// runs synchronously on the message path, so this bounds how long a single
// retrieval can stall the host even with a reachable-but-slow Ollama; once
// spent, remaining candidates fall back to lexical-only scoring.
export const MEMORY_SEMANTIC_QUERY_BUDGET_MS = envInt(
  process.env.MEMORY_SEMANTIC_QUERY_BUDGET_MS,
  1500,
  100,
  30000,
);
export const OLLAMA_BASE_URL = (
  process.env.OLLAMA_BASE_URL || 'http://localhost:11434'
).trim();

export const FFT_NANO_WEB_ACCESS_MODE = parseWebAccessMode(
  process.env.FFT_NANO_WEB_ACCESS_MODE,
);
export const FFT_NANO_WEB_ENABLED = envFlag(
  process.env.FFT_NANO_WEB_ENABLED,
  true,
);
export const FFT_NANO_WEB_PORT = envInt(
  process.env.FFT_NANO_WEB_PORT,
  28990,
  1,
  65535,
);
export const FFT_NANO_WEB_HOST = resolveWebHost(FFT_NANO_WEB_ACCESS_MODE);
export const FFT_NANO_WEB_AUTH_TOKEN = (
  process.env.FFT_NANO_WEB_AUTH_TOKEN || ''
).trim();
export const FFT_NANO_WEB_STATIC_DIR = path.resolve(
  PROJECT_ROOT,
  'dist-web',
  'control-center',
);

export const FFT_NANO_TUI_ENABLED = envFlag(
  process.env.FFT_NANO_TUI_ENABLED,
  true,
);
export const FFT_NANO_TUI_LOCAL = envFlag(
  process.env.FFT_NANO_TUI_LOCAL,
  false,
);
export const FFT_NANO_TUI_PORT = envInt(
  process.env.FFT_NANO_TUI_PORT,
  28989,
  1,
  65535,
);
export const FFT_NANO_TUI_HOST = resolveTuiHost(FFT_NANO_WEB_ACCESS_MODE);
export const FFT_NANO_TUI_AUTH_TOKEN = (
  process.env.FFT_NANO_TUI_AUTH_TOKEN || FFT_NANO_WEB_AUTH_TOKEN
).trim();
export const FFT_NANO_ONBOARDING_MODE = envFlag(
  process.env.FFT_NANO_ONBOARDING_MODE,
  false,
);

export type CoderGateMode = 'explicit' | 'autosuggest';
export const FFT_NANO_CODER_GATE_MODE: CoderGateMode =
  (process.env.FFT_NANO_CODER_GATE_MODE || 'explicit').trim().toLowerCase() ===
  'autosuggest'
    ? 'autosuggest'
    : 'explicit';

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const aliasEnv = process.env.ASSISTANT_ALIASES || '';
const parsedAliases = aliasEnv
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const defaultAliases = FFT_PROFILE === 'farm' ? ['F-15'] : [];

export const ASSISTANT_TRIGGER_ALIASES = Array.from(
  new Set([ASSISTANT_NAME, ...defaultAliases, ...parsedAliases]),
);

export const TRIGGER_PATTERN = new RegExp(
  `^(?:${ASSISTANT_TRIGGER_ALIASES.map((name) => `@${escapeRegex(name)}\\b`).join('|')})`,
  'i',
);

export const TIMEZONE =
  process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;

export const FFT_NANO_MAX_RETRIES = envInt(
  process.env.FFT_NANO_MAX_RETRIES,
  3,
  1,
  5,
);
export const FFT_NANO_RETRY_BASE_DELAY_MS = envInt(
  process.env.FFT_NANO_RETRY_BASE_DELAY_MS,
  2000,
  500,
  60000,
);
export const FFT_NANO_RETRY_MAX_DELAY_MS = envInt(
  process.env.FFT_NANO_RETRY_MAX_DELAY_MS,
  30000,
  1000,
  120000,
);
export const FFT_NANO_JITTER_FACTOR = (() => {
  const raw = process.env.FFT_NANO_JITTER_FACTOR;
  const parsed = Number.parseFloat(raw || '');
  if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) return parsed;
  return 0.3;
})();
export const FFT_NANO_PROVIDER_FALLBACK_ORDER = (() => {
  const raw = process.env.FFT_NANO_PROVIDER_FALLBACK_ORDER || '';
  return raw
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
})();
export const FFT_NANO_PROVIDER_FALLBACK_ENABLED = envFlag(
  process.env.FFT_NANO_PROVIDER_FALLBACK_ENABLED,
  true,
);

export { PARITY_CONFIG, PARITY_CONFIG_PATH };
