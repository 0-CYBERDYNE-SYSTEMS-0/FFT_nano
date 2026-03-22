"""Unified queue-resolution context.

A frozen ``QueueContext`` computed once per operation replaces the scattered
``plan`` / ``target_strict`` / ``policy`` threading through function chains.
Callers build one context and pass it everywhere — makes the wrong thing
impossible.
"""

from __future__ import annotations

from dataclasses import dataclass

from desloppify.base.config import (
    DEFAULT_TARGET_STRICT_SCORE,
    target_strict_score_from_config,
)
from desloppify.engine._plan.persistence import (
    resolve_plan_load_status as resolve_persisted_plan_load_status,
)
from desloppify.engine.plan_state import PlanLoadStatus
from desloppify.engine._state.schema import StateModel
from desloppify.engine._work_queue.snapshot import QueueSnapshot, build_queue_snapshot


class _PlanAutoLoad:
    """Sentinel type: auto-load plan from disk."""


# Sentinel: "auto-load plan from disk" (the default).
_PLAN_AUTO_LOAD = _PlanAutoLoad()
PlanOption = dict | None | _PlanAutoLoad


@dataclass(frozen=True)
class QueueContext:
    """Immutable snapshot of resolved queue parameters.

    Built once via :func:`queue_context`, then threaded through queue
    builders and command helpers so every call site agrees on plan,
    target, and canonical queue facts.
    """

    plan: dict | None
    target_strict: float
    plan_load_status: PlanLoadStatus
    snapshot: QueueSnapshot


def resolve_plan_load_status(
    *,
    plan: PlanOption = _PLAN_AUTO_LOAD,
) -> PlanLoadStatus:
    """Resolve plan loading and explicitly report degraded mode."""
    if not isinstance(plan, _PlanAutoLoad):
        return PlanLoadStatus(plan=plan, degraded=False, error_kind=None)
    return resolve_persisted_plan_load_status()


def queue_context(
    state: StateModel,
    *,
    config: dict | None = None,
    plan: PlanOption = _PLAN_AUTO_LOAD,
    target_strict: float | None = None,
) -> QueueContext:
    """Build a :class:`QueueContext` with all parameters resolved.

    Resolution order:

    1. **plan** — explicit value wins; sentinel ``_PLAN_AUTO_LOAD`` triggers
       ``load_plan()`` (guarded by ``PLAN_LOAD_EXCEPTIONS``).
    2. **target_strict** — explicit float wins; ``None`` reads from *config*
       via ``target_strict_score_from_config``; final fallback is ``95.0``.
    3. **snapshot** — canonical queue phase and partitions derived from the
       resolved plan and target_strict.
    """
    # --- resolve plan ---
    plan_load_status = resolve_plan_load_status(plan=plan)
    resolved_plan = plan_load_status.plan

    # --- resolve target_strict ---
    if target_strict is not None:
        resolved_target = target_strict
    elif config is not None:
        resolved_target = target_strict_score_from_config(config)
    else:
        resolved_target = DEFAULT_TARGET_STRICT_SCORE

    snapshot = build_queue_snapshot(
        state,
        plan=resolved_plan,
        target_strict=resolved_target,
    )

    return QueueContext(
        plan=resolved_plan,
        target_strict=resolved_target,
        plan_load_status=plan_load_status,
        snapshot=snapshot,
    )


__all__ = [
    "PlanLoadStatus",
    "QueueContext",
    "queue_context",
    "resolve_plan_load_status",
]
