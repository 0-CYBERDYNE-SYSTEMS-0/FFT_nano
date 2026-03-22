"""Internal helper functions shared by plan schema migration routines."""

from __future__ import annotations

from typing import Any


def _has_synthesis_artifacts(
    *,
    queue_order: list[str],
    skipped: dict[str, Any],
    clusters: dict[str, Any],
    meta: object,
) -> bool:
    has_synthesis_ids = any(
        isinstance(item, str) and item.startswith("synthesis::")
        for item in queue_order
    )
    has_synthesis_skips = any(
        isinstance(item, str) and item.startswith("synthesis::")
        for item in skipped.keys()
    )
    has_cluster_synthesis_versions = any(
        isinstance(cluster, dict) and "synthesis_version" in cluster
        for cluster in clusters.values()
    )
    has_meta_synthesis_keys = isinstance(meta, dict) and (
        "synthesized_ids" in meta or "synthesis_stages" in meta
    )
    return (
        has_synthesis_ids
        or has_synthesis_skips
        or has_cluster_synthesis_versions
        or has_meta_synthesis_keys
    )


def _drop_legacy_plan_keys(plan: dict[str, Any], keys: tuple[str, ...]) -> bool:
    changed = False
    for legacy_key in keys:
        if legacy_key in plan:
            plan.pop(legacy_key, None)
            changed = True
    return changed


def _cleanup_synthesis_meta(meta: object) -> bool:
    if not isinstance(meta, dict):
        return False
    changed = False
    for key in ("synthesis_stages", "synthesized_ids"):
        if key in meta:
            meta.pop(key, None)
            changed = True
    return changed


def _migrate_action_steps_to_v8(cluster: dict[str, Any]) -> bool:
    """Convert flat string action_steps to ActionStep dicts."""
    steps = cluster.get("action_steps")
    if not isinstance(steps, list) or not steps:
        return False
    changed = False
    for i, step in enumerate(steps):
        if isinstance(step, str):
            # Heuristic: if <=120 chars, title only; if >120, first sentence = title, rest = detail
            if len(step) <= 120:
                steps[i] = {"title": step}
            else:
                # Split on first sentence boundary
                for sep in (". ", ".\n", ".\t"):
                    pos = step.find(sep)
                    if pos != -1:
                        title = step[: pos + 1].strip()
                        detail = step[pos + len(sep) :].strip()
                        steps[i] = {"title": title, "detail": detail} if detail else {"title": title}
                        break
                else:
                    steps[i] = {"title": step}
            changed = True
    return changed


__all__ = [
    "_cleanup_synthesis_meta",
    "_drop_legacy_plan_keys",
    "_has_synthesis_artifacts",
    "_migrate_action_steps_to_v8",
]
