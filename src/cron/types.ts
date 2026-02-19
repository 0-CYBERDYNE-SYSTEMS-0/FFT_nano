export type CronV2Schedule =
  | { kind: 'at'; at: string }
  | { kind: 'every'; everyMs: number; anchorMs?: number }
  | { kind: 'cron'; expr: string; tz?: string; staggerMs?: number };

export type CronV2SessionTarget = 'main' | 'isolated';
export type CronV2WakeMode = 'next-heartbeat' | 'now';
export type CronV2DeliveryMode = 'none' | 'announce' | 'webhook';

export interface CronV2Delivery {
  mode: CronV2DeliveryMode;
  channel?: 'chat';
  to?: string;
  webhookUrl?: string;
}

export interface CronV2Policy {
  sessionTarget: CronV2SessionTarget;
  wakeMode: CronV2WakeMode;
  delivery: CronV2Delivery;
  timeoutSeconds?: number;
  staggerMs?: number;
  deleteAfterRun?: boolean;
}

export interface CronV2BackoffState {
  consecutiveErrors: number;
}

export interface CronV2ExecutionPlan {
  scheduleType: 'cron' | 'interval' | 'once';
  scheduleValue: string;
  nextRun: string | null;
  scheduleJson?: string;
}

