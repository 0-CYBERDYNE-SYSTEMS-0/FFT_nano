"""Issue-ID display helpers for command output."""

from __future__ import annotations


def short_issue_id(fid: str) -> str:
    """Extract a short suffix from an issue ID for compact display."""
    if "::" in fid:
        suffix = fid.rsplit("::", 1)[-1]
        if len(suffix) >= 8:
            return suffix[:8]
    return fid


__all__ = ["short_issue_id"]
