import { execSync } from 'child_process';

import { getPlatformAdapter } from './platform/index.js';

export type ContainerRuntime = 'docker' | 'host';

function commandExists(cmd: string): boolean {
  try {
    execSync(`command -v ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function dockerAvailableAndHealthy(): boolean {
  if (!commandExists('docker')) return false;
  try {
    execSync('docker info', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function isWindowsDockerDesktop(dockerVerified = false): boolean {
  // Docker Desktop on Windows sets DOCKER_HOST and uses named pipes
  // We check for the presence of docker CLI and Windows-specific indicators
  if (process.platform !== 'win32') return false;
  // Only re-verify Docker health if not already verified by caller
  if (!dockerVerified) {
    return dockerAvailableAndHealthy();
  }
  // dockerVerified=true means Docker was already confirmed healthy by getContainerRuntime()
  // Check Windows-specific indicator (DOCKER_HOST named pipe presence) without re-verifying
  const dockerHost = process.env.DOCKER_HOST;
  if (dockerHost && dockerHost.includes('//./pipe')) {
    return true;
  }
  // DOCKER_HOST not set to named pipe - don't re-verify Docker, just return false
  // The caller (getContainerRuntime) already verified Docker is healthy
  return false;
}

function isAndroidTermux(): boolean {
  // Termux on Android sets PREFIX environment variable
  // and typically has /data/data/com.termux/files/usr as PREFIX
  return (
    process.platform === 'linux' &&
    !!process.env.PREFIX &&
    (process.env.PREFIX.includes('com.termux') ||
      process.env.PREFIX.includes('termux'))
  );
}

export function getContainerRuntime(): ContainerRuntime {
  const platformAdapter = getPlatformAdapter();

  // Android/Termux cannot run Docker - always use host-only runtime
  if (isAndroidTermux() || platformAdapter.name === 'android') {
    return 'host';
  }

  // Platform adapter reports whether Docker is supported
  if (!platformAdapter.supportsDocker) {
    return 'host';
  }

  const raw = (process.env.CONTAINER_RUNTIME || 'auto').toLowerCase();

  if (raw === 'docker') return 'docker';
  if (raw === 'host') return 'host';
  if (raw !== 'auto') {
    throw new Error(
      `Invalid CONTAINER_RUNTIME="${process.env.CONTAINER_RUNTIME}" (expected "auto", "docker", or "host")`,
    );
  }

  // Auto mode uses Docker when it is actually usable, otherwise it falls back
  // to the repo-local host Pi runtime.
  // On Windows, verify Docker first, then check Windows-specific indicators
  if (process.platform === 'win32') {
    if (dockerAvailableAndHealthy()) {
      // Docker is healthy - check Windows-specific indicators without re-verifying
      if (isWindowsDockerDesktop(true)) return 'docker';
    }
  } else if (dockerAvailableAndHealthy()) {
    return 'docker';
  }
  return 'host';
}
