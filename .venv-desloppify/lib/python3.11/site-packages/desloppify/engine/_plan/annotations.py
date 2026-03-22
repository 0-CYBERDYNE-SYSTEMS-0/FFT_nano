"""Read helpers for per-issue plan override annotations."""

from __future__ import annotations

from typing import Any


def get_issue_override(plan: dict[str, Any], issue_id: str) -> dict[str, Any]:
    """Return override payload for an issue ID or an empty mapping."""
    overrides = plan.get("overrides", {})
    if not isinstance(overrides, dict):
        return {}
    payload = overrides.get(issue_id, {})
    if isinstance(payload, dict):
        return payload
    return {}


def get_issue_description(plan: dict[str, Any], issue_id: str) -> str | None:
    """Return per-issue plan description if one is set."""
    value = get_issue_override(plan, issue_id).get("description")
    return value if isinstance(value, str) else None


def get_issue_note(plan: dict[str, Any], issue_id: str) -> str | None:
    """Return per-issue plan note if one is set."""
    value = get_issue_override(plan, issue_id).get("note")
    return value if isinstance(value, str) else None


def annotation_counts(plan: dict[str, Any]) -> tuple[int, int]:
    """Return counts of non-empty descriptions and notes in overrides."""
    overrides = plan.get("overrides", {})
    if not isinstance(overrides, dict):
        return 0, 0
    described = 0
    noted = 0
    for payload in overrides.values():
        if not isinstance(payload, dict):
            continue
        if payload.get("description"):
            described += 1
        if payload.get("note"):
            noted += 1
    return described, noted


__all__ = [
    "annotation_counts",
    "get_issue_description",
    "get_issue_note",
    "get_issue_override",
]
