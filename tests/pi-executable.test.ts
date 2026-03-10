import assert from 'node:assert/strict';
import test from 'node:test';

import { resolvePiExecutable } from '../src/pi-executable.js';

test('resolvePiExecutable prefers repo-local fallback when global pi is absent', () => {
  const originalPath = process.env.PATH;
  const originalPiPath = process.env.PI_PATH;

  process.env.PATH = '';
  delete process.env.PI_PATH;

  try {
    const resolved = resolvePiExecutable('/home/scrimwiggins/FFT_nano');
    assert.equal(
      resolved,
      '/home/scrimwiggins/FFT_nano/container/agent-runner/node_modules/.bin/pi',
    );
  } finally {
    process.env.PATH = originalPath;
    if (originalPiPath === undefined) delete process.env.PI_PATH;
    else process.env.PI_PATH = originalPiPath;
  }
});

test('resolvePiExecutable honors PI_PATH override first', () => {
  const originalPiPath = process.env.PI_PATH;
  process.env.PI_PATH = '/tmp/custom-pi';

  try {
    assert.equal(resolvePiExecutable('/home/scrimwiggins/FFT_nano'), '/tmp/custom-pi');
  } finally {
    if (originalPiPath === undefined) delete process.env.PI_PATH;
    else process.env.PI_PATH = originalPiPath;
  }
});
