import { CronExpressionParser } from 'cron-parser';

import { TIMEZONE } from '../config.js';
import { ScheduledTask } from '../types.js';
import { CronV2Delivery, CronV2ExecutionPlan, CronV2Policy, CronV2Schedule } from './types.js';

export interface ScheduleTaskIpcPayload {
  schedule_type?: string;
  schedule_value?: string;
  schedule?: CronV2Schedule | string;
  context_mode?: string;
  session_target?: string;
  wake_mode?: string;
  delivery_mode?: string;
  delivery_channel?: string;
  delivery_to?: string;
  delivery_webhook_url?: string;
  delivery?: {
    mode?: string;
    channel?: string;
    to?: string;
    webhookUrl?: string;
  };
  timeout_seconds?: number | string;
  stagger_ms?: number | string;
  delete_after_run?: boolean | number | string;
}

function parseFiniteInt(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.floor(value);
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function parseBool(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value > 0;
  if (typeof value === 'string') return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
  return false;
}

function parseScheduleObject(raw: unknown): CronV2Schedule | null {
  if (!raw) return null;
  if (typeof raw === 'string') {
    try {
      return parseScheduleObject(JSON.parse(raw));
    } catch {
      return null;
    }
  }
  if (typeof raw !== 'object') return null;
  const schedule = raw as Partial<CronV2Schedule>;
  if (schedule.kind === 'at' && typeof schedule.at === 'string') {
    return { kind: 'at', at: schedule.at };
  }
  if (schedule.kind === 'every' && typeof schedule.everyMs === 'number') {
    const everyMs = Math.floor(schedule.everyMs);
    if (!Number.isFinite(everyMs) || everyMs <= 0) {
      return null;
    }
    return {
      kind: 'every',
      everyMs,
      anchorMs: typeof schedule.anchorMs === 'number' ? Math.floor(schedule.anchorMs) : undefined,
    };
  }
  if (schedule.kind === 'cron' && typeof schedule.expr === 'string') {
    return {
      kind: 'cron',
      expr: schedule.expr,
      tz: typeof schedule.tz === 'string' ? schedule.tz : undefined,
      staggerMs: typeof schedule.staggerMs === 'number' ? Math.max(0, Math.floor(schedule.staggerMs)) : undefined,
    };
  }
  return null;
}

function normalizeDelivery(payload: ScheduleTaskIpcPayload): CronV2Delivery {
  const modeRaw = payload.delivery?.mode || payload.delivery_mode;
  const mode = modeRaw === 'announce' || modeRaw === 'webhook' || modeRaw === 'none' ? modeRaw : 'none';
  const channelRaw = payload.delivery?.channel || payload.delivery_channel;
  const channel = channelRaw === 'chat' ? 'chat' : undefined;
  const to = payload.delivery?.to || payload.delivery_to;
  const webhookUrl = payload.delivery?.webhookUrl || payload.delivery_webhook_url;
  return {
    mode,
    channel,
    to: typeof to === 'string' ? to : undefined,
    webhookUrl: typeof webhookUrl === 'string' ? webhookUrl : undefined,
  };
}

export function resolveCronExecutionPlan(
  payload: ScheduleTaskIpcPayload,
  nowMs = Date.now(),
): CronV2ExecutionPlan {
  const hasSchedule = payload.schedule !== undefined;
  const scheduleObj = parseScheduleObject(payload.schedule);
  if (hasSchedule && !scheduleObj) {
    throw new Error('Invalid schedule payload');
  }
  if (scheduleObj) {
    if (scheduleObj.kind === 'at') {
      const when = new Date(scheduleObj.at);
      if (Number.isNaN(when.getTime())) {
        throw new Error('Invalid schedule.at timestamp');
      }
      return {
        scheduleType: 'once',
        scheduleValue: when.toISOString(),
        nextRun: when.toISOString(),
        scheduleJson: JSON.stringify(scheduleObj),
      };
    }
    if (scheduleObj.kind === 'every') {
      const nextRun = new Date(nowMs + scheduleObj.everyMs).toISOString();
      return {
        scheduleType: 'interval',
        scheduleValue: String(scheduleObj.everyMs),
        nextRun,
        scheduleJson: JSON.stringify(scheduleObj),
      };
    }

    const expr = scheduleObj.expr.trim();
    const interval = CronExpressionParser.parse(expr, {
      tz: scheduleObj.tz || TIMEZONE,
      currentDate: new Date(nowMs),
    });
    return {
      scheduleType: 'cron',
      scheduleValue: expr,
      nextRun: interval.next().toISOString(),
      scheduleJson: JSON.stringify(scheduleObj),
    };
  }

  const scheduleType = payload.schedule_type as 'cron' | 'interval' | 'once';
  const scheduleValue = payload.schedule_value;
  if (!scheduleType || !scheduleValue) {
    throw new Error('Missing schedule_type/schedule_value');
  }
  if (scheduleType === 'cron') {
    const interval = CronExpressionParser.parse(scheduleValue, {
      tz: TIMEZONE,
      currentDate: new Date(nowMs),
    });
    return { scheduleType, scheduleValue, nextRun: interval.next().toISOString() };
  }
  if (scheduleType === 'interval') {
    const ms = Number.parseInt(scheduleValue, 10);
    if (!Number.isFinite(ms) || ms <= 0) {
      throw new Error('Invalid interval');
    }
    return {
      scheduleType,
      scheduleValue: String(ms),
      nextRun: new Date(nowMs + ms).toISOString(),
    };
  }
  if (scheduleType === 'once') {
    const when = new Date(scheduleValue);
    if (Number.isNaN(when.getTime())) {
      throw new Error('Invalid once timestamp');
    }
    return { scheduleType, scheduleValue: when.toISOString(), nextRun: when.toISOString() };
  }
  throw new Error('Unsupported schedule type');
}

export function resolveCronPolicy(payload: ScheduleTaskIpcPayload): CronV2Policy {
  const sessionTarget =
    payload.session_target === 'main' || payload.session_target === 'isolated'
      ? payload.session_target
      : 'isolated';
  const wakeMode = payload.wake_mode === 'now' || payload.wake_mode === 'next-heartbeat'
    ? payload.wake_mode
    : 'next-heartbeat';
  const timeoutSeconds = parseFiniteInt(payload.timeout_seconds);
  const staggerMs = parseFiniteInt(payload.stagger_ms);

  return {
    sessionTarget,
    wakeMode,
    delivery: normalizeDelivery(payload),
    timeoutSeconds:
      timeoutSeconds && timeoutSeconds > 0 ? Math.min(timeoutSeconds, 60 * 60) : undefined,
    staggerMs: staggerMs && staggerMs > 0 ? staggerMs : undefined,
    deleteAfterRun: parseBool(payload.delete_after_run),
  };
}

export function resolveNoContinueForTask(task: ScheduledTask): boolean {
  const contextMode = task.context_mode === 'group' ? 'group' : 'isolated';
  return contextMode === 'isolated';
}
