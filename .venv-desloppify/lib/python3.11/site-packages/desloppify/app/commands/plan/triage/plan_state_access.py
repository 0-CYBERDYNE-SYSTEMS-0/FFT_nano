"""Plan-state accessors for triage workflow helpers."""

from __future__ import annotations

from typing import cast

from desloppify.engine.plan_state import (
    Cluster,
    EpicTriageMeta,
    ExecutionLogEntry,
    PlanModel,
    SkipEntry,
)


def ensure_queue_order(plan: PlanModel) -> list[str]:
    """Return queue order, creating the stored list when missing."""
    order = plan.get("queue_order")
    if isinstance(order, list):
        return order
    normalized: list[str] = []
    plan["queue_order"] = normalized
    return normalized


def ensure_skipped_map(plan: PlanModel) -> dict[str, SkipEntry]:
    """Return skipped metadata, creating the stored map when missing."""
    skipped = plan.get("skipped")
    if isinstance(skipped, dict):
        return cast(dict[str, SkipEntry], skipped)
    normalized: dict[str, SkipEntry] = {}
    plan["skipped"] = normalized
    return normalized


def ensure_cluster_map(plan: PlanModel) -> dict[str, Cluster]:
    """Return cluster map, creating the stored map when missing."""
    clusters = plan.get("clusters")
    if isinstance(clusters, dict):
        return cast(dict[str, Cluster], clusters)
    normalized: dict[str, Cluster] = {}
    plan["clusters"] = normalized
    return normalized


def ensure_triage_meta(plan: PlanModel) -> EpicTriageMeta:
    """Return triage metadata, creating the stored map when missing."""
    meta = plan.get("epic_triage_meta")
    if isinstance(meta, dict):
        return cast(EpicTriageMeta, meta)
    normalized: EpicTriageMeta = {}
    plan["epic_triage_meta"] = normalized
    return normalized


def ensure_execution_log(plan: PlanModel) -> list[ExecutionLogEntry]:
    """Return execution log, creating the stored list when missing."""
    log = plan.get("execution_log")
    if isinstance(log, list):
        normalized = [entry for entry in log if isinstance(entry, dict)]
        if normalized is not log:
            plan["execution_log"] = normalized
        return cast(list[ExecutionLogEntry], normalized)
    normalized: list[ExecutionLogEntry] = []
    plan["execution_log"] = normalized
    return normalized


def normalized_issue_id_list(raw_ids: object) -> list[str]:
    """Normalize a raw stored ID collection to strings only."""
    if not isinstance(raw_ids, list):
        return []
    return [issue_id for issue_id in raw_ids if isinstance(issue_id, str)]


__all__ = [
    "ensure_cluster_map",
    "ensure_execution_log",
    "ensure_queue_order",
    "ensure_skipped_map",
    "ensure_triage_meta",
    "normalized_issue_id_list",
]
