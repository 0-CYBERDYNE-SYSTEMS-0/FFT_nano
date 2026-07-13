/**
 * Single authority policy table for who may announce / mutate by run origin.
 *
 * This is the source of truth. permission-gate-policy, outbox hold paths, and
 * docs must follow this table — not free-form comments.
 *
 * Inputs are host-only (RunAuthority). Never consult agent-authored IPC fields.
 */

import type { RunAuthority, RunOrigin } from './types.js';

export type AuthorityActionCategory =
  | 'read'
  | 'local-mutate'
  | 'outbound'
  | 'schedule'
  | 'destroy';

export type AuthorityDecisionKind = 'allow' | 'block' | 'confirm' | 'held';

export interface AuthorityDecision {
  action: AuthorityDecisionKind;
  /** Stable machine-readable reason code for logs/tests. */
  reasonCode: string;
  /** Human-readable detail (optional). */
  detail?: string;
}

/**
 * Canonical (origin, grant, category) → decision table.
 *
 * Notes:
 * - operatorGrant only matters for headless/subagent outbound (announce/send).
 * - schedule stays allow at the tool gate; pending_approval is enforced at IPC.
 * - protected-path and destructive command details are layered on top by the
 *   permission gate (confirm vs block messages).
 */
export function decideAuthorityAction(params: {
  origin: RunOrigin;
  operatorGrant: boolean;
  category: AuthorityActionCategory;
}): AuthorityDecision {
  const { origin, operatorGrant, category } = params;

  if (origin === 'maintenance') {
    return {
      action: 'block',
      reasonCode: 'maintenance-deny-all',
      detail:
        'Maintenance runs may only return structured learning proposals.',
    };
  }

  if (category === 'read' || category === 'local-mutate') {
    return { action: 'allow', reasonCode: 'read-or-local-mutate-allow' };
  }

  if (category === 'destroy') {
    if (origin === 'interactive-main' && operatorGrant) {
      return {
        action: 'confirm',
        reasonCode: 'destroy-confirm-interactive',
      };
    }
    return {
      action: 'block',
      reasonCode: 'destroy-block-non-interactive',
      detail:
        origin === 'subagent'
          ? 'Subagents cannot execute destructive commands.'
          : 'Headless/evaluator runs cannot execute destructive commands without operator confirmation.',
    };
  }

  if (category === 'outbound') {
    // Announce / send / deliver: hold when headless or subagent lacks grant.
    if (
      (origin === 'headless' || origin === 'subagent') &&
      !operatorGrant
    ) {
      return {
        action: 'held',
        reasonCode: 'outbound-held-no-grant',
        detail:
          'Outbound delivery held until operator grant (operator-created or approved run).',
      };
    }
    return { action: 'allow', reasonCode: 'outbound-allow' };
  }

  if (category === 'schedule') {
    // Tool-level allow; host IPC enforces pending_approval for agent-created tasks.
    return { action: 'allow', reasonCode: 'schedule-allow' };
  }

  return {
    action: 'block',
    reasonCode: 'unknown-category-block',
    detail: `Unknown authority category`,
  };
}

/** Convenience: may this authority announce/send outbound without hold? */
export function mayAnnounce(authority: Pick<RunAuthority, 'origin' | 'operatorGrant'>): boolean {
  return (
    decideAuthorityAction({
      origin: authority.origin,
      operatorGrant: authority.operatorGrant,
      category: 'outbound',
    }).action === 'allow'
  );
}

/** Convenience: may this authority mutate local files (non-protected)? */
export function mayMutateLocal(
  authority: Pick<RunAuthority, 'origin' | 'operatorGrant'>,
): boolean {
  return (
    decideAuthorityAction({
      origin: authority.origin,
      operatorGrant: authority.operatorGrant,
      category: 'local-mutate',
    }).action === 'allow'
  );
}

/**
 * Resolve operatorGrant from host signals only.
 *
 * - interactive-main / evaluator → true
 * - host override (e.g. operator-created scheduled task at spawn) → use override
 * - otherwise false (agent headless / subagent)
 *
 * Never accepts agent-authored created_by strings — callers must map host DB
 * fields to a boolean before mint.
 */
export function resolveOperatorGrant(params: {
  origin: RunOrigin;
  /** Host-only grant stamp (e.g. scheduled task created_by === 'operator'). */
  hostOperatorGrant?: boolean;
}): boolean {
  if (params.origin === 'interactive-main' || params.origin === 'evaluator') {
    return true;
  }
  if (typeof params.hostOperatorGrant === 'boolean') {
    return params.hostOperatorGrant;
  }
  return false;
}
