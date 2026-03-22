"""Small shared helpers for triage stage command flows."""

from __future__ import annotations

from desloppify.base.output.terminal import colorize


def validate_stage_report_length(
    *,
    report: str,
    issue_count: int,
    guidance: str,
) -> bool:
    """Return whether a stage report is long enough for the issue volume."""
    min_chars = 50 if issue_count <= 3 else 100
    if len(report) >= min_chars:
        return True
    print(colorize(f"  Report too short: {len(report)} chars (minimum {min_chars}).", "red"))
    print(colorize(guidance, "dim"))
    return False


__all__ = ["validate_stage_report_length"]
