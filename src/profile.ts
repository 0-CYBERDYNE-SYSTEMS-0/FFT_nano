import fs from 'fs';
import path from 'path';

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
  if ((env.FARM_PROFILE_PATH || '').trim()) reasons.push('FARM_PROFILE_PATH set');
  if ((env.FFT_DASHBOARD_REPO_PATH || '').trim()) reasons.push('FFT_DASHBOARD_REPO_PATH set');
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

function resolveProfile(): { profile: FFTProfile; detection: ProfileDetection } {
  const explicit = normalizeProfile(process.env.FFT_PROFILE);
  if (explicit) {
    return {
      profile: explicit,
      detection: { source: 'env', reason: `FFT_PROFILE=${explicit}` },
    };
  }

  const projectRoot = process.cwd();
  const envReasons = hasFarmEnvSignals(process.env);
  const artifactReasons = hasFarmArtifacts(projectRoot);
  const reasons = [...envReasons, ...artifactReasons];

  if (reasons.length > 0) {
    return {
      profile: 'farm',
      detection: {
        source: 'auto_preserve',
        reason: reasons.join('; '),
      },
    };
  }

  return {
    profile: 'core',
    detection: { source: 'default', reason: 'no farm env or artifacts detected' },
  };
}

const profileResolution = resolveProfile();
const featureFarmOverride = parseBool(process.env.FEATURE_FARM);

export const FFT_PROFILE: FFTProfile = profileResolution.profile;
export const PROFILE_DETECTION: ProfileDetection = profileResolution.detection;
export const FEATURE_FARM: boolean = featureFarmOverride ?? FFT_PROFILE === 'farm';
