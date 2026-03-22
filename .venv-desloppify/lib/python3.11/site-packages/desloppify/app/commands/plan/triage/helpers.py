"""Legacy compatibility shim for a small set of triage helper imports.

Active triage code imports the owning modules directly. Keep this surface only
for focused tests and any external callers that still import the older helper
module path.
"""

from __future__ import annotations

from .completion_flow import apply_completion, count_log_activity_since
from .observe_batches import (
    group_issues_into_observe_batches,
    observe_dimension_breakdown,
)
from .review_coverage import (
    cluster_issue_ids,
    manual_clusters_with_issues,
    open_review_ids_from_state,
    triage_coverage,
    undispositioned_triage_issue_ids,
)
from .stage_queue import (
    has_triage_in_queue,
    inject_triage_stages,
)

__all__ = [
    "apply_completion",
    "cluster_issue_ids",
    "count_log_activity_since",
    "group_issues_into_observe_batches",
    "has_triage_in_queue",
    "inject_triage_stages",
    "manual_clusters_with_issues",
    "observe_dimension_breakdown",
    "open_review_ids_from_state",
    "triage_coverage",
    "undispositioned_triage_issue_ids",
]
