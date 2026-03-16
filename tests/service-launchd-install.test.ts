import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test('service install unloads existing launch agent before bootstrap', () => {
  const repoRoot = process.cwd();
  const workDir = mkdtempSync(path.join(tmpdir(), 'fft-service-launchd-'));
  const fakeBinDir = path.join(workDir, 'bin');
  const fakeHome = path.join(workDir, 'home');
  const launchctlLog = path.join(workDir, 'launchctl.log');
  const launchctlState = path.join(workDir, 'launchctl.state');
  const label = 'com.fft_nano.test';

  mkdirSync(fakeBinDir, { recursive: true });
  mkdirSync(path.join(fakeHome, 'Library', 'LaunchAgents'), { recursive: true });
  writeFileSync(launchctlState, 'loaded\n', 'utf8');

  const fakeLaunchctlPath = path.join(fakeBinDir, 'launchctl');
  writeFileSync(
    fakeLaunchctlPath,
    `#!/usr/bin/env bash
set -euo pipefail
echo "$*" >> "$LAUNCHCTL_LOG"
cmd="$1"
shift || true

case "$cmd" in
  print)
    if [[ -f "$LAUNCHCTL_STATE" ]]; then
      exit 0
    fi
    echo "Bad request." >&2
    exit 113
    ;;
  bootout)
    if [[ "$#" -eq 2 ]]; then
      rm -f "$LAUNCHCTL_STATE"
      exit 0
    fi
    # Mimic launchd behavior seen in the bug: service-target bootout returns
    # success but leaves the job loaded.
    exit 0
    ;;
  bootstrap)
    if [[ -f "$LAUNCHCTL_STATE" ]]; then
      echo "Bootstrap failed: 5: Input/output error" >&2
      exit 5
    fi
    touch "$LAUNCHCTL_STATE"
    exit 0
    ;;
  kickstart)
    touch "$LAUNCHCTL_STATE"
    exit 0
    ;;
  *)
    exit 0
    ;;
esac
`,
    'utf8',
  );
  chmodSync(fakeLaunchctlPath, 0o755);

  const fakeUnamePath = path.join(fakeBinDir, 'uname');
  writeFileSync(
    fakeUnamePath,
    `#!/usr/bin/env bash
if [[ "$1" == "-s" ]]; then
  echo "Darwin"
  exit 0
fi
/usr/bin/uname "$@"
`,
    'utf8',
  );
  chmodSync(fakeUnamePath, 0o755);

  const env = {
    ...process.env,
    HOME: fakeHome,
    PATH: `${fakeBinDir}:${process.env.PATH ?? ''}`,
    FFT_NANO_PROJECT_ROOT: repoRoot,
    FFT_NANO_LAUNCHD_LABEL: label,
    LAUNCHCTL_LOG: launchctlLog,
    LAUNCHCTL_STATE: launchctlState,
  };

  const result = spawnSync('bash', ['scripts/service.sh', 'install'], {
    cwd: repoRoot,
    env,
    encoding: 'utf8',
  });

  assert.equal(
    result.status,
    0,
    `expected install to succeed, got status=${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );

  const log = readFileSync(launchctlLog, 'utf8');
  const expectedPlist = path.join(fakeHome, 'Library', 'LaunchAgents', `${label}.plist`);
  const bootoutWithPlist = new RegExp(`^bootout gui/\\d+ ${escapeRegExp(expectedPlist)}$`, 'm');
  assert.match(log, bootoutWithPlist);
});
