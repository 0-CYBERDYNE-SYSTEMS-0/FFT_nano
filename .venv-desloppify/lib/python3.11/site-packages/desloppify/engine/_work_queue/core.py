"""Unified work-queue entrypoints for next/show/plan views."""

from __future__ import annotations

from desloppify.engine._work_queue.context import QueueContext
from desloppify.engine._work_queue.finalize import finalize_queue
from desloppify.engine._work_queue.helpers import ATTEST_EXAMPLE
from desloppify.engine._work_queue.inputs import resolve_queue_inputs
from desloppify.engine._work_queue.models import (
    QueueBuildOptions,
    QueueVisibility,
    WorkQueueResult,
)
from desloppify.engine._work_queue.plan_order import collapse_clusters
from desloppify.engine._work_queue.ranking import group_queue_items
from desloppify.engine._work_queue.selection import select_queue_items
from desloppify.engine._state.schema import StateModel

def build_work_queue(
    state: StateModel,
    *,
    options: QueueBuildOptions | None = None,
) -> WorkQueueResult:
    """Build the active canonical work queue for the current invocation."""
    return _build_work_queue_with_visibility(
        state,
        options=options,
        visibility=QueueVisibility.ALL,
    )


def _build_work_queue_with_visibility(
    state: StateModel,
    *,
    options: QueueBuildOptions | None = None,
    visibility: str = QueueVisibility.ALL,
) -> WorkQueueResult:
    """Build a ranked work queue from canonical queue partitions.

    Open-status queue views are resolved from the canonical queue snapshot so
    lifecycle phase, execution visibility, and backlog visibility all come
    from one source of truth. Non-open status views remain issue-list queries.
    """
    opts = options or QueueBuildOptions()
    plan, scan_path, status, threshold = resolve_queue_inputs(opts, state)
    items = select_queue_items(
        state,
        opts=opts,
        plan=plan,
        scan_path=scan_path,
        status=status,
        threshold=threshold,
        visibility=visibility,
    )
    return finalize_queue(items, state=state, plan=plan, opts=opts)

__all__ = [
    "ATTEST_EXAMPLE",
    "QueueBuildOptions",
    "QueueContext",
    "QueueVisibility",
    "WorkQueueResult",
    "_build_work_queue_with_visibility",
    "build_work_queue",
    "collapse_clusters",
    "group_queue_items",
]
