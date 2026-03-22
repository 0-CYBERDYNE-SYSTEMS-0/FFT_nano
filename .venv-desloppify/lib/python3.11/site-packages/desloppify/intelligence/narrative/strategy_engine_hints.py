"""Leverage and strategy hint helpers for narrative strategy engine."""

from __future__ import annotations

from typing import Any


def compute_fixer_leverage(
    by_detector: dict[str, int],
    actions: list[dict[str, Any]],
    phase: str,
    _lang: str | None,
) -> dict[str, float | int | str]:
    """Estimate how much value automated fixers would deliver."""
    auto_fixable = sum(
        action.get("count", 0) for action in actions if action.get("type") == "auto_fix"
    )
    total = sum(by_detector.values())
    coverage = auto_fixable / total if total > 0 else 0.0
    total_impact = sum(action.get("impact", 0) for action in actions)
    auto_impact = sum(
        action.get("impact", 0)
        for action in actions
        if action.get("type") == "auto_fix"
    )
    impact_ratio = auto_impact / total_impact if total_impact > 0 else 0.0

    if coverage == 0:
        recommendation = "none"
    elif coverage > 0.4 or impact_ratio > 0.3:
        recommendation = "strong"
    elif phase in ("first_scan", "stagnation", "regression") and coverage > 0.15:
        recommendation = "strong"
    elif coverage > 0.1:
        recommendation = "moderate"
    else:
        recommendation = "none"

    return {
        "auto_fixable_count": auto_fixable,
        "total_count": total,
        "coverage": round(coverage, 3),
        "impact_ratio": round(impact_ratio, 3),
        "recommendation": recommendation,
    }


def compute_strategy_hint(
    fixer_leverage: dict[str, Any],
    lanes: dict[str, dict[str, Any]],
    can_parallelize: bool,
    phase: str,
) -> str:
    """Generate one- or two-sentence execution strategy guidance."""
    recommendation = fixer_leverage.get("recommendation", "none")
    coverage_pct = round(fixer_leverage.get("coverage", 0) * 100)
    lane_count = sum(
        1
        for lane_name, lane in lanes.items()
        if lane_name != "debt_review" and not lane.get("run_first")
    )

    if recommendation == "strong" and can_parallelize:
        return (
            f"Run fixers first — they cover {coverage_pct}% of issues. "
            f"Then {lane_count} independent workstreams, safe to parallelize. "
            "Rescan after each phase to verify."
        )
    if recommendation == "strong":
        return (
            f"Run fixers first — they cover {coverage_pct}% of issues. "
            "Then rescan to verify."
        )
    if can_parallelize:
        return (
            f"{lane_count} independent workstreams, safe to parallelize. "
            "Rescan after each phase to verify."
        )
    if phase == "maintenance":
        return "Maintenance mode — address new issues as they appear."
    if phase == "stagnation":
        return "Try a different dimension to break the plateau."
    return "Work through actions in priority order. Rescan after each fix to track progress."


__all__ = [
    "compute_fixer_leverage",
    "compute_strategy_hint",
]
