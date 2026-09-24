import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('Android adapter uses the Termux service directory for sv commands', () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'fft-android-service-'));
  const fakeBinDir = path.join(workDir, 'bin');
  const fakePrefix = path.join(workDir, 'usr');
  const svLog = path.join(workDir, 'sv.log');

  mkdirSync(fakeBinDir, { recursive: true });
  mkdirSync(path.join(fakePrefix, 'var', 'service', 'fft-nano'), {
    recursive: true,
  });
  const fakeSvPath = path.join(fakeBinDir, 'sv');
  writeFileSync(
    fakeSvPath,
    `#!/usr/bin/env bash
set -euo pipefail
echo "$1 SVDIR=$SVDIR" >> "$SV_LOG"
if [[ "$1" == "status" ]]; then
  echo "run: fft-nano: (pid 123) 1s"
fi
`,
    'utf8',
  );
  chmodSync(fakeSvPath, 0o755);

  const result = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      '--eval',
      'const { AndroidAdapter } = await import("./src/platform/android.ts"); const adapter = new AndroidAdapter(); console.log(await adapter.getServiceStatus()); await adapter.stopService();',
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PATH: `${fakeBinDir}:${process.env.PATH ?? ''}`,
        PREFIX: fakePrefix,
        SV_LOG: svLog,
      },
      encoding: 'utf8',
    },
  );

  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), 'running');
  assert.deepEqual(readFileSync(svLog, 'utf8').trim().split('\n'), [
    `status SVDIR=${path.join(fakePrefix, 'var', 'service')}`,
    `down SVDIR=${path.join(fakePrefix, 'var', 'service')}`,
  ]);
});
