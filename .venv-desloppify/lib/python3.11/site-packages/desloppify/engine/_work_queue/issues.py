"""State-backed work queue for review work items.

Review work items live in the in-memory ``state["work_items"]`` map and serialize
as ``work_items`` on disk. This module provides:
- Listing/sorting open review work items by impact
- Storing investigation notes on review work items
- Expiring stale holistic review work items during scan
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime

from desloppify.base.output.issues import issue_weight
from desloppify.engine._state.issue_semantics import is_review_finding
from desloppify.engine._work_queue.helpers import detail_dict

logger = logging.getLogger(__name__)

__all__ = [
    "impact_label",
    "list_open_review_issues",
    "update_investigation",
    "mark_stale_holistic",
]


def _state_work_items(state: dict) -> dict:
    work_items = state.get("work_items")
    if isinstance(work_items, dict):
        state["issues"] = work_items
        return work_items
    legacy_items = state.get("issues")
    if isinstance(legacy_items, dict):
        state["work_items"] = legacy_items
        return legacy_items
    empty: dict = {}
    state["work_items"] = empty
    state["issues"] = empty
    return empty


def impact_label(weight: float) -> str:
    """Convert weight to a human-readable impact label."""
    try:
        numeric = float(weight)
    except (TypeError, ValueError):
        return "+"
    if numeric >= 8:
        return "+++"
    if numeric >= 5:
        return "++"
    return "+"


def list_open_review_issues(state: dict) -> list[dict]:
    """Return open review work items sorted by impact (highest first)."""
    issues = _state_work_items(state)
    review = [
        issue
        for issue in issues.values()
        if issue.get("status") == "open" and is_review_finding(issue)
    ]

    def _sort_key(issue: dict) -> tuple[float, str]:
        weight, _impact, issue_id = issue_weight(issue)
        return (-weight, issue_id)

    review.sort(key=_sort_key)
    return review


def update_investigation(state: dict, issue_id: str, text: str) -> bool:
    """Store investigation text on a work item. Returns False if not found/not open."""
    issue = _state_work_items(state).get(issue_id)
    if not issue or issue.get("status") != "open":
        return False
    detail = detail_dict(issue)
    if not detail:
        detail = {}
        issue["detail"] = detail
    detail["investigation"] = text
    detail["investigated_at"] = datetime.now(UTC).isoformat()
    return True


def mark_stale_holistic(state: dict, max_age_days: int = 30) -> list[str]:
    """Annotate stale holistic review issues without auto-resolving them."""
    now = datetime.now(UTC)
    expired: list[str] = []

    for issue_id, issue in _state_work_items(state).items():
        if not is_review_finding(issue):
            continue
        if issue.get("status") != "open":
            continue
        if not detail_dict(issue).get("holistic"):
            continue

        last_seen = issue.get("last_seen")
        if not last_seen:
            continue

        try:
            seen_dt = datetime.fromisoformat(last_seen)
        except (ValueError, TypeError) as exc:
            logger.debug(
                "Skipping holistic issue %s with invalid last_seen %r: %s",
                issue_id,
                last_seen,
                exc,
            )
            continue

        age_days = (now - seen_dt).days
        if age_days > max_age_days:
            issue["note"] = "holistic review stale — re-run review to re-evaluate"
            expired.append(issue_id)

    return expired
