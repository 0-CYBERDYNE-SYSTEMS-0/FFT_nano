"""State reconstruction helpers for missing scan state with a surviving plan."""

from __future__ import annotations

from desloppify.engine._state.issue_semantics import ensure_work_item_semantics
from desloppify.engine._state.schema import ensure_state_defaults, scan_source


def _append_review_id(
    ordered: list[str],
    seen: set[str],
    issue_id: object,
) -> None:
    if not isinstance(issue_id, str):
        return
    normalized = issue_id.strip()
    if not normalized:
        return
    if not (
        normalized.startswith("review::")
        or normalized.startswith("concerns::")
    ):
        return
    if normalized in seen:
        return
    seen.add(normalized)
    ordered.append(normalized)


def saved_plan_review_ids(
    plan: dict | None,
    *,
    include_clusters: bool = True,
) -> list[str]:
    """Return review IDs recoverable from a saved plan.

    When ``include_clusters`` is true, include IDs retained only in cluster
    membership or ``action_steps[*].issue_refs``. This preserves the broader
    compatibility contract used by manual recovery helpers.
    """
    if not isinstance(plan, dict):
        return []

    ordered: list[str] = []
    seen: set[str] = set()

    for issue_id in plan.get("queue_order", []):
        _append_review_id(ordered, seen, issue_id)

    if not include_clusters:
        return ordered

    clusters = plan.get("clusters", {})
    if not isinstance(clusters, dict):
        return ordered

    for cluster in clusters.values():
        if not isinstance(cluster, dict):
            continue
        for issue_id in cluster.get("issue_ids", []):
            _append_review_id(ordered, seen, issue_id)
        for step in cluster.get("action_steps", []):
            if not isinstance(step, dict):
                continue
            for issue_id in step.get("issue_refs", []):
                _append_review_id(ordered, seen, issue_id)

    return ordered


def saved_plan_open_review_ids(plan: dict | None) -> list[str]:
    """Return review IDs still represented in the current queue."""
    return saved_plan_review_ids(plan, include_clusters=False)


def has_saved_plan_without_scan(state: dict, plan: dict | None) -> bool:
    """Whether a saved plan can be resumed without a current scan state."""
    if scan_source(state) == "scan":
        return False
    if not isinstance(plan, dict):
        return False
    meta = plan.get("epic_triage_meta")
    triage_meta = meta if isinstance(meta, dict) else {}
    return bool(
        plan.get("queue_order")
        or plan.get("clusters")
        or triage_meta.get("triage_stages")
        or triage_meta.get("strategy_summary")
    )


def _hydrate_saved_issue_ids(
    state: dict,
    issue_ids: list[str],
) -> dict:
    recovered = dict(state)
    issues = (state.get("work_items") or state.get("issues", {}))
    recovered_issues = dict(issues) if isinstance(issues, dict) else {}

    for issue_id in issue_ids:
        if issue_id in recovered_issues:
            continue
        parts = issue_id.split("::")
        detector = "concerns" if issue_id.startswith("concerns::") else "review"
        recovered_issues[issue_id] = {
            "id": issue_id,
            "status": "open",
            "detector": detector,
            "file": parts[1] if len(parts) > 1 else "",
            "summary": issue_id,
            "confidence": "medium",
            "tier": 2,
            "detail": {
                "dimension": "unknown",
                "recovered_from_plan": True,
            },
        }
        ensure_work_item_semantics(recovered_issues[issue_id])

    recovered["work_items"] = recovered_issues
    recovered["issues"] = recovered_issues
    recovered["scan_metadata"] = {
        "source": "plan_reconstruction",
        "plan_queue_available": bool(issue_ids),
        "reconstructed_issue_count": len(issue_ids),
    }
    ensure_state_defaults(recovered)
    return recovered


def recover_state_from_saved_plan(state: dict, plan: dict | None) -> dict:
    """Hydrate all review IDs recoverable from a saved plan."""
    if not has_saved_plan_without_scan(state, plan):
        return state
    return _hydrate_saved_issue_ids(state, saved_plan_review_ids(plan))


def reconstruct_state_from_saved_plan(state: dict, plan: dict | None) -> dict:
    """Hydrate only the review IDs still present in the live queue."""
    if not has_saved_plan_without_scan(state, plan):
        return state
    return _hydrate_saved_issue_ids(state, saved_plan_open_review_ids(plan))


__all__ = [
    "has_saved_plan_without_scan",
    "reconstruct_state_from_saved_plan",
    "recover_state_from_saved_plan",
    "saved_plan_open_review_ids",
    "saved_plan_review_ids",
]
