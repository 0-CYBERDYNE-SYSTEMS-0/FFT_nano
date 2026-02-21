import { CronExpressionParser } from 'cron-parser';

import { TIMEZONE } from './config.js';
import { ScheduledTask } from './types.js';

export function normalizeTaskScheduleType(
  raw: unknown,
): ScheduledTask['schedule_type'] | undefined {
  if (typeof raw !== 'string') return undefined;
  const key = raw.trim().toLowerCase();
  if (key === 'cron' || key === 'interval' || key === 'once') return key;
  return undefined;
}

export function computeTaskNextRun(
  scheduleType: ScheduledTask['schedule_type'],
  scheduleValue: string,
  nowMs = Date.now(),
): string | null {
  if (scheduleType === 'cron') {
    try {
      const interval = CronExpressionParser.parse(scheduleValue, {
        tz: TIMEZONE,
        currentDate: new Date(nowMs),
      });
      return interval.next().toISOString();
    } catch {
      return null;
    }
  }

  if (scheduleType === 'interval') {
    const ms = Number.parseInt(scheduleValue, 10);
    if (!Number.isFinite(ms) || ms <= 0) return null;
    return new Date(nowMs + ms).toISOString();
  }

  const scheduled = new Date(scheduleValue);
  if (isNaN(scheduled.getTime())) return null;
  const scheduledMs = scheduled.getTime();
  return new Date(scheduledMs > nowMs ? scheduledMs : nowMs).toISOString();
}

export function computeRecurringTaskNextRun(
  task: Pick<ScheduledTask, 'schedule_type' | 'schedule_value'>,
  nowMs = Date.now(),
): string | null {
  if (task.schedule_type === 'once') return null;
  return computeTaskNextRun(task.schedule_type, task.schedule_value, nowMs);
}

export function resolveTaskResumeNextRun(
  task: Pick<ScheduledTask, 'schedule_type' | 'schedule_value' | 'next_run'>,
  nowMs = Date.now(),
): string {
  if (task.next_run && !isNaN(Date.parse(task.next_run))) {
    return task.next_run;
  }
  return computeTaskNextRun(task.schedule_type, task.schedule_value, nowMs) ||
    new Date(nowMs).toISOString();
}
