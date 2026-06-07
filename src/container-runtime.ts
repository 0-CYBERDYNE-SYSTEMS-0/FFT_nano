import { execSync } from 'child_process';

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

export function getContainerRuntime(): ContainerRuntime {
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
  if (dockerAvailableAndHealthy()) return 'docker';
  return 'host';
}
