"""Public work-queue API facade.

Work-queue internals live in ``desloppify.engine._work_queue``. This module
exposes a stable surface for app/intelligence callers.
"""

from __future__ import annotations

from desloppify.engine._work_queue.core import (
    QueueBuildOptions,
    WorkQueueResult,
    build_work_queue,
)
from desloppify.engine._work_queue.issues import list_open_review_issues
from desloppify.engine._work_queue.ranking import group_queue_items
from desloppify.engine._work_queue.synthetic_workflow import (
    build_deferred_disposition_item,
)

__all__ = [
    "QueueBuildOptions",
    "WorkQueueResult",
    "build_deferred_disposition_item",
    "build_work_queue",
    "group_queue_items",
    "list_open_review_issues",
]
