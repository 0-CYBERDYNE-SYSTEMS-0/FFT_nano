import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { resolvePiExecutable } from '../src/pi-executable.js';

test('resolvePiExecutable prefers repo-local fallback when global pi is absent', () => {
  // Create a real temp tree so fs.existsSync passes on any machine / CI
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-test-'));
  const localPiDir = path.join(tmpDir, 'node_modules', '.bin');
  const localPiBin = path.join(localPiDir, 'pi');
  fs.mkdirSync(localPiDir, { recursive: true });
  fs.writeFileSync(localPiBin, '#!/bin/sh\necho pi', { mode: 0o755 });

  const originalPath = process.env.PATH;
  const originalPiPath = process.env.PI_PATH;
  process.env.PATH = '';
  delete process.env.PI_PATH;

  try {
    const resolved = resolvePiExecutable(tmpDir);
    assert.equal(resolved, localPiBin);
  } finally {
    process.env.PATH = originalPath;
    if (originalPiPath === undefined) delete process.env.PI_PATH;
    else process.env.PI_PATH = originalPiPath;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('resolvePiExecutable honors PI_PATH override first', () => {
  const originalPiPath = process.env.PI_PATH;
  process.env.PI_PATH = '/tmp/custom-pi';

  try {
    // PI_PATH is checked before cwd lookup — cwd value is irrelevant here
    assert.equal(resolvePiExecutable('/nonexistent-dir'), '/tmp/custom-pi');
  } finally {
    if (originalPiPath === undefined) delete process.env.PI_PATH;
    else process.env.PI_PATH = originalPiPath;
  }
});
