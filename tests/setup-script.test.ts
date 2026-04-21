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

function setupSetupFixture(options: { envBody?: string } = {}): {
  fixtureRoot: string;
  npmLog: string;
  dockerLog: string;
} {
  const repoRoot = process.cwd();
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'fft-setup-script-'));
  const scriptsDir = path.join(fixtureRoot, 'scripts');
  const fakeBinDir = path.join(fixtureRoot, 'fake-bin');

  mkdirSync(scriptsDir, { recursive: true });
  mkdirSync(fakeBinDir, { recursive: true });
  mkdirSync(path.join(fixtureRoot, 'container'), { recursive: true });
  mkdirSync(path.join(fixtureRoot, 'web', 'control-center'), { recursive: true });

  writeFileSync(
    path.join(scriptsDir, 'setup.sh'),
    readFileSync(path.join(repoRoot, 'scripts', 'setup.sh'), 'utf8'),
    'utf8',
  );
  chmodSync(path.join(scriptsDir, 'setup.sh'), 0o755);

  writeFileSync(
    path.join(scriptsDir, 'service.sh'),
    '#!/usr/bin/env bash\nset -euo pipefail\nexit 0\n',
    'utf8',
  );
  chmodSync(path.join(scriptsDir, 'service.sh'), 0o755);

  const dockerLog = path.join(fixtureRoot, 'docker.log');
  writeFileSync(dockerLog, '', 'utf8');
  writeFileSync(
    path.join(fixtureRoot, 'container', 'build-docker.sh'),
    `#!/usr/bin/env bash
set -euo pipefail
printf 'docker-build\\n' >> "${dockerLog}"
`,
    'utf8',
  );
  chmodSync(path.join(fixtureRoot, 'container', 'build-docker.sh'), 0o755);

  writeFileSync(path.join(fixtureRoot, '.env.example'), 'PI_API=replace-me\nPI_MODEL=replace-me\n', 'utf8');
  if (options.envBody !== undefined) {
    writeFileSync(path.join(fixtureRoot, '.env'), options.envBody, 'utf8');
  }

  writeFileSync(path.join(fixtureRoot, 'package.json'), '{"name":"fft-setup-fixture","private":true}\n', 'utf8');
  writeFileSync(path.join(fixtureRoot, 'web', 'control-center', 'package.json'), '{"name":"control-center","private":true}\n', 'utf8');

  const npmLog = path.join(fixtureRoot, 'npm.log');
  writeFileSync(
    path.join(fakeBinDir, 'npm'),
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "${npmLog}"
if [[ "$#" -ge 1 && ( "$1" == "install" || "$1" == "ci" ) ]]; then
  mkdir -p node_modules/.bin
  cat > node_modules/.bin/pi <<'SH'
#!/usr/bin/env bash
exit 0
SH
  chmod +x node_modules/.bin/pi
  exit 0
fi
exit 0
`,
    'utf8',
  );
  chmodSync(path.join(fakeBinDir, 'npm'), 0o755);

  writeFileSync(
    path.join(fakeBinDir, 'docker'),
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == "info" ]]; then
  echo "Docker unavailable in fixture" >&2
  exit 1
fi
exit 1
`,
    'utf8',
  );
  chmodSync(path.join(fakeBinDir, 'docker'), 0o755);

  return { fixtureRoot, npmLog, dockerLog };
}

function runSetupFixture(
  fixtureRoot: string,
  args: string[],
  extraEnv: Record<string, string> = {},
): ReturnType<typeof spawnSync> {
  return spawnSync('bash', ['scripts/setup.sh', ...args], {
    cwd: fixtureRoot,
    env: {
      ...process.env,
      PATH: `${path.join(fixtureRoot, 'fake-bin')}:${process.env.PATH ?? ''}`,
      FFT_NANO_AUTO_SERVICE: '0',
      FFT_NANO_AUTO_LINK: '0',
      ...extraEnv,
    },
    encoding: 'utf8',
  });
}

function runSetupFixtureInteractive(
  fixtureRoot: string,
  args: string[],
  extraEnv: Record<string, string> = {},
): { status: number; output: string } {
  const driver = `
import json
import os
import pty
import select
import sys

cmd = sys.argv[1:]
pid, fd = pty.fork()
if pid == 0:
    os.execvpe(cmd[0], cmd, os.environ)

chunks = []
sent = False

while True:
    try:
        ready, _, _ = select.select([fd], [], [], 1.0)
    except OSError:
        break
    if fd not in ready:
        continue
    try:
        data = os.read(fd, 4096)
    except OSError:
        break
    if not data:
        break
    text = data.decode("utf-8", "replace")
    chunks.append(text)
    joined = "".join(chunks)
    if (not sent) and "Runtime [host/docker] [host]:" in joined:
        os.write(fd, b"host\\n")
        sent = True

_, status = os.waitpid(pid, 0)
result = {
    "status": os.waitstatus_to_exitcode(status),
    "output": "".join(chunks),
}
print(json.dumps(result))
`;

  const result = spawnSync('python3', ['-c', driver, 'bash', 'scripts/setup.sh', ...args], {
    cwd: fixtureRoot,
    env: {
      ...process.env,
      PATH: `${path.join(fixtureRoot, 'fake-bin')}:${process.env.PATH ?? ''}`,
      FFT_NANO_AUTO_SERVICE: '0',
      FFT_NANO_AUTO_LINK: '0',
      ...extraEnv,
    },
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, `python driver failed:\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  return JSON.parse(result.stdout) as { status: number; output: string };
}

test('setup.sh with no Docker and --runtime host persists host runtime and skips Docker build', () => {
  const { fixtureRoot, npmLog, dockerLog } = setupSetupFixture();

  const result = runSetupFixture(fixtureRoot, ['--runtime', 'host']);

  assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  const envBody = readFileSync(path.join(fixtureRoot, '.env'), 'utf8');
  assert.match(envBody, /^CONTAINER_RUNTIME=host$/m);
  assert.match(envBody, /^FFT_NANO_ALLOW_HOST_RUNTIME=1$/m);
  assert.doesNotMatch(readFileSync(dockerLog, 'utf8'), /docker-build/);

  const npmCalls = readFileSync(npmLog, 'utf8').trim().split('\n');
  assert.deepEqual(npmCalls, [
    'install',
    'run typecheck',
    'run build',
    '--prefix web/control-center install',
    '--prefix web/control-center run build',
  ]);
});

test('setup.sh with no Docker and no runtime flag fails non-interactively with actionable guidance', () => {
  const { fixtureRoot, npmLog, dockerLog } = setupSetupFixture();

  const result = runSetupFixture(fixtureRoot, []);

  assert.notEqual(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /Install Docker, or re-run with --runtime host/i,
  );
  assert.doesNotMatch(readFileSync(dockerLog, 'utf8'), /docker-build/);

  const npmCalls = readFileSync(npmLog, 'utf8').trim().split('\n');
  assert.deepEqual(npmCalls, [
    'install',
    'run typecheck',
    'run build',
    '--prefix web/control-center install',
    '--prefix web/control-center run build',
  ]);
});

test('setup.sh respects persisted host runtime from .env without requiring Docker', () => {
  const { fixtureRoot, npmLog, dockerLog } = setupSetupFixture({
    envBody: 'CONTAINER_RUNTIME=host\nFFT_NANO_ALLOW_HOST_RUNTIME=1\n',
  });

  const result = runSetupFixture(fixtureRoot, []);

  assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  const envBody = readFileSync(path.join(fixtureRoot, '.env'), 'utf8');
  assert.match(envBody, /^CONTAINER_RUNTIME=host$/m);
  assert.match(envBody, /^FFT_NANO_ALLOW_HOST_RUNTIME=1$/m);
  assert.doesNotMatch(readFileSync(dockerLog, 'utf8'), /docker-build/);

  const npmCalls = readFileSync(npmLog, 'utf8').trim().split('\n');
  assert.deepEqual(npmCalls, [
    'install',
    'run typecheck',
    'run build',
    '--prefix web/control-center install',
    '--prefix web/control-center run build',
  ]);
});

test('setup.sh interactive host selection persists host runtime instead of falling through to docker', () => {
  const { fixtureRoot, dockerLog } = setupSetupFixture();

  const result = runSetupFixtureInteractive(fixtureRoot, []);

  assert.equal(result.status, 0, `output:\n${result.output}`);
  assert.match(result.output, /Runtime \[host\/docker\] \[host\]:/);
  assert.match(result.output, /Detected container runtime: host/);
  assert.doesNotMatch(result.output, /Docker-first runtime selected\./);
  assert.doesNotMatch(result.output, /Preparing host runtime runner dependencies\.\.\./);

  const envBody = readFileSync(path.join(fixtureRoot, '.env'), 'utf8');
  assert.match(envBody, /^CONTAINER_RUNTIME=host$/m);
  assert.match(envBody, /^FFT_NANO_ALLOW_HOST_RUNTIME=1$/m);
  assert.doesNotMatch(readFileSync(dockerLog, 'utf8'), /docker-build/);
});
