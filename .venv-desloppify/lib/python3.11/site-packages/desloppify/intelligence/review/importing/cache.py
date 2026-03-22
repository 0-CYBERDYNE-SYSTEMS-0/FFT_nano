"""Review import cache refresh helpers."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from desloppify.base.discovery.paths import get_project_root
from desloppify.engine._state.schema import StateModel, utc_now
from desloppify.intelligence.review.importing.state_helpers import ensure_review_file_cache


def resolve_import_project_root(project_root: Path | str | None) -> Path:
    """Resolve optional import project root to an absolute path."""
    if project_root is None:
        return get_project_root()
    return Path(project_root).resolve()


def upsert_review_cache_entry(
    file_cache: dict[str, Any],
    file_path: str,
    *,
    project_root: Path,
    hash_file_fn,
    utc_now_fn=utc_now,
    issue_count: int | None = None,
) -> None:
    """Write one normalized review-cache entry for a reviewed file."""
    absolute = project_root / file_path
    content_hash = hash_file_fn(str(absolute)) if absolute.exists() else ""
    if issue_count is None:
        previous = file_cache.get(file_path, {})
        count = previous.get("issue_count", 0) if isinstance(previous, dict) else 0
        issue_count = count if isinstance(count, int) else 0
    file_cache[file_path] = {
        "content_hash": content_hash,
        "reviewed_at": utc_now_fn(),
        "issue_count": max(0, int(issue_count)),
    }


def refresh_review_file_cache(
    state: StateModel,
    *,
    reviewed_files: list[str] | None,
    issues_by_file: dict[str, int | None] | None = None,
    project_root: Path | str | None = None,
    hash_file_fn,
    utc_now_fn=utc_now,
) -> None:
    """Refresh normalized review cache entries for all reviewed files."""
    file_cache = ensure_review_file_cache(state)
    resolved_project_root = resolve_import_project_root(project_root)
    counts = issues_by_file or {}

    reviewed_set = set(counts)
    if reviewed_files:
        reviewed_set.update(
            str(file_path).strip()
            for file_path in reviewed_files
            if isinstance(file_path, str) and str(file_path).strip()
        )

    for file_path in reviewed_set:
        upsert_review_cache_entry(
            file_cache,
            file_path,
            project_root=resolved_project_root,
            hash_file_fn=hash_file_fn,
            utc_now_fn=utc_now_fn,
            issue_count=counts.get(file_path),
        )
