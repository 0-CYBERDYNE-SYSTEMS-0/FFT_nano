import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDoctorReport } from '../src/doctor.js';

test('doctor report includes prompt lifecycle checks', () => {
  const report = buildDoctorReport();
  const lifecycle = report.checks.find((check) => check.id === 'prompt.lifecycle');
  assert.ok(lifecycle);
  assert.equal(typeof lifecycle.detail, 'string');
});

test('doctor report includes resolved pi runtime checks', () => {
  const report = buildDoctorReport();
  const pi = report.checks.find((check) => check.id === 'runtime.pi');
  assert.ok(pi);
  assert.match(pi.summary, /Pi coding agent/);
  assert.equal(typeof pi.detail, 'string');
});
