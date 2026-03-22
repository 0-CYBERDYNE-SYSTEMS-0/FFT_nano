"""Sync subdomain for plan queue reconciliation helpers.

This package groups sync concerns that were previously in the flat
``engine._plan`` namespace:
- ``context``: shared cycle/objective backlog predicates
- ``dimensions``: subjective dimension queue sync
- ``phase_cleanup``: prune stale synthetic IDs on phase transitions
- ``pipeline``: shared boundary-triggered reconcile pipeline
- ``review_import``: review-import-specific queue mutation before boundary sync
- ``triage``: triage-stage queue sync
- ``workflow``: workflow gate queue sync
- ``auto_prune``: auto-cluster stale pruning helper
"""

from __future__ import annotations

from typing import Any

__all__ = [
    "ReconcileResult",
    "auto_prune",
    "context",
    "dimensions",
    "live_planned_queue_empty",
    "pipeline",
    "reconcile_plan",
    "review_import",
    "triage",
    "workflow",
]


def __getattr__(name: str) -> Any:
    if name in {"ReconcileResult", "live_planned_queue_empty", "reconcile_plan"}:
        from .pipeline import ReconcileResult, live_planned_queue_empty, reconcile_plan

        return {
            "ReconcileResult": ReconcileResult,
            "live_planned_queue_empty": live_planned_queue_empty,
            "reconcile_plan": reconcile_plan,
        }[name]
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
