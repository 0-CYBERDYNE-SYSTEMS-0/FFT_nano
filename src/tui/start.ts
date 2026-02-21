import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

function resolveProjectDir(): string {
  const argv1 = process.argv[1] || '';
  const abs = path.resolve(argv1);
  if (abs.includes(`${path.sep}src${path.sep}tui${path.sep}start.ts`)) {
    return path.resolve(path.dirname(abs), '..', '..');
  }
  if (abs.includes(`${path.sep}dist${path.sep}tui${path.sep}start.js`)) {
    return path.resolve(path.dirname(abs), '..', '..');
  }
  return process.cwd();
}

async function main(): Promise<void> {
  const projectDir = resolveProjectDir();
  const argv1 = process.argv[1] || '';
  const isDevTs = argv1.endsWith('.ts') || argv1.endsWith('.tsx');

  const localTsx = path.join(
    projectDir,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'tsx.cmd' : 'tsx',
  );
  const tsxCmd = fs.existsSync(localTsx) ? localTsx : 'tsx';

  const clientCmd = isDevTs ? tsxCmd : process.execPath;
  const clientArgs = isDevTs
    ? ['src/tui/client.ts', ...process.argv.slice(2)]
    : ['dist/tui/client.js', ...process.argv.slice(2)];

  const client = spawn(clientCmd, clientArgs, {
    cwd: projectDir,
    env: process.env,
    stdio: 'inherit',
  });

  client.on('exit', (code) => {
    process.exit(code || 0);
  });

  client.on('error', (err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}

