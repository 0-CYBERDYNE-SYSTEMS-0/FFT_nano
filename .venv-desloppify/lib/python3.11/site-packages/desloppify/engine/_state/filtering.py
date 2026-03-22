"""State filtering, ignore rules, and issue pattern matching."""

from __future__ import annotations

import fnmatch
import re

__all__ = [
    "issue_in_scan_scope",
    "open_scope_breakdown",
    "path_scoped_issues",
    "is_ignored",
    "matched_ignore_pattern",
    "remove_ignored_issues",
    "add_ignore",
    "make_issue",
]

from desloppify.base.discovery.file_paths import rel
from desloppify.engine._state.issue_semantics import ensure_work_item_semantics
from desloppify.engine._state.schema import (
    Issue,
    StateModel,
    ensure_state_defaults,
    utc_now,
    validate_state_invariants,
)
from desloppify.engine._state.scope import (
    issue_in_scan_scope as _issue_in_scan_scope,
)
from desloppify.engine._state.scope import (
    open_scope_breakdown as _open_scope_breakdown,
)
from desloppify.engine._state.scope import (
    path_scoped_issues as _path_scoped_issues,
)


def _preserve_integrity_target(state: StateModel) -> float | None:
    """Extract the current subjective integrity target so recompute doesn't erase it."""
    integrity = state.get("subjective_integrity")
    if not isinstance(integrity, dict):
        return None
    raw = integrity.get("target_score")
    if raw is None:
        return None
    try:
        return max(0.0, min(100.0, float(raw)))
    except (TypeError, ValueError):
        return None


def path_scoped_issues(
    issues: dict[str, Issue],
    scan_path: str | None,
) -> dict[str, Issue]:
    """Filter issues to those within the given scan path."""
    return _path_scoped_issues(issues, scan_path)


def issue_in_scan_scope(file_path: str, scan_path: str | None) -> bool:
    """Return True when a file path belongs to the active scan scope."""
    return _issue_in_scan_scope(file_path, scan_path)


def open_scope_breakdown(
    issues: dict[str, Issue],
    scan_path: str | None,
    *,
    detector: str | None = None,
) -> dict[str, int]:
    """Return open-issue counts split by in-scope vs out-of-scope carryover."""
    return _open_scope_breakdown(
        issues,
        scan_path,
        detector=detector,
    )


def is_ignored(issue_id: str, file: str, ignore_patterns: list[str]) -> bool:
    """Check if a issue matches any ignore pattern (glob, ID prefix, or file path)."""
    return matched_ignore_pattern(issue_id, file, ignore_patterns) is not None


def matched_ignore_pattern(
    issue_id: str, file: str, ignore_patterns: list[str]
) -> str | None:
    """Return the ignore pattern that matched, if any."""
    for pattern in ignore_patterns:
        if "*" in pattern:
            target = issue_id if "::" in pattern else file
            if fnmatch.fnmatch(target, pattern):
                return pattern
            continue

        if "::" in pattern:
            if issue_id.startswith(pattern):
                return pattern
            continue

        raw_base = pattern.rstrip("/")
        rel_base = rel(pattern).rstrip("/")
        for base in (raw_base, rel_base):
            if not base:
                continue
            if file == base or file.startswith(base + "/"):
                return pattern

    return None


def remove_ignored_issues(state: StateModel, pattern: str) -> int:
    """Suppress issues matching an ignore pattern. Returns count affected."""
    ensure_state_defaults(state)
    matched_ids = [
        issue_id
        for issue_id, issue in state["work_items"].items()
        if is_ignored(issue_id, issue["file"], [pattern])
    ]
    now = utc_now()
    for issue_id in matched_ids:
        issue = state["work_items"][issue_id]
        issue["suppressed"] = True
        issue["suppressed_at"] = now
        issue["suppression_pattern"] = pattern
    from desloppify.engine._scoring.state_integration import (
        recompute_stats as _recompute_stats,
    )

    _recompute_stats(
        state,
        scan_path=state.get("scan_path"),
        subjective_integrity_target=_preserve_integrity_target(state),
    )
    validate_state_invariants(state)
    return len(matched_ids)


def add_ignore(state: StateModel, pattern: str) -> int:
    """Add an ignore pattern and remove existing matching issues."""
    ensure_state_defaults(state)
    config = state.setdefault("config", {})
    ignores = config.setdefault("ignore", [])
    if pattern not in ignores:
        ignores.append(pattern)
    return remove_ignored_issues(state, pattern)


def make_issue(
    detector: str,
    file: str,
    name: str,
    *,
    tier: int,
    confidence: str,
    summary: str,
    detail: dict | None = None,
) -> Issue:
    """Create a normalized issue dict with a stable ID."""
    rfile = rel(file)
    issue_id = f"{detector}::{rfile}::{name}" if name else f"{detector}::{rfile}"
    now = utc_now()
    issue: Issue = {
        "id": issue_id,
        "detector": detector,
        "file": rfile,
        "tier": tier,
        "confidence": confidence,
        "summary": summary,
        "detail": detail or {},
        "status": "open",
        "note": None,
        "first_seen": now,
        "last_seen": now,
        "resolved_at": None,
        "reopen_count": 0,
    }
    ensure_work_item_semantics(issue)
    return issue


_HEX8_RE = re.compile(r'^[0-9a-f]{8}$')


def _matches_issue_path(issue: dict[str, str], pattern: str) -> bool:
    """Match against the issue's detector name or file path."""
    return (
        issue.get("detector") == pattern
        or issue["file"] == pattern
        or issue["file"].startswith(pattern.rstrip("/") + "/")
    )


def _matches_issue_name_segment(issue_id: str, pattern: str) -> bool:
    """Match against the name segment of the issue ID.

    For hashed IDs (detector::path::name::hex8), also match the descriptive
    name (second-to-last segment).  Returns False for IDs without :: or
    patterns containing ::.
    """
    if "::" in pattern or "::" not in issue_id:
        return False
    segments = issue_id.split("::")
    name_segment = segments[-1]
    if name_segment == pattern:
        return True
    return (
        len(segments) >= 3
        and bool(_HEX8_RE.match(name_segment))
        and segments[-2] == pattern
    )


def _matches_pattern(issue_id: str, issue: dict[str, str], pattern: str) -> bool:
    """Check if a issue matches by ID, glob, prefix, detector, suffix, or path."""
    return (
        issue_id == pattern
        or ("*" in pattern and fnmatch.fnmatch(issue_id, pattern))
        or ("::" in pattern and issue_id.startswith(pattern))
        or (bool(_HEX8_RE.match(pattern)) and issue_id.endswith("::" + pattern))
        or _matches_issue_path(issue, pattern)
        or _matches_issue_name_segment(issue_id, pattern)
    )
