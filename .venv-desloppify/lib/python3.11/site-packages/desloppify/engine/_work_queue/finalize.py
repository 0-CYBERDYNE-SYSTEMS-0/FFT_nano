"""Queue ranking and plan-aware finalization."""

from __future__ import annotations

from desloppify.engine._work_queue.models import QueueBuildOptions, WorkQueueResult
from desloppify.engine._work_queue.plan_order import (
    enrich_plan_metadata,
    separate_skipped,
    stamp_plan_sort_keys,
    stamp_positions,
)
from desloppify.engine._work_queue.plan_order import new_item_ids as _new_item_ids
from desloppify.engine._work_queue.ranking import (
    enrich_with_impact,
    group_queue_items,
    item_explain,
    item_sort_key,
)
from desloppify.engine._work_queue.types import WorkQueueItem
from desloppify.engine._state.schema import StateModel


def finalize_queue(
    items: list[WorkQueueItem],
    *,
    state: StateModel,
    plan: dict | None,
    opts: QueueBuildOptions,
) -> WorkQueueResult:
    """Apply ranking, plan ordering, limits, and explain metadata."""
    enrich_with_impact(items, state.get("dimension_scores", {}))

    new_ids, skipped = _plan_presort(items, state, plan)
    items.sort(key=item_sort_key)
    _plan_postsort(items, skipped, plan, opts)

    total = len(items)
    if opts.count is not None and opts.count > 0:
        items = items[:opts.count]
    if opts.explain:
        for item in items:
            item["explain"] = item_explain(item)

    return {
        "items": items,
        "total": total,
        "grouped": group_queue_items(items, "item"),
        "new_ids": new_ids,
    }


def _plan_presort(
    items: list[WorkQueueItem],
    state: StateModel,
    plan: dict | None,
) -> tuple[set[str], list[WorkQueueItem]]:
    """Enrich plan metadata and stamp sort keys before sorting."""
    if not plan:
        return set(), []

    new_ids = _new_item_ids(state)
    enrich_plan_metadata(items, plan)
    stamp_plan_sort_keys(items, plan, new_ids)
    remaining, skipped = separate_skipped(items, plan)
    items[:] = remaining
    return new_ids, skipped


def _plan_postsort(
    items: list[WorkQueueItem],
    skipped: list[WorkQueueItem],
    plan: dict | None,
    opts: QueueBuildOptions,
) -> None:
    """Re-append skipped items and stamp positions."""
    if not plan:
        return
    if opts.include_skipped:
        items.extend(skipped)
    stamp_positions(items, plan)


__all__ = ["finalize_queue"]
