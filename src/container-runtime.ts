import { execSync } from 'child_process';

export type ContainerRuntime = 'apple' | 'docker';

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

  if (raw === 'apple') return 'apple';
  if (raw === 'docker') return 'docker';
  if (raw !== 'auto') {
    throw new Error(
      `Invalid CONTAINER_RUNTIME="${process.env.CONTAINER_RUNTIME}" (expected "auto", "apple", or "docker")`,
    );
  }

  // Auto mode prefers Docker when available for cross-platform parity.
  if (commandExists('docker')) return 'docker';
  if (process.platform === 'darwin' && commandExists('container')) return 'apple';
  if (commandExists('container')) return 'apple';

  throw new Error(
    'No container runtime found. Install Apple Container (macOS) or Docker, or set CONTAINER_RUNTIME explicitly.',
  );
}

export function getRuntimeCommand(runtime: ContainerRuntime): string {
  return runtime === 'docker' ? 'docker' : 'container';
}
