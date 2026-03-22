"""Plan reorder subcommand handlers."""

from __future__ import annotations

import argparse

from desloppify.app.commands.helpers.command_runtime import command_runtime
from desloppify.app.commands.helpers.state import require_issue_inventory
from desloppify.app.commands.plan.shared.cluster_membership import cluster_issue_ids
from desloppify.app.commands.plan.shared.patterns import resolve_ids_from_patterns
from desloppify.base.output.terminal import colorize
from desloppify.engine.plan_state import (
    load_plan,
    save_plan,
)
from desloppify.engine.plan_ops import (
    append_log_entry,
    move_items,
)
from desloppify.engine._plan.promoted_ids import add_promoted_ids


def resolve_target(plan: dict, target: str | None, position: str) -> str | None:
    """Resolve a cluster name used as a before/after target to a member ID."""
    if target is None:
        return None
    clusters = plan.get("clusters", {})
    if target not in clusters:
        return target
    member_ids = cluster_issue_ids(clusters[target])
    if not member_ids:
        return target
    order = plan.get("queue_order", [])
    member_set = set(member_ids)
    ordered = [fid for fid in order if fid in member_set]
    if not ordered:
        return member_ids[0]
    return ordered[0] if position == "before" else ordered[-1]


def cmd_plan_reorder(args: argparse.Namespace) -> None:
    """Reorder issues in the queue."""
    state = command_runtime(args).state
    if not require_issue_inventory(state):
        return

    patterns: list[str] = getattr(args, "patterns", [])
    position: str = getattr(args, "position", "top")
    target: str | None = getattr(args, "target", None)

    if position in ("before", "after") and target is None:
        print(colorize(f"  '{position}' requires --target (-t). Example: plan reorder <pat> {position} -t <id>", "red"))
        return
    if position in ("up", "down") and target is None:
        print(colorize(f"  '{position}' requires --target (-t) with an integer offset. Example: plan reorder <pat> {position} -t 3", "red"))
        return

    plan = load_plan()

    target = resolve_target(plan, target, position)

    issue_ids = resolve_ids_from_patterns(state, patterns, plan=plan)
    if not issue_ids:
        print(colorize("  No matching issues found.", "yellow"))
        return

    offset: int | None = None
    if position in ("up", "down") and target is not None:
        try:
            offset = int(target)
        except (ValueError, TypeError):
            print(colorize(f"  Invalid offset: {target}", "red"))
            return
        target = None

    count = move_items(plan, issue_ids, position, target=target, offset=offset)
    append_log_entry(
        plan, "reorder", issue_ids=issue_ids, actor="user",
        detail={"position": position, "target": target, "offset": offset},
    )
    save_plan(plan)
    print(colorize(f"  Moved {count} item(s) to {position}.", "green"))


def cmd_plan_promote(args: argparse.Namespace) -> None:
    """Promote backlog issues or cluster members into the active queue."""
    state = command_runtime(args).state
    if not require_issue_inventory(state):
        return

    patterns: list[str] = getattr(args, "patterns", [])
    position: str = getattr(args, "position", "bottom")
    target: str | None = getattr(args, "target", None)

    if position in ("before", "after") and target is None:
        print(colorize(f"  '{position}' requires --target (-t). Example: plan promote <pat> {position} -t <id>", "red"))
        return

    plan = load_plan()
    target = resolve_target(plan, target, position)

    issue_ids = resolve_ids_from_patterns(state, patterns, plan=plan)
    if not issue_ids:
        print(colorize("  No matching issues found.", "yellow"))
        return

    count = move_items(plan, issue_ids, position, target=target)
    add_promoted_ids(plan, issue_ids)
    append_log_entry(
        plan,
        "promote",
        issue_ids=issue_ids,
        actor="user",
        detail={"position": position, "target": target},
    )
    save_plan(plan)
    print(colorize(f"  Promoted {count} item(s) into the active queue.", "green"))


__all__ = ["cmd_plan_promote", "cmd_plan_reorder", "resolve_target"]
