import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

function writeExecutable(filePath: string, body: string): void {
  writeFileSync(filePath, body, 'utf8');
  chmodSync(filePath, 0o755);
}

test('install.sh forces foreground host runtime under Termux', () => {
  const repoRoot = process.cwd();
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'fft-install-termux-'));
  const binDir = path.join(fixtureRoot, 'bin');
  const homeDir = path.join(fixtureRoot, 'home');
  const installDir = path.join(fixtureRoot, 'FFT_nano');
  const onboardLog = path.join(fixtureRoot, 'onboard.log');
  mkdirSync(binDir, { recursive: true });
  mkdirSync(homeDir, { recursive: true });

  writeExecutable(
    path.join(binDir, 'curl'),
    `#!/usr/bin/env bash
set -euo pipefail
out=""
while [[ "$#" -gt 0 ]]; do
  case "$1" in
    -o)
      out="$2"
      shift 2
      ;;
    -w)
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done
if [[ -n "$out" ]]; then
  printf 'stub archive\\n' > "$out"
else
  printf 'https://github.com/0-CYBERDYNE-SYSTEMS-0/FFT_nano/releases/tag/vtest\\n'
fi
`,
  );

  writeExecutable(
    path.join(binDir, 'tar'),
    `#!/usr/bin/env bash
set -euo pipefail
dest=""
while [[ "$#" -gt 0 ]]; do
  case "$1" in
    -C)
      dest="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done
root="$dest/FFT_nano-vtest"
mkdir -p "$root/scripts"
cat > "$root/.env.example" <<'ENV'
PI_API=replace-me
ENV
cat > "$root/scripts/onboard-all.sh" <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
{
  printf 'args:%s\\n' "$*"
  printf 'container:%s\\n' "\${CONTAINER_RUNTIME:-}"
  printf 'allow_host:%s\\n' "\${FFT_NANO_ALLOW_HOST_RUNTIME:-}"
  printf 'auto_link:%s\\n' "\${FFT_NANO_AUTO_LINK:-}"
} > "\${FFT_TEST_ONBOARD_LOG:?}"
SCRIPT
chmod +x "$root/scripts/onboard-all.sh"
`,
  );

  writeExecutable(
    path.join(binDir, 'pkg'),
    `#!/usr/bin/env bash
set -euo pipefail
printf 'pkg:%s\\n' "$*" >> "${path.join(fixtureRoot, 'pkg.log')}"
`,
  );

  const result = spawnSync(
    'bash',
    [
      path.join(repoRoot, 'scripts/install.sh'),
      '--runtime',
      'docker',
      '--install-daemon',
      '--non-interactive',
      '--accept-risk',
    ],
    {
      env: {
        ...process.env,
        HOME: homeDir,
        PATH: `${binDir}:${process.env.PATH}`,
        TERMUX_VERSION: '0.118.0',
        FFT_NANO_REF: 'vtest',
        FFT_NANO_INSTALL_DIR: installDir,
        FFT_TEST_ONBOARD_LOG: onboardLog,
      },
      encoding: 'utf8',
    },
  );

  assert.equal(
    result.status,
    0,
    `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  assert.equal(existsSync(onboardLog), true);
  const onboardBody = readFileSync(onboardLog, 'utf8');
  assert.match(
    onboardBody,
    /args:--runtime host --no-install-daemon --non-interactive --accept-risk/,
  );
  assert.doesNotMatch(onboardBody, /docker|--install-daemon(?! --non)/);
  assert.match(onboardBody, /^container:host$/m);
  assert.match(onboardBody, /^allow_host:1$/m);
  assert.match(onboardBody, /^auto_link:0$/m);

  const envBody = readFileSync(path.join(installDir, '.env'), 'utf8');
  assert.match(envBody, /^CONTAINER_RUNTIME=host$/m);
  assert.match(envBody, /^FFT_NANO_ALLOW_HOST_RUNTIME=1$/m);
  assert.match(result.stdout, /Android Termux detected/);
  assert.match(result.stdout, /Termux install complete/);
});
