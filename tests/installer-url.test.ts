import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const REPO_ROOT = process.cwd();
const CANONICAL_URL =
  'https://raw.githubusercontent.com/0-CYBERDYNE-SYSTEMS-0/FFT_nano/main/scripts/install.sh';
const OLD_URL_PATTERN = 'farm-friend.com/fft-nano/install';

function getTrackedFiles(exts: string[]): string[] {
  const extGlobs = exts.map((e) => `*.${e}`).join(' ');
  const output = execSync(
    `git ls-files | grep -E '\\.(${exts.join('|')})$'`,
    { cwd: REPO_ROOT, encoding: 'utf8' },
  );
  return output
    .split('\n')
    .filter(Boolean)
    .map((f) => path.join(REPO_ROOT, f));
}

test('installer-url: no farm-friend.com URL remains in any tracked file', () => {
  const extensions = ['md', 'html', 'ts', 'js', 'sh', 'yml', 'yaml', 'json'];
  const files = getTrackedFiles(extensions);

  // Exclude this test file itself since it contains the pattern as a constant
  const selfFile = import.meta.file || '';
  const filteredFiles = files.filter(
    (f) => !f.endsWith('installer-url.test.ts'),
  );

  const failures: string[] = [];
  for (const file of filteredFiles) {
    try {
      const content = readFileSync(file, 'utf8');
      if (content.includes(OLD_URL_PATTERN)) {
        failures.push(file);
      }
    } catch {
      // skip unreadable files
    }
  }

  assert.deepEqual(
    failures,
    [],
    `Old installer URL '${OLD_URL_PATTERN}' found in: ${failures.join(', ')}`,
  );
});

test('installer-url: canonical URL appears in README.md', () => {
  const readme = path.join(REPO_ROOT, 'README.md');
  const content = readFileSync(readme, 'utf8');
  assert.match(
    content,
    new RegExp(CANONICAL_URL.replace(/[.?*+^$[\]\\(){}|-]/g, '\\$&')),
    `README.md must contain the canonical installer URL: ${CANONICAL_URL}`,
  );
});

test('installer-url: canonical URL appears in docs/ONBOARDING.md', () => {
  const onboarding = path.join(REPO_ROOT, 'docs/ONBOARDING.md');
  const content = readFileSync(onboarding, 'utf8');
  assert.match(
    content,
    new RegExp(CANONICAL_URL.replace(/[.?*+^$[\]\\(){}|-]/g, '\\$&')),
    `docs/ONBOARDING.md must contain the canonical installer URL: ${CANONICAL_URL}`,
  );
});

test('installer-url: canonical URL appears in docs/INSTALLER.md', () => {
  const installer = path.join(REPO_ROOT, 'docs/INSTALLER.md');
  const content = readFileSync(installer, 'utf8');
  assert.match(
    content,
    new RegExp(CANONICAL_URL.replace(/[.?*+^$[\]\\(){}|-]/g, '\\$&')),
    `docs/INSTALLER.md must contain the canonical installer URL: ${CANONICAL_URL}`,
  );
});

test('installer-url: docs/RELEASE.md has no manual upload step', () => {
  const release = path.join(REPO_ROOT, 'docs/RELEASE.md');
  const content = readFileSync(release, 'utf8');
  assert.doesNotMatch(
    content,
    /upload.*farm-friend|upload.*install-test|step \d+.*upload/,
    'docs/RELEASE.md must not describe a manual upload step to farm-friend.com',
  );
  // Should mention the canonical raw URL
  assert.match(
    content,
    new RegExp(CANONICAL_URL.replace(/[.?*+^$[\]\\(){}|-]/g, '\\$&')),
    'docs/RELEASE.md must mention the canonical raw URL',
  );
  // Should mention cutting a new tag is sufficient
  assert.match(
    content,
    /cutting a new .* tag is sufficient|new tag is sufficient/i,
    'docs/RELEASE.md must state that cutting a new tag is sufficient',
  );
});

test('installer-url: install.sh still resolves FFT_NANO_REF=latest to releases/latest', () => {
  const installSh = path.join(REPO_ROOT, 'scripts/install.sh');
  const content = readFileSync(installSh, 'utf8');
  assert.match(
    content,
    /releases\/latest/,
    'scripts/install.sh must still use releases/latest for REF=latest resolution',
  );
  assert.match(
    content,
    /FFT_NANO_REF.*latest/,
    'scripts/install.sh must default FFT_NANO_REF to latest',
  );
});
