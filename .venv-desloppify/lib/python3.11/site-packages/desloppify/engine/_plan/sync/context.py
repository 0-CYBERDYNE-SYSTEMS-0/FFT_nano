"""Shared helpers for queue-sync decisions.

Every sync module (``sync_triage``, ``sync_dimensions``, ``sync_workflow``,
``auto_cluster_sync``) needs to answer two questions:

1. **Is there an objective backlog?**  (Should we defer optional items?)
2. **Are we mid-cycle?**  (Has a queue cycle started and not yet completed?)

This module provides a single definition of each so the logic stays
consistent and changes propagate everywhere at once.
"""

from __future__ import annotations

from desloppify.engine._plan.schema import PlanModel
from desloppify.engine._plan.policy.subjective import (
    NON_OBJECTIVE_DETECTORS as _NON_OBJECTIVE_DETECTORS,
)
from desloppify.engine._plan.policy.subjective import (
    SubjectiveVisibility,
)
from desloppify.engine._state.schema import StateModel


def has_objective_backlog(
    state_or_issues: StateModel | dict,
    policy: SubjectiveVisibility | None,
) -> bool:
    """Return whether a planned objective backlog exists.

    Prefers the pre-computed *policy* snapshot when available (plan-aware:
    only counts planned objectives post-triage).  Falls back to scanning
    *state_or_issues* directly (counts all open non-subjective issues).
    """
    if policy is not None:
        return policy.has_objective_backlog

    # Accept either full state payload (`{"work_items": ...}`) or a raw
    # work-item mapping, with legacy ``issues`` as a fallback alias.
    issues = state_or_issues
    if isinstance(state_or_issues, dict):
        maybe_issues = state_or_issues.get("work_items")
        if not isinstance(maybe_issues, dict):
            maybe_issues = state_or_issues.get("issues")
        if isinstance(maybe_issues, dict):
            issues = maybe_issues
    return any(
        f.get("status") == "open"
        and f.get("detector") not in _NON_OBJECTIVE_DETECTORS
        and not f.get("suppressed")
        for f in issues.values()
    )


def is_mid_cycle(plan: PlanModel) -> bool:
    """True when a queue cycle is in progress.

    A cycle is active when ``plan_start_scores`` is set to real score
    values.  The ``{"reset": True}`` sentinel (set by lifecycle reset)
    does NOT count as mid-cycle — it means "seed real scores on next scan".
    """
    scores = plan.get("plan_start_scores")
    return bool(scores) and not (isinstance(scores, dict) and scores.get("reset"))


__all__ = ["has_objective_backlog", "is_mid_cycle"]
