"""Reusable CLI rendering snippets for command modules."""

from __future__ import annotations

from collections.abc import Callable

from desloppify.app.commands.helpers.queue_progress import (
    QueueBreakdown,
    format_queue_headline,
)
from desloppify.base.discovery.file_paths import rel
from desloppify.base.output.terminal import colorize


def print_agent_plan(
    steps: list[str],
    *,
    next_command: str | None = None,
    header: str = "  AGENT PLAN:",
    plan: dict | None = None,
) -> None:
    """Print a consistent AGENT PLAN block with numbered steps.

    When a living *plan* is active, renders plan focus/progress instead
    of the narrative-derived steps.
    """
    if plan and (plan.get("queue_order") or plan.get("clusters")):
        _print_plan_agent_block(plan, header=header)
        return
    if not steps:
        return
    print(colorize(header, "yellow"))
    for idx, step in enumerate(steps, 1):
        print(colorize(f"  {idx}. {step}", "dim"))
    if next_command:
        print(colorize(f"  Next command: `{next_command}`", "dim"))


def _print_plan_agent_block(plan: dict, *, header: str = "  AGENT PLAN:") -> None:
    """Render the living plan as the agent plan block."""
    active = plan.get("active_cluster")
    ordered = len(plan.get("queue_order", []))
    skipped_ids = set(plan.get("skipped", {}).keys())
    skipped = len(skipped_ids)
    queue_order = plan.get("queue_order", [])
    plan_ordered = sum(1 for fid in queue_order if fid not in skipped_ids)

    # Build a lightweight breakdown for the headline
    breakdown = QueueBreakdown(
        queue_total=ordered,
        plan_ordered=plan_ordered,
        skipped=skipped,
    )
    headline = format_queue_headline(breakdown)

    print(colorize(header, "yellow"))
    print(colorize(f"  Living plan active: {headline}", "dim"))
    if active:
        cluster = plan.get("clusters", {}).get(active, {})
        remaining = len(cluster.get("issue_ids", []))
        print(colorize(f"  Focused on: {active} ({remaining} items remaining).", "dim"))
    print(colorize("  Next command: `desloppify next`", "dim"))
    print(colorize("  View plan: `desloppify plan`", "dim"))


def print_replacement_groups(
    groups: dict[str, list[tuple[str, str]]],
    *,
    title: str,
    rel_fn: Callable[[str], str] = rel,
) -> None:
    """Print grouped old→new replacement lines by file."""
    if not groups:
        return
    print(colorize(title, "cyan"))
    for filepath, replacements in sorted(groups.items()):
        print(f"    {rel_fn(filepath)}:")
        for old, new in replacements:
            print(f"      {old}  →  {new}")
    print()


def print_ranked_actions(
    actions: list[dict], *, limit: int = 3, plan: dict | None = None
) -> bool:
    """Print the highest-impact narrative actions and return True when shown."""
    ranked = sorted(
        [action for action in actions if int(action.get("count", 0)) > 0],
        key=lambda action: (
            -float(action.get("impact", 0.0)),
            -int(action.get("count", 0)),
            int(action.get("priority", 999)),
        ),
    )
    if not ranked:
        return False
    has_plan = plan and (plan.get("queue_order") or plan.get("clusters"))
    label = "Score context:" if has_plan else "Biggest things impacting score:"
    print(colorize(f"  {label}", "cyan"))
    for action in ranked[:limit]:
        detector = action.get("detector", "unknown")
        count = int(action.get("count", 0))
        cluster_count = action.get("cluster_count")
        if cluster_count:
            print(colorize(f"    - {detector}: {count} open in {cluster_count} cluster(s) — `desloppify next`", "dim"))
        else:
            command = action.get("command", "desloppify next")
            print(colorize(f"    - {detector}: {count} open — `{command}`", "dim"))
    return True


__all__ = [
    "print_agent_plan",
    "print_ranked_actions",
    "print_replacement_groups",
]
