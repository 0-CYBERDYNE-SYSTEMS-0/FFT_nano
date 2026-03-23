import { execFileSync } from 'child_process';
import path from 'path';

export type SandboxMode = 'bwrap' | 'docker' | 'none';

export interface SandboxConfig {
  cwd: string;
  allowedPaths?: string[];
  env?: Record<string, string>;
}

interface SandboxResult {
  command: string;
  args: string[];
}

function commandExists(cmd: string): boolean {
  try {
    execFileSync('which', [cmd], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function getSandboxMode(): SandboxMode {
  const raw = (process.env.FFT_NANO_SANDBOX || 'none').trim().toLowerCase();
  if (raw === 'bwrap') return 'bwrap';
  if (raw === 'docker') return 'docker';
  return 'none';
}

function wrapWithBwrap(
  command: string,
  args: string[],
  config: SandboxConfig,
): SandboxResult {
  if (!commandExists('bwrap')) {
    throw new Error(
      'FFT_NANO_SANDBOX=bwrap but bwrap is not installed. ' +
        'Install bwrap or set FFT_NANO_SANDBOX=none.',
    );
  }

  const bwrapArgs: string[] = [
    '--ro-bind',
    '/',
    '/',
    '--dev',
    '/dev',
    '--proc',
    '/proc',
    '--tmpfs',
    '/tmp',
  ];

  for (const p of config.allowedPaths || []) {
    bwrapArgs.push('--bind', p, p);
  }

  bwrapArgs.push('--chdir', config.cwd);
  bwrapArgs.push('--die-with-parent');
  bwrapArgs.push('--unshare-net');
  bwrapArgs.push('--', command, ...args);

  return { command: 'bwrap', args: bwrapArgs };
}

function wrapWithDocker(
  command: string,
  args: string[],
  config: SandboxConfig,
): SandboxResult {
  if (!commandExists('docker')) {
    throw new Error(
      'FFT_NANO_SANDBOX=docker but docker is not installed. ' +
        'Install docker or set FFT_NANO_SANDBOX=none.',
    );
  }

  const image = process.env.FFT_NANO_SANDBOX_IMAGE || 'fft-nano-pi:latest';
  const dockerArgs: string[] = ['run', '--rm', '-i', '-w', '/workspace'];

  for (const p of config.allowedPaths || []) {
    dockerArgs.push('-v', `${p}:${p}`);
  }
  dockerArgs.push('-v', `${config.cwd}:/workspace`);

  if (config.env) {
    for (const [key, value] of Object.entries(config.env)) {
      if (value) dockerArgs.push('-e', `${key}=${value}`);
    }
  }

  dockerArgs.push(image, resolveDockerVisibleCommand(command), ...args);
  return { command: 'docker', args: dockerArgs };
}

export function resolveDockerVisibleCommand(command: string): string {
  const base = path.basename(command);
  if (base === 'pi' && path.isAbsolute(command)) {
    return 'pi';
  }
  return command;
}

export function wrapWithSandbox(
  command: string,
  args: string[],
  config: SandboxConfig,
): SandboxResult {
  const mode = getSandboxMode();

  switch (mode) {
    case 'bwrap':
      return wrapWithBwrap(command, args, config);
    case 'docker':
      return wrapWithDocker(command, args, config);
    case 'none':
    default:
      return { command, args };
  }
}
