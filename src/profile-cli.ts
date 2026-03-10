import fs from 'fs';
import path from 'path';

import { FEATURE_FARM, FFT_PROFILE, PROFILE_DETECTION, type FFTProfile } from './profile.js';

interface CliArgs {
  command: 'status' | 'set' | 'apply';
  profile?: FFTProfile;
  writeEnv: boolean;
}

function usage(): string {
  return [
    'Usage:',
    '  npm run profile -- status',
    '  npm run profile -- set <core|farm> [--no-env]',
    '  npm run profile -- apply <core|farm> [--no-env]',
    '',
    'Notes:',
    '  - set: update runtime profile selection (optionally writes .env)',
    '  - apply farm: enables farm feature flags without removing existing data',
    '  - apply core: switches back to core profile defaults',
  ].join('\n');
}

function parseArgs(argv: string[]): CliArgs {
  if (argv.length === 0 || argv.includes('-h') || argv.includes('--help')) {
    console.log(usage());
    process.exit(0);
  }

  const [commandRaw, maybeProfile, ...rest] = argv;
  const command = commandRaw?.trim().toLowerCase();
  const writeEnv = !rest.includes('--no-env');

  if (command === 'status') {
    return { command: 'status', writeEnv };
  }

  if (command === 'set' || command === 'apply') {
    const profileRaw = maybeProfile?.trim().toLowerCase();
    if (profileRaw !== 'core' && profileRaw !== 'farm') {
      throw new Error(`${command} requires <core|farm>`);
    }
    return {
      command,
      profile: profileRaw,
      writeEnv,
    };
  }

  throw new Error(`Unknown command: ${commandRaw}`);
}

function readEnvPath(projectRoot: string): string {
  return path.join(projectRoot, '.env');
}

function upsertEnvValue(envPath: string, key: string, value: string): void {
  const lines = fs.existsSync(envPath)
    ? fs.readFileSync(envPath, 'utf-8').replace(/\r\n/g, '\n').split('\n')
    : [];

  let updated = false;
  const pattern = new RegExp(`^\\s*${key}=`);
  const next = lines.map((line) => {
    if (pattern.test(line)) {
      updated = true;
      return `${key}=${value}`;
    }
    return line;
  });

  if (!updated) next.push(`${key}=${value}`);
  fs.writeFileSync(envPath, `${next.filter((line, idx, arr) => !(idx === arr.length - 1 && line === '')).join('\n')}\n`, 'utf-8');
}

function applyProfileToEnv(profile: FFTProfile, envPath: string): void {
  upsertEnvValue(envPath, 'FFT_PROFILE', profile);
  upsertEnvValue(envPath, 'FEATURE_FARM', profile === 'farm' ? '1' : '0');

  if (profile === 'farm') {
    upsertEnvValue(envPath, 'FARM_STATE_ENABLED', 'true');
    if (!process.env.ASSISTANT_NAME?.trim()) {
      upsertEnvValue(envPath, 'ASSISTANT_NAME', 'FarmFriend');
    }
    return;
  }

  // Core profile keeps farm data on disk but disables farm feature paths.
  upsertEnvValue(envPath, 'FARM_STATE_ENABLED', 'false');
}

function printStatus(): void {
  const explicit = (process.env.FFT_PROFILE || '').trim() || '(unset)';
  const featureOverride = (process.env.FEATURE_FARM || '').trim() || '(unset)';
  console.log(
    [
      'FFT profile status',
      `resolved_profile: ${FFT_PROFILE}`,
      `feature_farm: ${FEATURE_FARM}`,
      `detection_source: ${PROFILE_DETECTION.source}`,
      `detection_reason: ${PROFILE_DETECTION.reason}`,
      `env.FFT_PROFILE: ${explicit}`,
      `env.FEATURE_FARM: ${featureOverride}`,
    ].join('\n'),
  );
}

function main(): void {
  try {
    const args = parseArgs(process.argv.slice(2));
    const projectRoot = process.cwd();
    const envPath = readEnvPath(projectRoot);

    if (args.command === 'status') {
      printStatus();
      return;
    }

    if (!args.profile) {
      throw new Error('Missing profile');
    }

    if (args.writeEnv) {
      applyProfileToEnv(args.profile, envPath);
      console.log(`Updated ${envPath}`);
    }

    if (args.command === 'apply') {
      if (args.profile === 'farm') {
        console.log('Applied farm profile flags. Next: restart service to enable farm runtime paths.');
      } else {
        console.log('Applied core profile flags. Next: restart service to run core runtime paths.');
      }
      return;
    }

    console.log(`Set profile=${args.profile}${args.writeEnv ? ' (persisted in .env)' : ''}`);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    console.error('');
    console.error(usage());
    process.exit(2);
  }
}

main();
