"""State suppression accounting helpers.

Scoring recomputation lives in :mod:`desloppify.engine._scoring.state_integration`.
"""

from __future__ import annotations

__all__ = [
    "suppression_metrics",
]

from desloppify.engine._state.schema import StateModel

_SUPPRESSION_FIELDS = frozenset({"ignored", "raw_issues", "suppressed_pct", "ignore_patterns"})


def _has_suppression_fields(finding: dict) -> bool:
    """Check if a scan-history entry has any suppression-related fields."""
    return isinstance(finding, dict) and bool(_SUPPRESSION_FIELDS & finding.keys())


def _clamped_pct(value: float) -> float:
    """Clamp a percentage to [0, 100] and round to one decimal."""
    return round(max(0.0, min(100.0, value)), 1)


def _last_suppressed_pct(finding: dict) -> float:
    """Extract the last suppressed percentage from a scan-history entry."""
    if "suppressed_pct" in finding:
        return _clamped_pct(float(finding.get("suppressed_pct") or 0.0))
    ignored = int(finding.get("ignored", 0) or 0)
    raw = int(finding.get("raw_issues", 0) or 0)
    return _clamped_pct(ignored / raw * 100) if raw else 0.0


def _empty_suppression_metrics() -> dict[str, int | float]:
    return {
        "last_ignored": 0,
        "last_raw_issues": 0,
        "last_suppressed_pct": 0.0,
        "last_ignore_patterns": 0,
        "recent_scans": 0,
        "recent_ignored": 0,
        "recent_raw_issues": 0,
        "recent_suppressed_pct": 0.0,
    }


def suppression_metrics(state: StateModel, *, window: int = 5) -> dict[str, int | float]:
    """Summarize ignore suppression from recent scan history."""
    history = state.get("scan_history", [])
    if not history:
        return _empty_suppression_metrics()

    scans_with_suppression = [
        entry for entry in history if _has_suppression_fields(entry)
    ]
    if not scans_with_suppression:
        return _empty_suppression_metrics()

    recent = scans_with_suppression[-max(1, window) :]
    last = recent[-1]

    recent_ignored = sum(int(entry.get("ignored", 0) or 0) for entry in recent)
    recent_raw = sum(int(entry.get("raw_issues", 0) or 0) for entry in recent)
    recent_pct = _clamped_pct(recent_ignored / recent_raw * 100) if recent_raw else 0.0

    last_ignored = int(last.get("ignored", 0) or 0)
    last_raw = int(last.get("raw_issues", 0) or 0)

    return {
        "last_ignored": last_ignored,
        "last_raw_issues": last_raw,
        "last_suppressed_pct": _last_suppressed_pct(last),
        "last_ignore_patterns": int(last.get("ignore_patterns", 0) or 0),
        "recent_scans": len(recent),
        "recent_ignored": recent_ignored,
        "recent_raw_issues": recent_raw,
        "recent_suppressed_pct": recent_pct,
    }
