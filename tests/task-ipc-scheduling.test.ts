import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computeTaskNextRun,
  normalizeTaskScheduleType,
  resolveTaskResumeNextRun,
} from '../src/task-schedule.js';

test('schedule_task rejects invalid schedule_type', () => {
  assert.equal(normalizeTaskScheduleType('weekly'), undefined);
  assert.equal(normalizeTaskScheduleType(''), undefined);
});

test('schedule_task rejects invalid schedule values', () => {
  assert.equal(computeTaskNextRun('cron', 'bad cron'), null);
  assert.equal(computeTaskNextRun('interval', '0'), null);
  assert.equal(computeTaskNextRun('once', 'not-a-date'), null);
});

test('resume_task repairs missing next_run', () => {
  const now = Date.now();
  const repaired = resolveTaskResumeNextRun(
    {
      schedule_type: 'interval',
      schedule_value: '60000',
      next_run: null,
    },
    now,
  );
  assert.equal(Date.parse(repaired), now + 60000);
});

