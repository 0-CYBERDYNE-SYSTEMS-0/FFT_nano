import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDoctorReport } from '../src/doctor.js';

test('doctor report includes prompt lifecycle checks', () => {
  const report = buildDoctorReport();
  const lifecycle = report.checks.find((check) => check.id === 'prompt.lifecycle');
  assert.ok(lifecycle);
  assert.equal(typeof lifecycle.detail, 'string');
});
