import fs from 'fs';
import path from 'path';

function findExecutableOnPath(name: string): string | null {
  const pathValue = process.env.PATH || '';
  for (const dir of pathValue.split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export function resolvePiExecutable(cwd = process.cwd()): string | null {
  const envOverride = process.env.PI_PATH?.trim();
  if (envOverride) return envOverride;

  const onPath = findExecutableOnPath('pi');
  if (onPath) return onPath;

  const localPi = path.join(cwd, 'node_modules', '.bin', 'pi');
  if (fs.existsSync(localPi)) return localPi;

  return null;
}
