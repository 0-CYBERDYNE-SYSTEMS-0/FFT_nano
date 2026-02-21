import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computeRecurringTaskNextRun,
  computeTaskNextRun,
  normalizeTaskScheduleType,
  resolveTaskResumeNextRun,
} from '../src/task-schedule.js';

test('normalizeTaskScheduleType accepts valid values and rejects invalid', () => {
  assert.equal(normalizeTaskScheduleType('cron'), 'cron');
  assert.equal(normalizeTaskScheduleType(' interval '), 'interval');
  assert.equal(normalizeTaskScheduleType('ONCE'), 'once');
  assert.equal(normalizeTaskScheduleType('hourly'), undefined);
});

test('computeTaskNextRun handles valid cron, interval, and once schedules', () => {
  const now = Date.now();

  const cronNext = computeTaskNextRun('cron', '*/5 * * * *', now);
  assert.ok(cronNext);
  assert.ok(Date.parse(cronNext) > now);

  const intervalNext = computeTaskNextRun('interval', '60000', now);
  assert.ok(intervalNext);
  assert.equal(Date.parse(intervalNext), now + 60000);

  const onceFuture = new Date(now + 120000).toISOString();
  const onceNext = computeTaskNextRun('once', onceFuture, now);
  assert.equal(onceNext, onceFuture);
});

test('computeTaskNextRun rejects invalid schedules', () => {
  const now = Date.now();
  assert.equal(computeTaskNextRun('cron', 'not a cron', now), null);
  assert.equal(computeTaskNextRun('interval', '0', now), null);
  assert.equal(computeTaskNextRun('interval', '-500', now), null);
  assert.equal(computeTaskNextRun('once', 'not-a-date', now), null);
});

test('computeRecurringTaskNextRun only returns values for recurring schedules', () => {
  const now = Date.now();
  assert.equal(
    computeRecurringTaskNextRun(
      { schedule_type: 'once', schedule_value: new Date(now + 1000).toISOString() },
      now,
    ),
    null,
  );
  assert.ok(
    computeRecurringTaskNextRun(
      { schedule_type: 'interval', schedule_value: '1000' },
      now,
    ),
  );
});

test('resolveTaskResumeNextRun repairs missing or invalid next_run', () => {
  const now = Date.now();
  const existing = new Date(now + 4000).toISOString();
  assert.equal(
    resolveTaskResumeNextRun({
      schedule_type: 'interval',
      schedule_value: '2000',
      next_run: existing,
    }, now),
    existing,
  );

  const repaired = resolveTaskResumeNextRun({
    schedule_type: 'interval',
    schedule_value: '2000',
    next_run: null,
  }, now);
  assert.equal(Date.parse(repaired), now + 2000);
});

