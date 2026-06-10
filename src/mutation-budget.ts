import { PARITY_CONFIG } from './config.js';
import { logger } from './logger.js';
import { getDb } from './db.js';

// ---------------------------------------------------------------------------
// Mutation budget state
//
// Per-run budgets: tracked in memory (authorityId → counters).
// Rolling-window budgets: tracked in SQLite via mutation_budget_events table.
// Attribution: stamped on every mutation via authorityId + senderRole + jid.
// ---------------------------------------------------------------------------

export type MutationType = 'skill' | 'memory';

/** Result of a mutation budget check. */
export interface MutationBudgetResult {
  allowed: boolean;
  reason?: string;
  /** True if this was a per-run budget hit (as opposed to rolling-window hit). */
  perRunHit?: boolean;
}

/** Attribution data for a mutation event. */
export interface MutationAttribution {
  authorityId: string;
  senderRole: 'operator' | 'member' | 'unknown';
  jid?: string;
}

// ── Per-run budget tracking ──────────────────────────────────────────────────

interface PerRunCounters {
  skillMutations: number;
  memoryMutations: number;
}

// In-memory per-run counters keyed by authorityId
const perRunCounters = new Map<string, PerRunCounters>();

function getPerRunCounters(authorityId: string): PerRunCounters {
  let counters = perRunCounters.get(authorityId);
  if (!counters) {
    counters = { skillMutations: 0, memoryMutations: 0 };
    perRunCounters.set(authorityId, counters);
  }
  return counters;
}

function incrementPerRun(
  authorityId: string,
  mutationType: MutationType,
): PerRunCounters {
  const counters = getPerRunCounters(authorityId);
  if (mutationType === 'skill') {
    counters.skillMutations += 1;
  } else {
    counters.memoryMutations += 1;
  }
  return counters;
}

function getPerRunLimit(mutationType: MutationType): number {
  const config = PARITY_CONFIG.skills.mutationBudget?.perRun;
  if (!config) return mutationType === 'skill' ? 5 : 10;
  return mutationType === 'skill'
    ? config.skillMutations
    : config.memoryMutations;
}

function getPerRunCount(
  authorityId: string,
  mutationType: MutationType,
): number {
  const counters = perRunCounters.get(authorityId);
  if (!counters) return 0;
  return mutationType === 'skill'
    ? counters.skillMutations
    : counters.memoryMutations;
}

// ── Rolling-window budget tracking (SQLite) ──────────────────────────────────

/**
 * Record a mutation event to the rolling-window SQLite table.
 * Returns the count of mutations of the given type in the rolling window.
 */
export function recordMutationEvent(params: {
  groupFolder: string;
  authorityId: string;
  senderRole: string;
  mutationType: MutationType;
  jid?: string;
}): void {
  const db = getDb();
  if (!db) return;

  const config = PARITY_CONFIG.skills.mutationBudget?.rollingWindow;
  const windowMinutes = config?.windowMinutes ?? 60;

  try {
    db.prepare(
      `INSERT INTO mutation_budget_events
        (group_folder, authority_id, sender_role, mutation_type, jid, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      params.groupFolder,
      params.authorityId,
      params.senderRole,
      params.mutationType,
      params.jid ?? null,
      new Date().toISOString(),
    );

    // Prune old events outside the rolling window (best-effort, runs on every insert)
    const cutoff = new Date(
      Date.now() - windowMinutes * 60 * 1000,
    ).toISOString();
    db.prepare(
      `DELETE FROM mutation_budget_events WHERE created_at < ?`,
    ).run(cutoff);
  } catch (err) {
    logger.warn({ err, params }, 'Failed to record mutation event');
  }
}

/**
 * Get the count of mutations of the given type in the rolling window for a group.
 */
export function getRollingWindowCount(
  groupFolder: string,
  mutationType: MutationType,
): number {
  const db = getDb();
  if (!db) return 0;

  const config = PARITY_CONFIG.skills.mutationBudget?.rollingWindow;
  const windowMinutes = config?.windowMinutes ?? 60;
  const cutoff = new Date(
    Date.now() - windowMinutes * 60 * 1000,
  ).toISOString();

  try {
    const row = db
      .prepare(
        `SELECT COUNT(*) as count FROM mutation_budget_events
         WHERE group_folder = ?
           AND mutation_type = ?
           AND created_at >= ?`,
      )
      .get(groupFolder, mutationType, cutoff) as { count: number } | undefined;
    return row?.count ?? 0;
  } catch (err) {
    logger.warn({ err, groupFolder, mutationType }, 'Failed to query rolling window count');
    return 0;
  }
}

function getRollingWindowLimit(): number {
  const config = PARITY_CONFIG.skills.mutationBudget?.rollingWindow;
  return config?.maxMutations ?? 20;
}

// ── Main budget check ────────────────────────────────────────────────────────

/**
 * Check whether a mutation is allowed under both per-run and rolling-window budgets.
 * Returns { allowed: true } if the mutation can proceed.
 * Returns { allowed: false, reason, perRunHit } if blocked.
 *
 * This function does NOT record the mutation — callers must call recordMutation()
 * after a successful mutation.
 */
export function checkMutationBudget(params: {
  groupFolder: string;
  attribution: MutationAttribution;
  mutationType: MutationType;
}): MutationBudgetResult {
  // 1. Per-run budget check — only applies when authorityId is known.
  // When authorityId is 'unknown' (no registered run authority, e.g. in tests
  // or edge cases), we skip the per-run check since we cannot reliably attribute
  // the mutation to a specific run. The rolling-window budget still applies.
  const perRunLimit = getPerRunLimit(params.mutationType);
  const perRunCount = getPerRunCount(
    params.attribution.authorityId,
    params.mutationType,
  );

  if (params.attribution.authorityId !== 'unknown' && perRunCount >= perRunLimit) {
    return {
      allowed: false,
      reason: `per-run ${params.mutationType} mutation budget exceeded (${perRunCount}/${perRunLimit})`,
      perRunHit: true,
    };
  }

  // 2. Rolling-window budget check — always applies (per-group, persisted in SQLite)
  const rollingLimit = getRollingWindowLimit();
  const rollingCount = getRollingWindowCount(
    params.groupFolder,
    params.mutationType,
  );

  if (rollingCount >= rollingLimit) {
    return {
      allowed: false,
      reason: `rolling-window ${params.mutationType} mutation budget exceeded (${rollingCount}/${rollingLimit} in rolling window)`,
      perRunHit: false,
    };
  }

  return { allowed: true };
}

/**
 * Record a successful mutation (increment per-run counter and SQLite rolling window).
 */
export function recordMutation(params: {
  groupFolder: string;
  attribution: MutationAttribution;
  mutationType: MutationType;
}): void {
  // Increment per-run counter only when authorityId is known
  if (params.attribution.authorityId !== 'unknown') {
    incrementPerRun(params.attribution.authorityId, params.mutationType);
  }

  // Record in rolling-window SQLite table
  recordMutationEvent({
    groupFolder: params.groupFolder,
    authorityId: params.attribution.authorityId,
    senderRole: params.attribution.senderRole,
    mutationType: params.mutationType,
    jid: params.attribution.jid,
  });
}

/**
 * Clear per-run counters for an authorityId (called when a run ends).
 */
export function clearPerRunCounters(authorityId: string): void {
  perRunCounters.delete(authorityId);
}
