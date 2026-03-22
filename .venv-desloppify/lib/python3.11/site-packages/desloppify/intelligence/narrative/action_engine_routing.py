"""Action routing and prioritization helpers for narrative actions."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from desloppify.engine._scoring.results.core import get_dimension_for_detector
from desloppify.engine._state.issue_semantics import (
    ASSESSMENT_REQUEST,
    REVIEW_DEFECT,
    REVIEW_CONCERN,
    infer_work_item_kind,
)
from desloppify.intelligence.narrative._constants import DETECTOR_TOOLS
from desloppify.intelligence.narrative.action_models import ActionItem


def _dimension_name(detector: str) -> str:
    """Resolve user-facing dimension name for a detector."""
    dimension = get_dimension_for_detector(detector)
    return dimension.name if dimension else "Unknown"


def _append_reorganize_actions(
    actions: list[ActionItem],
    by_detector: dict[str, int],
    impact_for: Callable[[str, int], float],
) -> None:
    """Append structure/move oriented actions."""
    for detector, tool_info in DETECTOR_TOOLS.items():
        if tool_info["action_type"] != "reorganize":
            continue
        count = by_detector.get(detector, 0)
        if count == 0:
            continue

        guidance = tool_info.get("guidance", "restructure with move")
        actions.append(
            {
                "type": "reorganize",
                "detector": detector,
                "count": count,
                "description": f"{count} {detector} issues — {guidance}",
                "command": f"desloppify show {detector} --status open",
                "impact": round(impact_for(detector, count), 1),
                "dimension": _dimension_name(detector),
            }
        )


def _build_refactor_entry(
    detector: str,
    tool_info: dict[str, Any],
    count: int,
    impact_for: Callable[[str, int], float],
) -> ActionItem:
    """Build one refactor/manual action row."""
    guidance = tool_info.get("guidance", "manual fix")
    adjusted_info = {**tool_info, "guidance": guidance}

    work_item_kind = infer_work_item_kind(detector)
    if work_item_kind == ASSESSMENT_REQUEST:
        command = "desloppify review --prepare"
        suffix = "s" if count != 1 else ""
        description = (
            f"{count} assessment request{suffix} need review — run holistic "
            "review to refresh subjective scores"
        )
    elif work_item_kind in {REVIEW_DEFECT, REVIEW_CONCERN}:
        command = "desloppify show review --status open"
        suffix = "s" if count != 1 else ""
        description = (
            f"{count} review work item{suffix} need investigation — "
            "run `desloppify show review --status open` to see them"
        )
        adjusted_info = {**adjusted_info, "action_type": "refactor"}
    else:
        command = f"desloppify show {detector} --status open"
        description = f"{count} {detector} work items — {guidance}"

    return {
        "type": adjusted_info["action_type"],
        "detector": detector,
        "count": count,
        "description": description,
        "command": command,
        "impact": round(impact_for(detector, count), 1),
        "dimension": _dimension_name(detector),
    }


def _append_refactor_actions(
    actions: list[ActionItem],
    by_detector: dict[str, int],
    impact_for: Callable[[str, int], float],
) -> None:
    """Append refactor/manual actions after auto-fix/reorg buckets."""
    for detector, tool_info in DETECTOR_TOOLS.items():
        if tool_info["action_type"] not in {"refactor", "manual_fix"}:
            continue
        count = by_detector.get(detector, 0)
        if count == 0:
            continue
        actions.append(_build_refactor_entry(detector, tool_info, count, impact_for))


def _append_debt_action(actions: list[ActionItem], debt: dict[str, float]) -> None:
    """Append wontfix-debt callout when gap is material."""
    gap = float(debt.get("overall_gap", 0.0) or 0.0)
    if gap <= 2.0:
        return
    actions.append(
        {
            "type": "debt_review",
            "detector": None,
            "description": f"{gap} pts of wontfix debt — review stale decisions",
            "command": "desloppify show --status wontfix",
            "gap": gap,
        }
    )


def _assign_priorities(actions: list[ActionItem]) -> list[ActionItem]:
    """Sort and assign sequential priorities."""
    type_order = {
        "issue_queue": 0,
        "auto_fix": 1,
        "reorganize": 2,
        "refactor": 3,
        "manual_fix": 4,
        "debt_review": 5,
    }
    actions.sort(
        key=lambda action: (type_order.get(action["type"], 9), -action.get("impact", 0))
    )
    for index, action in enumerate(actions, start=1):
        action["priority"] = index
    return actions


def _cluster_detector(cluster: dict) -> str | None:
    """Extract the primary detector from a cluster."""
    key = cluster.get("cluster_key", "")
    if key:
        parts = key.split("::")
        if len(parts) >= 2:
            return parts[1]
    name = cluster.get("name", "")
    if name.startswith("auto/"):
        rest = name[5:]
        return rest.split("-", 1)[0] if "-" in rest else rest
    return None


def _annotate_with_clusters(actions: list[ActionItem], clusters: dict | None) -> None:
    """Annotate actions with matching cluster info when clusters exist."""
    if not clusters:
        return
    for action in actions:
        detector = action.get("detector")
        if not detector:
            continue
        matching = [
            name
            for name, cluster in clusters.items()
            if cluster.get("auto") and _cluster_detector(cluster) == detector
        ]
        if matching:
            action["clusters"] = matching
            action["cluster_count"] = len(matching)
            action["command"] = "desloppify next"
            count = action.get("count", 0)
            display = action.get("detector", "unknown")
            action["description"] = (
                f"{count} {display} issues in {len(matching)} cluster(s) — "
                "run `desloppify next`"
            )


__all__ = [
    "_annotate_with_clusters",
    "_append_debt_action",
    "_append_refactor_actions",
    "_append_reorganize_actions",
    "_assign_priorities",
    "_build_refactor_entry",
    "_cluster_detector",
    "_dimension_name",
]
