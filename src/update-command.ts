import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

export interface UpdateCommandResult {
  ok: boolean;
  text: string;
}

export interface CommandRunResult {
  stdout?: string;
  stderr?: string;
  status: number | null;
  signal?: NodeJS.Signals | null;
  error?: Error;
}

export interface CommandRunOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export type CommandRunner = (
  command: string,
  args: string[],
  options: CommandRunOptions,
) => CommandRunResult;

export interface RunUpdateCommandOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  run?: CommandRunner;
  existsSync?: (filePath: string) => boolean;
  now?: () => Date;
}

interface StepResult {
  ok: boolean;
  result: CommandRunResult;
}

const OUTPUT_LIMIT = 4000;
const MAX_BUFFER = 8 * 1024 * 1024;

function defaultRunner(
  command: string,
  args: string[],
  options: CommandRunOptions,
): CommandRunResult {
  return spawnSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    env: options.env,
    maxBuffer: MAX_BUFFER,
  });
}

function boundedOutput(output: string): string {
  return output.length > OUTPUT_LIMIT
    ? `${output.slice(0, OUTPUT_LIMIT)}\n...truncated...`
    : output;
}

function combinedOutput(result: CommandRunResult): string {
  return [result.stdout || '', result.stderr || '']
    .filter((part) => part.trim().length > 0)
    .join('\n')
    .trim();
}

function autostashMarker(now: Date): string {
  return `fft-nano-update-autostash-${now.toISOString()}`;
}

function findAutostashRef(stashList: string, marker: string): string | null {
  for (const line of stashList.split(/\r?\n/)) {
    const [ref, subject] = line.split('\0');
    if (ref && subject?.includes(marker)) return ref;
  }
  return null;
}

export function runUpdateCommand(
  options: RunUpdateCommandOptions = {},
): UpdateCommandResult {
  const cwd = options.cwd || process.cwd();
  const env = options.env || process.env;
  const run = options.run || defaultRunner;
  const existsSync = options.existsSync || fs.existsSync;
  const now = options.now || (() => new Date());
  const outputLines: string[] = [];
  let stashRef: string | null = null;

  const runRaw = (command: string, args: string[]): CommandRunResult =>
    run(command, args, { cwd, env });

  const runStep = (
    label: string,
    command: string,
    args: string[],
  ): StepResult => {
    outputLines.push(`--- ${label} ---`);
    const result = runRaw(command, args);
    const output = combinedOutput(result);

    if (result.error) {
      outputLines.push(`Failed: ${result.error.message}`);
      return { ok: false, result };
    }

    if (output) outputLines.push(boundedOutput(output));

    if (result.status !== 0) {
      outputLines.push(
        `${label} failed with exit code ${result.status ?? 'unknown'}.`,
      );
      return { ok: false, result };
    }

    return { ok: true, result };
  };

  const fail = (message: string): UpdateCommandResult => {
    outputLines.push(message);
    return { ok: false, text: outputLines.join('\n') };
  };

  const restoreAutostashAfterAbort = (): boolean => {
    if (!stashRef) return true;
    const restore = runStep('git stash apply (restore after abort)', 'git', [
      'stash',
      'apply',
      stashRef,
    ]);
    if (!restore.ok) {
      outputLines.push(
        `Local changes remain saved in ${stashRef}. Restore manually with: git stash apply ${stashRef}`,
      );
      return false;
    }
    outputLines.push(
      `Local changes restored. Backup stash retained at ${stashRef}; drop it after inspection with: git stash drop ${stashRef}`,
    );
    return true;
  };

  const gitCheck = runRaw('git', ['rev-parse', '--is-inside-work-tree']);
  if (gitCheck.error) {
    return fail(`Failed checking git checkout: ${gitCheck.error.message}`);
  }
  if (gitCheck.status !== 0 || gitCheck.stdout?.trim() !== 'true') {
    return fail('Update aborted: current directory is not a git checkout.');
  }

  const status = runStep('git status', 'git', ['status', '--porcelain']);
  if (!status.ok) return fail('Update aborted before changing files.');

  const dirty = Boolean(status.result.stdout?.trim());
  if (dirty) {
    const marker = autostashMarker(now());
    outputLines.push('Local changes detected; stashing before update.');
    const stash = runStep('git stash', 'git', [
      'stash',
      'push',
      '--include-untracked',
      '-m',
      marker,
    ]);
    if (!stash.ok)
      return fail('Update aborted: could not stash local changes.');

    const stashList = runRaw('git', ['stash', 'list', '--format=%gd%x00%gs']);
    if (stashList.error) {
      return fail(
        `Update aborted: could not identify stash (${stashList.error.message}).`,
      );
    }
    stashRef = findAutostashRef(stashList.stdout || '', marker);
    if (!stashRef) {
      return fail(
        `Update aborted: created autostash marker was not found. Marker: ${marker}`,
      );
    }
    outputLines.push(`Saved local changes as ${stashRef}.`);
  }

  const fetch = runStep('git fetch', 'git', ['fetch', 'origin']);
  if (!fetch.ok) {
    restoreAutostashAfterAbort();
    return fail('Update aborted during fetch.');
  }

  const branch = runRaw('git', ['symbolic-ref', '--short', 'HEAD']);
  const currentBranch =
    branch.status === 0 && branch.stdout?.trim() ? branch.stdout.trim() : null;
  const pullArgs = currentBranch
    ? ['pull', '--ff-only', 'origin', currentBranch]
    : ['pull', '--ff-only'];
  const pull = runStep('git pull', 'git', pullArgs);
  if (!pull.ok) {
    restoreAutostashAfterAbort();
    return fail('Update aborted during pull.');
  }

  if (stashRef) {
    const apply = runStep('git stash apply', 'git', [
      'stash',
      'apply',
      stashRef,
    ]);
    if (!apply.ok) {
      return fail(
        `Update aborted: local changes could not be reapplied cleanly. Resolve conflicts, then recover with: git stash apply ${stashRef}`,
      );
    }

    const drop = runStep('git stash drop', 'git', ['stash', 'drop', stashRef]);
    if (!drop.ok) {
      outputLines.push(
        `Warning: local changes were reapplied, but ${stashRef} could not be dropped. You may drop it manually after inspection.`,
      );
    }
  }

  const installStep = existsSync(path.join(cwd, 'package-lock.json'))
    ? runStep('npm ci', 'npm', ['ci'])
    : runStep('npm install', 'npm', ['install']);

  if (!installStep.ok && existsSync(path.join(cwd, 'package-lock.json'))) {
    outputLines.push('npm ci failed; falling back to npm install.');
    const fallbackInstall = runStep('npm install', 'npm', ['install']);
    if (!fallbackInstall.ok) {
      return fail('Update aborted during dependency installation.');
    }
  } else if (!installStep.ok) {
    return fail('Update aborted during dependency installation.');
  }

  const build = runStep('npm run build', 'npm', ['run', 'build']);
  if (!build.ok) return fail('Update aborted during build.');

  outputLines.push('--- restart ---');
  const scriptPath = path.join(cwd, 'scripts', 'service.sh');
  if (!existsSync(scriptPath)) {
    outputLines.push('Service script not found. Restart manually.');
    return { ok: false, text: outputLines.join('\n') };
  }

  const restartResult = run('bash', [scriptPath, 'restart'], {
    cwd,
    env: {
      ...env,
      FFT_NANO_GATEWAY_CALL: '1',
      FFT_NANO_NONINTERACTIVE: '1',
    },
  });

  const restartOutput = combinedOutput(restartResult);
  if (restartOutput) outputLines.push(boundedOutput(restartOutput));

  if (
    restartResult.status === null &&
    (restartResult.signal === 'SIGTERM' || restartResult.signal === 'SIGKILL')
  ) {
    outputLines.push('Update complete. Service restarting.');
    return { ok: true, text: outputLines.join('\n') };
  }

  if (restartResult.error) {
    outputLines.push(`Failed: ${restartResult.error.message}`);
    return { ok: false, text: outputLines.join('\n') };
  }

  if (restartResult.status !== 0) {
    outputLines.push(
      `Service restart failed with exit code ${restartResult.status ?? 'unknown'}. Update applied but service may need manual restart.`,
    );
    return { ok: false, text: outputLines.join('\n') };
  }

  outputLines.push('Update complete. Service restarted.');
  return { ok: true, text: outputLines.join('\n') };
}
