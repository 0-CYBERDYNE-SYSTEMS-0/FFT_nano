"""Explain/group helpers for ranked work-queue items."""

from __future__ import annotations

from typing import Any

from desloppify.engine._work_queue.helpers import detail_dict, workflow_stage_name
from desloppify.engine._work_queue.types import WorkQueueItem
from desloppify.engine.planning.helpers import CONFIDENCE_ORDER


def subjective_score_value(item: WorkQueueItem) -> float:
    raw_score: Any
    if item.get("kind") == "subjective_dimension":
        detail = detail_dict(item)
        raw_score = detail.get("strict_score", item.get("subjective_score", 100.0))
    else:
        raw_score = item.get("subjective_score", 100.0)
    if raw_score is None:
        return 100.0
    try:
        return float(raw_score)
    except (TypeError, ValueError):
        return 100.0


def item_explain(item: WorkQueueItem) -> dict[str, Any]:
    kind = item.get("kind", "issue")
    if kind == "workflow_stage":
        return {
            "kind": "workflow_stage",
            "stage": workflow_stage_name(item),
            "is_blocked": item.get("is_blocked", False),
            "blocked_by": item.get("blocked_by", []),
            "policy": "Triage stages sort by dependency order; blocked stages follow unblocked.",
            "ranking_factors": ["blocked_penalty asc", "stage_index asc"],
        }

    if kind == "workflow_action":
        return {
            "kind": "workflow_action",
            "policy": "Workflow items sort before triage stages, after initial reviews.",
            "ranking_factors": ["id asc"],
        }

    if kind == "cluster":
        return {
            "kind": "cluster",
            "estimated_impact": item.get("estimated_impact", 0.0),
            "action_type": item.get("action_type", "manual_fix"),
            "member_count": item.get("member_count", 0),
            "policy": "Clusters sort before individual issues, ordered by action type then size.",
            "ranking_factors": ["action_type asc", "member_count desc", "id asc"],
        }

    if kind == "subjective_dimension":
        initial = item.get("initial_review", False)
        return {
            "kind": "subjective_dimension",
            "estimated_impact": item.get("estimated_impact", 0.0),
            "subjective_score": subjective_score_value(item),
            "initial_review": initial,
            "policy": (
                "Initial review items sort first (onboarding priority)."
                if initial else
                "Sorted by dimension impact (score headroom × weight), then subjective score."
            ),
            "ranking_factors": ["estimated_impact desc", "subjective_score asc", "id asc"],
        }

    detail = detail_dict(item)
    confidence = item.get("confidence", "low")
    is_subjective = bool(item.get("is_subjective"))
    is_review = bool(item.get("is_review"))
    ranking_factors: list[str]
    if is_subjective:
        ranking_factors = ["estimated_impact desc", "subjective_score asc", "id asc"]
    elif is_review:
        ranking_factors = [
            "estimated_impact desc",
            "confidence asc",
            "review_weight desc",
            "count desc",
            "id asc",
        ]
    else:
        ranking_factors = ["estimated_impact desc", "confidence asc", "count desc", "id asc"]
    explain = {
        "kind": "issue",
        "estimated_impact": item.get("estimated_impact", 0.0),
        "confidence": confidence,
        "confidence_rank": CONFIDENCE_ORDER.get(confidence, 9),
        "count": int(detail.get("count", 0) or 0),
        "id": item.get("id", ""),
        "ranking_factors": ranking_factors,
    }
    if is_review:
        explain["review_weight"] = float(item.get("review_weight", 0.0) or 0.0)
    if is_subjective:
        explain["policy"] = (
            "Sorted by dimension impact (score headroom × weight), then subjective score."
        )
        explain["subjective_score"] = subjective_score_value(item)
    return explain


def group_queue_items(
    items: list[WorkQueueItem], group: str
) -> dict[str, list[WorkQueueItem]]:
    """Group queue items for alternate output modes."""
    grouped: dict[str, list[WorkQueueItem]] = {}
    for item in items:
        if group == "file":
            key = item.get("file", "")
        elif group == "detector":
            key = item.get("detector", "")
        elif group == "cluster":
            plan_cluster = item.get("plan_cluster")
            key = plan_cluster["name"] if isinstance(plan_cluster, dict) else "(unclustered)"
        else:
            key = "items"
        grouped.setdefault(key, []).append(item)
    return grouped


__all__ = ["group_queue_items", "item_explain", "subjective_score_value"]
