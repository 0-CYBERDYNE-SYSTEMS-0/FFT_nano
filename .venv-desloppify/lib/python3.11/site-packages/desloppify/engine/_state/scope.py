"""Scan-scope helpers shared by state filtering and scoring integration."""

from __future__ import annotations

from desloppify.engine._state.schema import Issue


def path_scoped_issues(
    issues: dict[str, Issue],
    scan_path: str | None,
) -> dict[str, Issue]:
    """Filter issues to those within the given scan path."""
    return {
        issue_id: issue
        for issue_id, issue in issues.items()
        if issue_in_scan_scope(str(issue.get("file", "")), scan_path)
    }


def issue_in_scan_scope(file_path: str, scan_path: str | None) -> bool:
    """Return True when a file path belongs to the active scan scope."""
    if not scan_path or scan_path == ".":
        return True
    prefix = scan_path.rstrip("/") + "/"
    return (
        file_path.startswith(prefix)
        or file_path == scan_path
        or file_path == "."
    )


def open_scope_breakdown(
    issues: dict[str, Issue],
    scan_path: str | None,
    *,
    detector: str | None = None,
) -> dict[str, int]:
    """Return open-issue counts split by in-scope vs out-of-scope carryover."""
    in_scope = 0
    out_of_scope = 0

    for issue in issues.values():
        if issue.get("suppressed"):
            continue
        if issue.get("status") != "open":
            continue
        if detector is not None and issue.get("detector") != detector:
            continue
        file_path = str(issue.get("file", ""))
        if issue_in_scan_scope(file_path, scan_path):
            in_scope += 1
        else:
            out_of_scope += 1

    return {
        "in_scope": in_scope,
        "out_of_scope": out_of_scope,
        "global": in_scope + out_of_scope,
    }


__all__ = [
    "issue_in_scan_scope",
    "open_scope_breakdown",
    "path_scoped_issues",
]
