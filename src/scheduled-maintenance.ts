import { CronExpressionParser } from 'cron-parser';

import {
  FFT_NANO_TASK_ERROR_ALERT_THRESHOLD,
  MAIN_GROUP_FOLDER,
  TIMEZONE,
} from './config.js';
import { logger } from './logger.js';
import {
  createTask,
  enqueueDelivery,
  getDeliveryByDedupeKey,
  getTaskById,
} from './db.js';
import type { ScheduledTask } from './types.js';
import { resolveEffectiveTimezone } from './time-context.js';
import {
  buildLibrarianAgentPrompt,
  buildReflectionAgentPrompt,
} from './telegram-commands.js';
import type { OutboxDeliverer } from './outbox.js';
import {
  KNOWLEDGE_NIGHTLY_DEFAULT_CRON,
  KNOWLEDGE_NIGHTLY_TASK_ID,
} from './knowledge-wiki-task.js';

// ---------------------------------------------------------------------------
// Default maintenance task definitions
// ---------------------------------------------------------------------------
//
// SPEC-06 single source of truth for the cron tasks that should exist in the
// main group at all times. The curator tick reconciles the live `scheduled_tasks`
// table against this list every hour, and the boot path does the same.
//
// Removing a default task from this list (or its cron expression) is the only
// way to make a previously-seeded task disappear permanently — operator
// `/tasks cancel` will recreate it on the next reconciliation pass.

// Re-exported for callers (e.g. formatLearningDigest) that need to know what
// "empty" looks like without depending on knowledge-wiki-task.ts.
export {
  KNOWLEDGE_NIGHTLY_TASK_ID,
  KNOWLEDGE_NIGHTLY_DEFAULT_CRON,
};

export interface MaintenanceTaskDefinition {
  id: string;
  /** Cron expression (5-field standard) evaluated in the effective timezone. */
  scheduleValue: string;
  /** Builder that returns the prompt body to hand to the agent. */
  buildPrompt: () => string;
}

export const DEFAULT_MAINTENANCE_TASK_DEFINITIONS: MaintenanceTaskDefinition[] =
  [
    {
      id: KNOWLEDGE_NIGHTLY_TASK_ID,
      scheduleValue: KNOWLEDGE_NIGHTLY_DEFAULT_CRON,
      buildPrompt: () => buildKnowledgeNightlyPromptForMaintenance(),
    },
    {
      id: 'task-main-weekly-librarian',
      scheduleValue: '0 3 * * 0',
      buildPrompt: () => buildLibrarianAgentPrompt('run', ''),
    },
    {
      id: 'task-main-weekly-reflect',
      scheduleValue: '30 3 * * 0',
      buildPrompt: () => buildReflectionAgentPrompt('run', ''),
    },
  ];

function buildKnowledgeNightlyPromptForMaintenance(): string {
  // Keep the historical knowledge-nightly prompt intact. This is the same
  // wording `ensureKnowledgeNightlyTask()` used at insertion time before
  // SPEC-06; preserving the prompt string ensures an existing task survives
  // a re-reconciliation without its prompt mutating.
  return [
    'Nightly knowledge librarian maintenance run.',
    '',
    'This is a knowledge-base curator. It is NOT a memory task. The wiki is',
    'for what the agent has *read* (operator-curated sources in',
    "`knowledge/raw/`). The agent's own working memory lives in `canonical/`,",
    '`MEMORY.md`, and `memory/YYYY-MM-DD.md`. Do not write any of those here.',
    '',
    'Scope:',
    '1. Read `knowledge/schema/qualia-schema.md` and `knowledge/wiki/index.md`.',
    '2. List the contents of `knowledge/raw/` AND `knowledge/raw/_archived/`.',
    '   For each capture not yet integrated, decide what entity, concept,',
    '   comparison, or procedure it informs. Archived captures are valid',
    '   re-curation material when live `raw/` is empty or when a wiki page',
    '   exists for the topic but has stale/missing v2 frontmatter. Promote',
    '   them back to active `raw/` for this run (never edit the archive',
    '   copy in place; it is immutable source-of-truth).',
    '3. For each new entity or topic:',
    '   - Create or update a page under `knowledge/wiki/` following the schema',
    '     (frontmatter + Summary, Facts with source citations,',
    '     Cross-references, Contradictions, Open questions, Sources).',
    '   - Cite the raw capture inline as `[raw/<capture-filename>]` next to',
    '     every non-obvious claim.',
    '   - Add a relative link from the new/updated page to related pages,',
    '     and add a one-line entry to `knowledge/wiki/index.md`.',
    '4. When a newer source contradicts an older one, surface it inline in',
    "   the page's `## Contradictions` section. Do not silently overwrite.",
    "5. Update `knowledge/wiki/progress.md` with one new row: today's date,",
    '   one-sentence summary of what was integrated, one next-action item.',
    '6. Append one entry to `knowledge/wiki/log.md` of the form:',
    '   `- <ISO timestamp> [integrate] sources=<n> pages_touched=<list>`.',
    '7. Run `knowledge/wiki` lint if available; otherwise self-check the',
    '   schema conformance of the pages you touched.',
    '',
    'Hard rules:',
    '- Never modify anything in `knowledge/raw/`. Raw captures are',
    '  immutable. The operator owns them.',
    "- Never write the agent's own working notes, decisions, or",
    '  self-reflection into `knowledge/wiki/`. That is what `canonical/` and',
    "  `memory/` are for. If a fact is about the operator or the agent's",
    '  own state, it does not belong here even if a raw capture mentions it.',
    '- Every non-obvious claim needs a `[raw/...]` source citation. If you',
    '  cannot cite a raw capture for a claim, drop the claim.',
    '- If there is nothing to curate, log a NOOP with reason and exit.',
    '- Keep pages concise. Prefer revising an existing page over creating a',
    '  near-duplicate. Cross-link aggressively.',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// ensureDefaultMaintenanceTasks
// ---------------------------------------------------------------------------

export interface EnsureDefaultMaintenanceTasksResult {
  created: number;
  existing: number;
  taskIds: string[];
  skippedReason?: string;
}

/**
 * Idempotently reconcile `scheduled_tasks` against
 * `DEFAULT_MAINTENANCE_TASK_DEFINITIONS`. Missing rows are created with their
 * canonical id, schedule_value, prompt, and `delivery_mode: 'none'`. Existing
 * rows are left alone (no `consecutive_errors` / `status` mutation), matching
 * the existing `ensureKnowledgeNightlyTask` getTaskById guard.
 *
 * Safe to call from boot, from the hourly curator tick, and from manual
 * `/knowledge task`. Concurrent calls are safe; the per-id `getTaskById`
 * check serializes inserts at the row level.
 */
export function ensureDefaultMaintenanceTasks(params: {
  mainChatJid: string | null;
  now?: Date;
}): EnsureDefaultMaintenanceTasksResult {
  const now = params.now || new Date();
  const taskIds: string[] = [];
  let created = 0;
  let existing = 0;

  // Skip the whole pass if no main chat is registered — we cannot compute a
  // chat_jid for the new rows and a chatless run would be useless.
  if (!params.mainChatJid) {
    return {
      created: 0,
      existing: 0,
      taskIds: [],
      skippedReason: 'main chat is not registered yet',
    };
  }

  for (const def of DEFAULT_MAINTENANCE_TASK_DEFINITIONS) {
    taskIds.push(def.id);
    if (getTaskById(def.id)) {
      existing += 1;
      continue;
    }
    const nextRun = computeNextRunForCron(def.scheduleValue, now);
    try {
      createTask({
        id: def.id,
        group_folder: MAIN_GROUP_FOLDER,
        chat_jid: params.mainChatJid,
        prompt: def.buildPrompt(),
        schedule_type: 'cron',
        schedule_value: def.scheduleValue,
        context_mode: 'isolated',
        schedule_json: JSON.stringify({
          kind: 'cron',
          expr: def.scheduleValue,
          tz: resolveEffectiveTimezone(undefined, TIMEZONE),
        }),
        session_target: 'isolated',
        wake_mode: 'next-heartbeat',
        delivery_mode: 'none',
        delivery_channel: null,
        delivery_to: null,
        delivery_webhook_url: null,
        timeout_seconds: null,
        stagger_ms: null,
        delete_after_run: 0,
        consecutive_errors: 0,
        subagent_type: null,
        next_run: nextRun,
        status: 'active',
        created_at: now.toISOString(),
      });
      created += 1;
      logger.info(
        {
          taskId: def.id,
          schedule: def.scheduleValue,
          nextRun,
        },
        'Seeded default maintenance task',
      );
    } catch (err) {
      logger.warn(
        { err, taskId: def.id },
        'Failed to seed default maintenance task',
      );
    }
  }

  return { created, existing, taskIds };
}

function computeNextRunForCron(expr: string, now: Date): string {
  const timezone = resolveEffectiveTimezone(undefined, TIMEZONE);
  try {
    const interval = CronExpressionParser.parse(expr, {
      tz: timezone,
      currentDate: now,
    });
    const computed = interval.next().toISOString();
    if (computed) return computed;
  } catch (err) {
    logger.warn(
      { err, expr, timezone },
      'Failed to compute next run for default maintenance task',
    );
  }
  // Fallback: 24h. Better than a NULL that disables the task.
  return new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
}

// ---------------------------------------------------------------------------
// Error-streak witness
// ---------------------------------------------------------------------------

/**
 * Pure decision helper used by both runScheduledTaskV2 and tests. Returns true
 * exactly when `consecutiveErrors` is a positive multiple of `threshold` —
 * i.e. the cadence: at/after threshold (3 by default), then 6, 9, 12, …
 *
 * A threshold of 0 disables the witness. Returns null (not a boolean) for
 * "no event" so the call site can distinguish "below threshold" from "already
 * delivered for this count" without a flag.
 */
export function resolveErrorStreakAlertTrigger(
  consecutiveErrors: number,
  threshold: number,
): true | null {
  if (!Number.isFinite(consecutiveErrors) || consecutiveErrors <= 0) {
    return null;
  }
  if (!Number.isFinite(threshold) || threshold <= 0) {
    return null;
  }
  return consecutiveErrors % threshold === 0 ? true : null;
}

/**
 * Fire (or skip) the cross-cutting ops witness for a task whose consecutive
 * error count just hit `consecutiveErrors`. The dedupe key
 * `task-error-streak:<task.id>:<consecutiveErrors>` means a re-run at the
 * same count is a no-op; a run at 4 (non-multiple) never enqueues, and the
 * next multiple (6) enqueues a second row.
 *
 * Independent of the task's own `delivery_mode` — even tasks configured
 * `delivery_mode: 'none'` get the witness. The check is purely a function of
 * the counter; `delivery_mode` is reserved for per-run output.
 *
 * Returns true when a new outbox row was queued; false on dedupe / disabled /
 * non-multiple.
 */
export async function maybeFireErrorStreakAlert(params: {
  task: Pick<ScheduledTask, 'id' | 'consecutive_errors'>;
  consecutiveErrors: number;
  threshold?: number;
  destination: string;
  outbox: OutboxDeliverer;
  now?: Date;
}): Promise<boolean> {
  const threshold =
    params.threshold ??
    (Number.isFinite(FFT_NANO_TASK_ERROR_ALERT_THRESHOLD)
      ? FFT_NANO_TASK_ERROR_ALERT_THRESHOLD
      : 3);

  if (resolveErrorStreakAlertTrigger(params.consecutiveErrors, threshold) !== true) {
    return false;
  }

  const dedupeKey = `task-error-streak:${params.task.id}:${params.consecutiveErrors}`;

  // Idempotency guard: short-circuit before enqueueing so the function's
  // boolean return reflects "newly enqueued" vs "deduped". The outbox's
  // deliver() does the same check internally, but its boolean return
  // conflates duplicate-with-pending-attempt and successful delivery, so
  // we check up-front to keep the contract honest for callers.
  if (getDeliveryByDedupeKey(dedupeKey)) {
    return false;
  }

  const lastError = truncateError(params.task);
  const body = `[scheduled-maintenance] ${params.task.id} failed ${params.consecutiveErrors} times in a row (latest: ${lastError}). Run /tasks for detail.`;

  // Enqueue directly so a duplicate insert (race with another concurrent
  // tick) cannot race past this function returning `true` for a row that is
  // actually a duplicate.
  const { duplicate } = enqueueDelivery({
    dedupeKey,
    destination: params.destination,
    body,
  });
  if (duplicate) {
    return false;
  }

  // Best-effort attempt the delivery so a healthy channel surfaces the alert
  // immediately. Failure here only matters for `delivered`; a transport
  // outage leaves the row pending for the next flushPending tick.
  try {
    await params.outbox.deliver({
      dedupeKey,
      destination: params.destination,
      body,
    });
  } catch (err) {
    logger.warn(
      { err, taskId: params.task.id, dedupeKey },
      'Failed to attempt task-error-streak witness delivery',
    );
  }
  return true;
}

function truncateError(task: Pick<ScheduledTask, 'consecutive_errors'>): string {
  // We deliberately do not surface the raw last_result text — many task
  // results include prompt-shaped content that would leak across boundaries.
  // "consecutive_errors=N" is enough for the operator to look up the row.
  return `consecutive_errors=${task.consecutive_errors ?? 'unknown'}`;
}

// ---------------------------------------------------------------------------
// Maintenance digest helpers
// ---------------------------------------------------------------------------

/**
 * Pure text builder used by formatLearningDigest. Returns the body lines for
 * the "Scheduled maintenance" section. Kept as a top-level export so the digest
 * and tests can call it without depending on telegram-delivery.ts imports.
 *
 * `now` is exposed for deterministic tests.
 */
export function buildMaintenanceDigestSection(params: {
  tasks: ScheduledTask[];
  threshold: number;
  expectedDefaultTaskIds: readonly string[];
  now?: Date;
}): string[] {
  const lines: string[] = ['Scheduled maintenance:'];

  if (params.tasks.length === 0) {
    if (params.expectedDefaultTaskIds.length === 0) {
      lines.push('  (no scheduled tasks configured)');
    } else {
      lines.push(
        `  ALARM: no scheduled tasks found; expected default tasks: ${params.expectedDefaultTaskIds.join(', ')}`,
      );
    }
    return lines;
  }

  const active = params.tasks.filter((t) => t.status === 'active');
  lines.push(`  ${active.length}/${params.tasks.length} active`);

  const unhealthy = params.tasks
    .filter(
      (t) =>
        (t.consecutive_errors ?? 0) >= params.threshold &&
        params.threshold > 0,
    )
    .sort((a, b) => (b.consecutive_errors ?? 0) - (a.consecutive_errors ?? 0));

  if (unhealthy.length === 0) {
    lines.push('  all tasks healthy (no streaks at/above threshold)');
  } else {
    lines.push('  Unhealthy tasks (errors >= threshold):');
    for (const task of unhealthy.slice(0, 5)) {
      const errCount = task.consecutive_errors ?? 0;
      lines.push(
        `    - ${task.id}: errors=${errCount}, status=${task.status}`,
      );
    }
    if (unhealthy.length > 5) {
      lines.push(`    ... and ${unhealthy.length - 5} more`);
    }
  }

  return lines;
}
