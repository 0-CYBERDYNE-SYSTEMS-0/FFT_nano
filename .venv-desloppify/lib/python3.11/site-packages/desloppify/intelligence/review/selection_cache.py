"""Cache and issue-summary helpers for review file selection."""

from __future__ import annotations

import logging
from datetime import UTC, datetime

from desloppify.base.discovery.file_paths import rel

logger = logging.getLogger(__name__)


def get_file_issues(state: dict, filepath: str) -> list[dict]:
    """Get existing open issues for a file (summaries for context)."""
    rpath = rel(filepath)
    issues = (state.get("work_items") or state.get("issues", {}))
    return [
        {"detector": issue["detector"], "summary": issue["summary"], "id": issue["id"]}
        for issue in issues.values()
        if issue.get("file") == rpath and issue["status"] == "open"
    ]


def count_fresh(state: dict, max_age_days: int) -> int:
    """Count files in review cache that are still fresh."""
    cache = state.get("review_cache", {}).get("files", {})
    now = datetime.now(UTC)
    count = 0
    for entry in cache.values():
        reviewed_at = entry.get("reviewed_at", "")
        if reviewed_at:
            try:
                reviewed = datetime.fromisoformat(reviewed_at)
                if (now - reviewed).days <= max_age_days:
                    count += 1
            except (ValueError, TypeError) as exc:
                logger.debug(
                    "Invalid review cache date %r while counting fresh files: %s",
                    reviewed_at,
                    exc,
                )
    return count


def count_stale(state: dict, max_age_days: int) -> int:
    """Count files in review cache that are stale."""
    cache = state.get("review_cache", {}).get("files", {})
    total = len(cache)
    return total - count_fresh(state, max_age_days)


__all__ = ["count_fresh", "count_stale", "get_file_issues"]

