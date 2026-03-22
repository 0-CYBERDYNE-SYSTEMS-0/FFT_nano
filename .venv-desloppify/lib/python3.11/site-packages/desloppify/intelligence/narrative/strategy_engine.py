"""Execution strategy engine for narrative lanes and parallelization hints."""

from __future__ import annotations

from typing import Any

from desloppify.intelligence.narrative._constants import STRUCTURAL_MERGE
from desloppify.intelligence.narrative.strategy_engine_hints import (
    compute_fixer_leverage,
    compute_strategy_hint,
)
from desloppify.intelligence.narrative.strategy_engine_lanes import (
    compute_lanes,
    significant_lane,
)


def open_files_by_detector(issues: dict[str, dict[str, Any]]) -> dict[str, set[str]]:
    """Collect file sets of open issues by detector."""
    by_detector: dict[str, set[str]] = {}
    for issue in issues.values():
        if issue["status"] != "open" or issue.get("suppressed"):
            continue
        detector = issue.get("detector", "unknown")
        if detector in STRUCTURAL_MERGE:
            detector = "structural"
        file_path = issue.get("file", "")
        if not file_path:
            by_detector.setdefault(detector, set())
            continue
        by_detector.setdefault(detector, set()).add(file_path)
    return by_detector


def compute_strategy(
    issues: dict[str, dict[str, Any]],
    by_detector: dict[str, int],
    actions: list[dict[str, Any]],
    phase: str,
    lang: str | None,
) -> dict[str, Any]:
    """Orchestrate strategy computation and annotate actions with lanes."""
    files_by_detector = open_files_by_detector(issues)
    fixer_leverage = compute_fixer_leverage(by_detector, actions, phase, lang)
    lanes = compute_lanes(actions, files_by_detector)

    action_lane: dict[int, str] = {}
    for lane_name, lane in lanes.items():
        for priority in lane["actions"]:
            action_lane[priority] = lane_name
    for action in actions:
        action["lane"] = action_lane.get(action["priority"])

    significant_non_blocked = [
        (lane_name, lane)
        for lane_name, lane in lanes.items()
        if significant_lane(lane_name, lane)
    ]
    can_parallelize = len(significant_non_blocked) >= 2

    hint = compute_strategy_hint(fixer_leverage, lanes, can_parallelize, phase)
    review_action = next(
        (action for action in actions if action.get("detector") == "review"), None
    )
    if review_action:
        hint += f" Review: {review_action['count']} issue(s) — `desloppify show review --status open`."

    return {
        "fixer_leverage": fixer_leverage,
        "lanes": {name: {**lane} for name, lane in lanes.items()},
        "can_parallelize": can_parallelize,
        "hint": hint,
    }


__all__ = [
    "compute_fixer_leverage",
    "compute_lanes",
    "compute_strategy",
    "compute_strategy_hint",
    "open_files_by_detector",
]
