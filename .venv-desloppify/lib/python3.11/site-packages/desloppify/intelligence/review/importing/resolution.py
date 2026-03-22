"""Resolution helpers for review re-import workflows."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from desloppify.engine._state.schema import Issue, StateModel, utc_now


def auto_resolve_review_issues(
    state: StateModel,
    *,
    new_ids: set[str],
    diff: dict[str, Any],
    note: str,
    should_resolve: Callable[[Issue], bool],
    utc_now_fn=utc_now,
) -> None:
    """Mark stale open review issues fixed when an explicit import supersedes them."""
    work_items = state.get("work_items") or state.get("issues", {})
    state["work_items"] = work_items
    state["issues"] = work_items
    diff.setdefault("auto_resolved", 0)
    for issue_id, issue in work_items.items():
        if issue_id in new_ids or issue.get("status") != "open":
            continue
        if not should_resolve(issue):
            continue
        now = utc_now_fn()
        issue["status"] = "fixed"
        issue["resolved_at"] = now
        issue["note"] = note
        issue["resolution_attestation"] = {
            "kind": "agent_import",
            "text": note,
            "attested_at": now,
            "scan_verified": False,
        }
        diff["auto_resolved"] += 1
