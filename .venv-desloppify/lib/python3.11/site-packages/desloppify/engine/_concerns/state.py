"""State readers for concern generation."""

from __future__ import annotations

from collections import defaultdict
from typing import Any

from desloppify.engine._state.schema import StateModel


def _open_issues(state: StateModel) -> list[dict[str, Any]]:
    """Return all open issues from state."""
    issues = (state.get("work_items") or state.get("issues", {}))
    return [
        finding for finding in issues.values()
        if isinstance(finding, dict) and finding.get("status") == "open"
    ]


def _group_by_file(state: StateModel) -> dict[str, list[dict[str, Any]]]:
    """Group open issues by file, excluding holistic (file='.') issues."""
    by_file: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for finding in _open_issues(state):
        file = finding.get("file", "")
        if file and file != ".":
            by_file[file].append(finding)
    return dict(by_file)


__all__ = ["_group_by_file", "_open_issues"]
