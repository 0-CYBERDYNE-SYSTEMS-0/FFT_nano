/**
 * Operator-facing "why is the agent awake?" snapshot.
 *
 * Aggregates background loops (heartbeat, cron, curator, long-run resume,
 * self-improve) into one report block for /status.
 */

import fs from 'fs';
import path from 'path';

import {
  MAIN_GROUP_FOLDER,
  MAIN_WORKSPACE_DIR,
  PARITY_CONFIG,
} from './config.js';
import {
  getAllTasks,
  getNextDueTaskTime,
  listActiveAgentRuns,
  listRecoverableAgentRuns,
} from './db.js';
import {
  heartbeatLastSent,
  state,
} from './app-state.js';
import { HEARTBEAT_ENABLED } from './heartbeat-service.js';
import { isHeartbeatFileEffectivelyEmpty } from './heartbeat-policy.js';
import { resolveGroupFolderPath } from './group-folder.js';
import { loadSkillManagerState, resolveGroupSkillsDir } from './skill-lifecycle.js';
import { parseDurationMs } from './chat-preferences.js';

export interface AwakeActivitySnapshot {
  collectedAtMs: number;
  heartbeat: {
    enabled: boolean;
    every: string;
    loopStarted: boolean;
    lastSentAtMs: number | null;
    lastSentPreview: string | null;
    checklistEmpty: boolean;
  };
  cron: {
    active: number;
    paused: number;
    nextDueAt: string | null;
    overdueActive: number;
  };
  curator: {
    enabled: boolean;
    minIdleHours: number;
    lastInboundAtMs: number | null;
    idleForMs: number | null;
    idleEnough: boolean;
    lastReviewAt: string | null;
    learningPaused: boolean;
  };
  resume: {
    activeLongRuns: number;
    recoverable: number;
  };
  selfImprove: {
    lastEventAt: string | null;
    lastTrigger: string | null;
    lastFired: boolean | null;
  };
}

function formatAge(ms: number): string {
  const safe = Math.max(0, Math.floor(ms / 1000));
  if (safe < 60) return `${safe}s`;
  const minutes = Math.floor(safe / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  if (hours < 24) {
    return remMinutes > 0 ? `${hours}h ${remMinutes}m` : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
}

function readLastSelfImproveEvent(groupFolder: string): {
  at: string | null;
  trigger: string | null;
  fired: boolean | null;
} {
  const logPath = path.join(
    resolveGroupFolderPath(groupFolder),
    'logs',
    'self-improve-events.jsonl',
  );
  try {
    if (!fs.existsSync(logPath)) {
      return { at: null, trigger: null, fired: null };
    }
    const raw = fs.readFileSync(logPath, 'utf-8').trim();
    if (!raw) return { at: null, trigger: null, fired: null };
    const lines = raw.split('\n').filter(Boolean);
    const last = lines[lines.length - 1];
    const parsed = JSON.parse(last) as {
      ts?: string;
      trigger_reason?: string;
      review_fired?: boolean;
    };
    return {
      at: typeof parsed.ts === 'string' ? parsed.ts : null,
      trigger:
        typeof parsed.trigger_reason === 'string'
          ? parsed.trigger_reason
          : null,
      fired:
        typeof parsed.review_fired === 'boolean' ? parsed.review_fired : null,
    };
  } catch {
    return { at: null, trigger: null, fired: null };
  }
}

export function collectAwakeActivitySnapshot(
  nowMs = Date.now(),
): AwakeActivitySnapshot {
  const tasks = getAllTasks();
  const activeTasks = tasks.filter((t) => t.status === 'active');
  const pausedTasks = tasks.filter((t) => t.status === 'paused');
  const nextDue = getNextDueTaskTime();
  const overdueActive = activeTasks.filter((t) => {
    if (!t.next_run) return false;
    const due = Date.parse(t.next_run);
    return Number.isFinite(due) && due <= nowMs;
  }).length;

  let lastSentAtMs: number | null = null;
  let lastSentPreview: string | null = null;
  for (const entry of heartbeatLastSent.values()) {
    if (lastSentAtMs === null || entry.sentAt > lastSentAtMs) {
      lastSentAtMs = entry.sentAt;
      lastSentPreview = entry.text.slice(0, 80);
    }
  }

  const lastInboundAt =
    state.lastInboundAt > 0 ? state.lastInboundAt : null;
  const idleForMs =
    lastInboundAt !== null ? Math.max(0, nowMs - lastInboundAt) : null;
  const minIdleHours = PARITY_CONFIG.skills.curator.minIdleHours;
  const idleEnough =
    idleForMs !== null &&
    idleForMs >= minIdleHours * 60 * 60 * 1000;

  let lastReviewAt: string | null = null;
  try {
    const skillsDir = resolveGroupSkillsDir(MAIN_GROUP_FOLDER);
    const mgr = loadSkillManagerState(skillsDir);
    lastReviewAt = mgr.lastRunAt || null;
  } catch {
    lastReviewAt = null;
  }

  const selfImprove = readLastSelfImproveEvent(MAIN_GROUP_FOLDER);

  return {
    collectedAtMs: nowMs,
    heartbeat: {
      enabled: HEARTBEAT_ENABLED,
      every: PARITY_CONFIG.heartbeat.every || '4h',
      loopStarted: state.heartbeatLoopStarted === true,
      lastSentAtMs,
      lastSentPreview,
      checklistEmpty: isHeartbeatFileEffectivelyEmpty(
        path.join(MAIN_WORKSPACE_DIR, 'HEARTBEAT.md'),
      ),
    },
    cron: {
      active: activeTasks.length,
      paused: pausedTasks.length,
      nextDueAt: nextDue,
      overdueActive,
    },
    curator: {
      enabled: PARITY_CONFIG.skills.curator.enabled,
      minIdleHours,
      lastInboundAtMs: lastInboundAt,
      idleForMs,
      idleEnough,
      lastReviewAt,
      learningPaused: state.learningPaused === true,
    },
    resume: {
      activeLongRuns: listActiveAgentRuns().length,
      recoverable: listRecoverableAgentRuns().length,
    },
    selfImprove: {
      lastEventAt: selfImprove.at,
      lastTrigger: selfImprove.trigger,
      lastFired: selfImprove.fired,
    },
  };
}

/** Format the "Why awake?" block for /status. */
export function formatAwakeActivitySection(
  snapshot: AwakeActivitySnapshot,
  nowMs = snapshot.collectedAtMs,
): string {
  const lines: string[] = ['', 'Why is the agent awake?'];

  const hb = snapshot.heartbeat;
  const hbAge =
    hb.lastSentAtMs !== null
      ? `${formatAge(nowMs - hb.lastSentAtMs)} ago`
      : 'never';
  lines.push(
    `- heartbeat: ${hb.enabled ? 'on' : 'off'} every=${hb.every} loop=${hb.loopStarted ? 'running' : 'stopped'} last_alert=${hbAge}${hb.checklistEmpty ? ' checklist=empty(skipped)' : ''}`,
  );

  const cron = snapshot.cron;
  const nextDueLabel = cron.nextDueAt
    ? (() => {
        const dueMs = Date.parse(cron.nextDueAt!);
        if (!Number.isFinite(dueMs)) return cron.nextDueAt;
        const delta = dueMs - nowMs;
        return delta <= 0
          ? `overdue by ${formatAge(-delta)}`
          : `in ${formatAge(delta)}`;
      })()
    : 'none';
  lines.push(
    `- cron: active=${cron.active} paused=${cron.paused} next=${nextDueLabel}${cron.overdueActive > 0 ? ` overdue_now=${cron.overdueActive}` : ''}`,
  );

  const cur = snapshot.curator;
  const idleLabel =
    cur.idleForMs !== null ? formatAge(cur.idleForMs) : 'unknown';
  lines.push(
    `- curator: ${cur.enabled ? 'on' : 'off'} idle=${idleLabel} (need ${cur.minIdleHours}h) ready=${cur.idleEnough ? 'yes' : 'no'} last_review=${cur.lastReviewAt || 'never'}${cur.learningPaused ? ' learning=PAUSED' : ''}`,
  );

  const res = snapshot.resume;
  lines.push(
    `- resume: active_long_runs=${res.activeLongRuns} recoverable=${res.recoverable}`,
  );

  const si = snapshot.selfImprove;
  lines.push(
    `- self_improve: last=${si.lastEventAt || 'never'}${si.lastTrigger ? ` trigger=${si.lastTrigger}` : ''}${si.lastFired === null ? '' : si.lastFired ? ' fired=yes' : ' fired=no'}`,
  );

  // One-line operator answer.
  const reasons: string[] = [];
  if (hb.enabled && hb.loopStarted) reasons.push('heartbeat-loop');
  if (cron.active > 0) reasons.push(`cron(${cron.active} active)`);
  if (cron.overdueActive > 0) reasons.push('cron-overdue');
  if (res.activeLongRuns > 0) reasons.push('long-run');
  if (res.recoverable > 0) reasons.push('recoverable-resume');
  if (cur.enabled && cur.idleEnough && !cur.learningPaused) {
    reasons.push('curator-idle-ready');
  }
  lines.push(
    `- summary: ${reasons.length > 0 ? reasons.join(', ') : 'idle (no background work due)'}`,
  );

  return lines.join('\n');
}

/** Interval ms for heartbeat config (exported for tests). */
export function heartbeatIntervalMs(): number {
  return (
    parseDurationMs(PARITY_CONFIG.heartbeat.every || '4h') ||
    4 * 60 * 60 * 1000
  );
}
