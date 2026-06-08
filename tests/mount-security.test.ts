import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  setMountAllowlistForTest,
  validateAdditionalMounts,
  validateMount,
} from '../src/mount-security.js';

test('mount security blocks additional mounts when no allowlist is configured', (t) => {
  t.after(() => setMountAllowlistForTest(undefined));
  setMountAllowlistForTest(null);

  const result = validateMount(
    { hostPath: process.cwd(), containerPath: 'repo', readonly: true },
    true,
  );

  assert.equal(result.allowed, false);
  assert.match(result.reason, /No mount allowlist configured/);
});

test('mount security validates allowlisted roots and forces non-main read-only', (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-mount-root-'));
  const allowedDir = path.join(tmpRoot, 'allowed');
  fs.mkdirSync(allowedDir, { recursive: true });
  t.after(() => {
    setMountAllowlistForTest(undefined);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  setMountAllowlistForTest({
    allowedRoots: [
      {
        path: tmpRoot,
        allowReadWrite: true,
        description: 'test root',
      },
    ],
    blockedPatterns: [],
    nonMainReadOnly: true,
  });

  const main = validateMount(
    { hostPath: allowedDir, containerPath: 'allowed', readonly: false },
    true,
  );
  assert.equal(main.allowed, true);
  assert.equal(main.effectiveReadonly, false);

  const nonMain = validateMount(
    { hostPath: allowedDir, containerPath: 'allowed', readonly: false },
    false,
  );
  assert.equal(nonMain.allowed, true);
  assert.equal(nonMain.effectiveReadonly, true);
});

test('mount security rejects blocked patterns and container traversal', (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-mount-root-'));
  const blockedDir = path.join(tmpRoot, '.ssh');
  const allowedDir = path.join(tmpRoot, 'allowed');
  fs.mkdirSync(blockedDir, { recursive: true });
  fs.mkdirSync(allowedDir, { recursive: true });
  t.after(() => {
    setMountAllowlistForTest(undefined);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  setMountAllowlistForTest({
    allowedRoots: [{ path: tmpRoot, allowReadWrite: true }],
    blockedPatterns: [],
    nonMainReadOnly: true,
  });

  const blocked = validateMount(
    { hostPath: blockedDir, containerPath: 'ssh', readonly: true },
    true,
  );
  assert.equal(blocked.allowed, false);
  assert.match(blocked.reason, /blocked pattern/);

  const traversal = validateMount(
    { hostPath: allowedDir, containerPath: '../escape', readonly: true },
    true,
  );
  assert.equal(traversal.allowed, false);
  assert.match(traversal.reason, /Invalid container path/);
});

test('validateAdditionalMounts returns docker-ready extra mount paths', (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-mount-root-'));
  const allowedDir = path.join(tmpRoot, 'allowed');
  fs.mkdirSync(allowedDir, { recursive: true });
  t.after(() => {
    setMountAllowlistForTest(undefined);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  setMountAllowlistForTest({
    allowedRoots: [{ path: tmpRoot, allowReadWrite: true }],
    blockedPatterns: [],
    nonMainReadOnly: false,
  });

  assert.deepEqual(
    validateAdditionalMounts(
      [{ hostPath: allowedDir, containerPath: 'allowed', readonly: false }],
      'Test Group',
      true,
    ),
    [
      {
        hostPath: fs.realpathSync(allowedDir),
        containerPath: '/workspace/extra/allowed',
        readonly: false,
      },
    ],
  );
});
