"""Issue prioritization/selection helpers for next items."""

from __future__ import annotations

from desloppify.engine._work_queue.core import QueueBuildOptions
from desloppify.engine.planning.queue_policy import build_execution_queue
from desloppify.engine.planning.types import PlanItem, PlanState


def get_next_items(
    state: PlanState,
    count: int = 1,
    scan_path: str | None = None,
) -> list[PlanItem]:
    """Get the N highest-priority open issues.

    This helper follows execution-queue semantics so it stays aligned with the
    living plan while preserving the legacy issue-only return contract.
    """
    result = build_execution_queue(
        state,
        options=QueueBuildOptions(
            count=count,
            scan_path=scan_path,
            status="open",
            include_subjective=False,
        ),
    )
    return [item for item in result["items"] if item.get("kind") == "issue"]


def get_next_item(
    state: PlanState,
    scan_path: str | None = None,
) -> PlanItem | None:
    """Get the highest-priority open issue."""
    items = get_next_items(state, count=1, scan_path=scan_path)
    return items[0] if items else None
