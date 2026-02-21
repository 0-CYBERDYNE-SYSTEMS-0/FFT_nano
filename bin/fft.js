#!/usr/bin/env node

import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

function printUsage() {
  process.stdout.write(`Usage:
  fft start [telegram-only]
  fft dev [telegram-only]
  fft tui [--url ws://127.0.0.1:28989] [--session main] [--deliver]
  fft service <install|uninstall|start|stop|restart|status|logs>

Options:
  --repo <path>   Run against a specific FFT_nano repo path.
  -h, --help      Show this help.
`);
}

function findRepoRoot(startDir) {
  let current = path.resolve(startDir);
  while (true) {
    const pkgPath = path.join(current, 'package.json');
    const startScriptPath = path.join(current, 'scripts', 'start.sh');
    if (fs.existsSync(pkgPath) && fs.existsSync(startScriptPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        if (pkg && pkg.name === 'fft_nano') return current;
      } catch {
        // continue walking
      }
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function parseCli(argv) {
  let repoOverride = null;
  const args = [];

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--repo') {
      const next = argv[i + 1];
      if (!next) {
        throw new Error('Missing value for --repo');
      }
      repoOverride = next;
      i += 1;
      continue;
    }
    args.push(token);
  }

  return { repoOverride, args };
}

function runInRepo(repoRoot, script, args) {
  const result = spawnSync('bash', [script, ...args], {
    cwd: repoRoot,
    env: process.env,
    stdio: 'inherit',
  });

  if (result.error) {
    throw result.error;
  }
  process.exit(result.status ?? 1);
}

function main() {
  let parsed;
  try {
    parsed = parseCli(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    printUsage();
    process.exit(2);
  }

  const [command, ...commandArgs] = parsed.args;
  if (!command || command === '-h' || command === '--help' || command === 'help') {
    printUsage();
    process.exit(0);
  }

  if (!['start', 'dev', 'tui', 'service'].includes(command)) {
    process.stderr.write(`Unknown command: ${command}\n`);
    printUsage();
    process.exit(2);
  }

  const repoRoot = parsed.repoOverride
    ? findRepoRoot(path.resolve(parsed.repoOverride))
    : findRepoRoot(process.cwd());

  if (!repoRoot) {
    process.stderr.write(
      'FFT_nano repo not found. Run inside the repo or pass --repo /absolute/path/to/FFT_nano.\n',
    );
    process.exit(2);
  }

  if (command === 'service') {
    runInRepo(repoRoot, 'scripts/service.sh', commandArgs);
    return;
  }

  runInRepo(repoRoot, 'scripts/start.sh', [command, ...commandArgs]);
}

main();
