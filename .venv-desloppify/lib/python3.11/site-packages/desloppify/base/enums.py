"""Canonical enums for issue attributes.

StrEnum values compare equal to their string values (Confidence.HIGH == "high"),
so existing code using raw strings continues to work during gradual migration.
"""

from __future__ import annotations

import enum


class Confidence(enum.StrEnum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class Status(enum.StrEnum):
    OPEN = "open"
    FIXED = "fixed"
    WONTFIX = "wontfix"
    FALSE_POSITIVE = "false_positive"
    AUTO_RESOLVED = "auto_resolved"
    DEFERRED = "deferred"
    TRIAGED_OUT = "triaged_out"
    RESOLVED = "resolved"  # Legacy on-disk value; migrated to FIXED on load.


_CANONICAL_ISSUE_STATUSES = frozenset(
    {
        Status.OPEN.value,
        Status.FIXED.value,
        Status.WONTFIX.value,
        Status.FALSE_POSITIVE.value,
        Status.AUTO_RESOLVED.value,
        Status.DEFERRED.value,
        Status.TRIAGED_OUT.value,
    }
)
_RESOLVED_STATUSES = frozenset(
    {
        Status.FIXED.value,
        Status.WONTFIX.value,
        Status.FALSE_POSITIVE.value,
        Status.AUTO_RESOLVED.value,
    }
)
_LEGACY_STATUS_ALIASES = {
    Status.RESOLVED.value: Status.FIXED.value,
}


class Tier(enum.IntEnum):
    AUTO_FIX = 1
    QUICK_FIX = 2
    JUDGMENT = 3
    MAJOR_REFACTOR = 4


def canonical_issue_status(
    value: object, *, default: Status = Status.OPEN
) -> Status:
    """Normalize legacy/unknown issue status values to a canonical enum."""
    token = str(value).strip().lower()
    token = _LEGACY_STATUS_ALIASES.get(token, token)
    if token in _CANONICAL_ISSUE_STATUSES:
        return Status(token)
    return default


def issue_status_tokens(*, include_all: bool = False) -> frozenset[str]:
    """Return canonical issue-status tokens, optionally including `all`."""
    if include_all:
        return frozenset({*_CANONICAL_ISSUE_STATUSES, "all"})
    return _CANONICAL_ISSUE_STATUSES


def resolved_statuses() -> frozenset[str]:
    """Return the set of statuses that mean an issue is no longer open."""
    return _RESOLVED_STATUSES


__all__ = [
    "Confidence",
    "Status",
    "Tier",
    "canonical_issue_status",
    "issue_status_tokens",
    "resolved_statuses",
]
