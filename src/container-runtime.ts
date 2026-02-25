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

export function getContainerRuntime(): ContainerRuntime {
  const raw = (process.env.CONTAINER_RUNTIME || 'auto').toLowerCase();
  const hostAllowed = ['1', 'true', 'yes', 'on'].includes(
    (process.env.FFT_NANO_ALLOW_HOST_RUNTIME || '').toLowerCase(),
  );

  if (raw === 'docker') return 'docker';
  if (raw === 'host') {
    if (!hostAllowed) {
      throw new Error(
        'CONTAINER_RUNTIME=host requires FFT_NANO_ALLOW_HOST_RUNTIME=1 (explicit unsafe opt-in)',
      );
    }
    return 'host';
  }
  if (raw !== 'auto') {
    throw new Error(
      `Invalid CONTAINER_RUNTIME="${process.env.CONTAINER_RUNTIME}" (expected "auto", "docker", or "host")`,
    );
  }

  // Auto mode defaults to Docker for reproducibility and isolation.
  if (commandExists('docker')) return 'docker';

  if (hostAllowed) return 'host';
  throw new Error(
    [
      'No supported runtime found.',
      'Install Docker, or set CONTAINER_RUNTIME=host with FFT_NANO_ALLOW_HOST_RUNTIME=1 for unisolated host execution.',
    ].join(' '),
  );
}
