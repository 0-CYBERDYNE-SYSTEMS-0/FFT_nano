"""Cluster reorder handlers."""

from __future__ import annotations

import argparse

from desloppify.app.commands.helpers.command_runtime import command_runtime
from desloppify.app.commands.plan.shared.cluster_membership import cluster_issue_ids
from desloppify.app.commands.plan.shared.patterns import resolve_ids_from_patterns
from desloppify.app.commands.plan.reorder_handlers import resolve_target
from desloppify.base.output.terminal import colorize
from desloppify.engine.plan_state import (
    load_plan,
    save_plan,
)
from desloppify.engine.plan_ops import (
    append_log_entry,
    move_items,
)


def _resolve_item_position(
    position: str,
    target: str | None,
    item_ids: list[str],
    ordered_slice: list[str],
    cluster_member_set: set[str],
    cluster_name: str,
    state: dict,
    plan: dict,
) -> tuple[str, str | None, int | None] | None:
    """Resolve where items should be positioned within a cluster."""
    item_set = set(item_ids)

    if position in ("top", "bottom"):
        return _resolve_edge_position(position, item_ids, ordered_slice, item_set)

    if position in ("before", "after"):
        return _resolve_relative_position(
            position,
            target,
            cluster_member_set,
            cluster_name,
            state,
            plan,
        )

    if position in ("up", "down"):
        return _resolve_offset_position(position, target)

    return (position, None, None)


def _resolve_edge_position(
    position: str,
    item_ids: list[str],
    ordered_slice: list[str],
    item_set: set[str],
) -> tuple[str, str | None, int | None] | None:
    if position == "top":
        first_non_item = next((fid for fid in ordered_slice if fid not in item_set), None)
        if first_non_item is None or set(ordered_slice[: len(item_ids)]) == item_set:
            print(colorize("  Already at the top of the cluster.", "yellow"))
            return None
        return ("before", first_non_item, None)

    last_non_item = next((fid for fid in reversed(ordered_slice) if fid not in item_set), None)
    if last_non_item is None or set(ordered_slice[-len(item_ids) :]) == item_set:
        print(colorize("  Already at the bottom of the cluster.", "yellow"))
        return None
    return ("after", last_non_item, None)


def _resolve_relative_position(
    position: str,
    target: str | None,
    cluster_member_set: set[str],
    cluster_name: str,
    state: dict,
    plan: dict,
) -> tuple[str, str | None, int | None] | None:
    if target is None:
        print(colorize(f"  '{position}' requires a target. Example: --item PAT {position} TARGET", "red"))
        return None
    target_ids = resolve_ids_from_patterns(state, [target], plan=plan)
    if not target_ids:
        print(colorize(f"  No match for target {target!r}.", "yellow"))
        return None
    resolved_target = target_ids[0]
    if resolved_target not in cluster_member_set:
        print(colorize(f"  Target {resolved_target!r} is not in cluster {cluster_name!r}.", "red"))
        return None
    return (position, resolved_target, None)


def _resolve_offset_position(
    position: str,
    target: str | None,
) -> tuple[str, str | None, int | None] | None:
    if target is None:
        print(colorize(f"  '{position}' requires an offset. Example: --item PAT {position} 3", "red"))
        return None
    try:
        offset = int(target)
    except (ValueError, TypeError):
        print(colorize(f"  Invalid offset: {target}", "red"))
        return None
    return (position, None, offset)


def _validate_cluster_members(
    cluster_names: list[str],
    clusters: dict,
) -> str | None:
    for name in cluster_names:
        if name not in clusters:
            print(colorize(f"  Cluster {name!r} does not exist.", "red"))
            return None
    return ", ".join(cluster_names)


def _resolve_item_reorder_context(
    args: argparse.Namespace,
    *,
    plan: dict,
    clusters: dict,
    cluster_name: str,
    item_pattern: str,
) -> tuple[dict, set[str], list[str], list[str]] | None:
    cluster_member_set = set(cluster_issue_ids(clusters[cluster_name]))
    state = command_runtime(args).state
    item_ids = resolve_ids_from_patterns(state, [item_pattern], plan=plan)
    if not item_ids:
        print(colorize("  No matching issues found for --item pattern.", "yellow"))
        return None
    for fid in item_ids:
        if fid not in cluster_member_set:
            print(colorize(f"  {fid!r} is not a member of cluster {cluster_name!r}.", "red"))
            return None
    queue_order: list[str] = plan.get("queue_order", [])
    ordered_slice = [fid for fid in queue_order if fid in cluster_member_set]
    return state, cluster_member_set, item_ids, ordered_slice


def _resolve_reorder_offset(position: str, target: str | None) -> tuple[str | None, int | None]:
    if position not in ("up", "down") or target is None:
        return target, None
    try:
        return None, int(target)
    except (ValueError, TypeError):
        print(colorize(f"  Invalid offset: {target}", "red"))
        return None, None


def _reorder_within_cluster(
    args: argparse.Namespace,
    plan: dict,
    clusters: dict,
    cluster_names: list[str],
    position: str,
    target: str | None,
    item_pattern: str,
) -> None:
    """Reorder items within a single cluster."""
    if len(cluster_names) != 1:
        print(colorize("  --item requires exactly one cluster name.", "red"))
        return
    cluster_name = cluster_names[0]
    context = _resolve_item_reorder_context(
        args,
        plan=plan,
        clusters=clusters,
        cluster_name=cluster_name,
        item_pattern=item_pattern,
    )
    if context is None:
        return
    state, cluster_member_set, item_ids, ordered_slice = context

    result = _resolve_item_position(
        position,
        target,
        item_ids,
        ordered_slice,
        cluster_member_set,
        cluster_name,
        state,
        plan,
    )
    if result is None:
        return
    resolved_position, resolved_target, offset = result

    count = move_items(plan, item_ids, resolved_position, target=resolved_target, offset=offset)
    append_log_entry(
        plan,
        "cluster_reorder",
        cluster_name=cluster_name,
        actor="user",
        detail={"position": resolved_position, "count": count, "item": item_pattern},
    )
    save_plan(plan)
    print(colorize(f"  Moved {count} item(s) to {resolved_position} within cluster {cluster_name}.", "green"))


def _reorder_whole_clusters(
    plan: dict,
    clusters: dict,
    cluster_names: list[str],
    position: str,
    target: str | None,
) -> None:
    """Reorder entire clusters as blocks relative to each other."""
    target = resolve_target(plan, target, position)

    target, offset = _resolve_reorder_offset(position, target)
    if position in ("up", "down") and offset is None and target is None:
        return

    seen: set[str] = set()
    all_member_ids: list[str] = []
    for name in cluster_names:
        for fid in cluster_issue_ids(clusters[name]):
            if fid not in seen:
                seen.add(fid)
                all_member_ids.append(fid)

    if not all_member_ids:
        print(colorize("  No members in the specified cluster(s).", "yellow"))
        return

    count = move_items(plan, all_member_ids, position, target=target, offset=offset)
    append_log_entry(
        plan,
        "cluster_reorder",
        cluster_name=",".join(cluster_names),
        actor="user",
        detail={"position": position, "count": count},
    )
    save_plan(plan)
    label = ", ".join(cluster_names)
    print(colorize(f"  Moved cluster(s) {label} ({count} items) to {position}.", "green"))


def _cmd_cluster_reorder(args: argparse.Namespace) -> None:
    raw_names: str = getattr(args, "cluster_names", "") or getattr(args, "cluster_name", "")
    cluster_names: list[str] = [n.strip() for n in raw_names.split(",") if n.strip()]
    position: str = getattr(args, "position", "top")
    target: str | None = getattr(args, "target", None)
    item_pattern: str | None = getattr(args, "item_pattern", None)

    plan = load_plan()
    clusters = plan.get("clusters", {})

    if _validate_cluster_members(cluster_names, clusters) is None:
        return

    if item_pattern is not None:
        _reorder_within_cluster(args, plan, clusters, cluster_names, position, target, item_pattern)
    else:
        _reorder_whole_clusters(plan, clusters, cluster_names, position, target)


__all__ = ["_cmd_cluster_reorder"]
