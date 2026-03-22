"""Plan cluster subcommand handlers grouped by cluster capability."""

from __future__ import annotations

import argparse
import re

from desloppify.app.commands.helpers.command_runtime import command_runtime
from desloppify.app.commands.helpers.state import require_issue_inventory
from desloppify.app.commands.plan.shared.cluster_membership import cluster_issue_ids
from desloppify.engine.plan_state import (
    load_plan,
    save_plan,
)
from desloppify.engine.plan_ops import (
    add_to_cluster,
    append_log_entry,
    remove_from_cluster,
)
from desloppify.app.commands.plan.shared.patterns import resolve_ids_from_patterns
from desloppify.base.output.terminal import colorize

from .ops_display import _cmd_cluster_list
from .ops_display import _cmd_cluster_show
from .ops_manage import _cmd_cluster_create
from .ops_manage import _cmd_cluster_delete
from .ops_manage import _cmd_cluster_export
from .ops_manage import _cmd_cluster_import
from .ops_manage import _cmd_cluster_merge
from .ops_reorder import _cmd_cluster_reorder
from .update import cmd_cluster_update as _cmd_cluster_update_impl

_HEX8_RE = re.compile(r"^[0-9a-f]{8}$")
_HINT_TONE = "dim"
_VALID_PATTERN_HINTS = (
    "f41b3eb7              (8-char hash suffix from dashboard)",
    "review::path::name    (ID prefix)",
    "review                (all issues from detector)",
    "src/foo.py            (all issues in file)",
    "timing_attack         (issue name - last ::segment of ID)",
    "review::*naming*      (glob pattern)",
    "my-cluster            (cluster name - expands to members)",
)


def _all_known_issue_ids(state: dict, plan: dict | None) -> list[str]:
    all_ids: list[str] = list((state.get("work_items") or state.get("issues", {})).keys())
    if plan is None:
        return all_ids
    seen_ids: set[str] = set(all_ids)
    for fid in plan.get("queue_order", []):
        if fid not in seen_ids:
            seen_ids.add(fid)
            all_ids.append(fid)
    for cluster in plan.get("clusters", {}).values():
        for fid in cluster_issue_ids(cluster):
            if fid not in seen_ids:
                seen_ids.add(fid)
                all_ids.append(fid)
    return all_ids


def _pattern_suggestions(all_ids: list[str], pattern: str) -> tuple[list[str], str | None]:
    segments = pattern.split("::")
    last_seg = segments[-1]
    tip: str | None = None

    if _HEX8_RE.match(last_seg):
        suffix = last_seg
        suggestions = [fid for fid in all_ids if fid.endswith(f"::{suffix}") or fid == suffix]
        return suggestions, f"match by hash suffix alone: {suffix}"

    slug = segments[-2] if len(segments) >= 2 else ""
    suggestions: list[str] = []
    for fid in all_ids:
        if f"::{last_seg}::" in fid or fid.endswith(f"::{last_seg}"):
            suggestions.append(fid)
        elif slug and (f"::{slug}::" in fid or fid.endswith(f"::{slug}")):
            suggestions.append(fid)
    return suggestions, tip


def _suggest_close_matches(state: dict, plan: dict | None, patterns: list[str]) -> None:
    """Print fuzzy match suggestions for patterns that resolved to zero issues."""
    all_ids = _all_known_issue_ids(state, plan)

    for pattern in patterns:
        suggestions, tip = _pattern_suggestions(all_ids, pattern)
        if suggestions:
            print(colorize(f"  No match for: {pattern!r}", "yellow"))
            print(colorize("  Did you mean:", "dim"))
            for match in suggestions[:3]:
                print(colorize(f"    {match}", "dim"))
            if tip:
                print(colorize(f"  Tip: {tip}", "dim"))


def _print_pattern_hints() -> None:
    """Print valid pattern format hints after a no-match error."""
    print(colorize("  Valid patterns:", _HINT_TONE))
    for hint in _VALID_PATTERN_HINTS:
        print(colorize(f"    {hint}", _HINT_TONE))


def _print_cluster_dry_run(
    *,
    action: str,
    cluster_name: str,
    issue_ids: list[str],
) -> None:
    print(
        colorize(
            f"  [dry-run] Would {action} {len(issue_ids)} item(s) {cluster_name}:",
            "cyan",
        )
    )
    for fid in issue_ids:
        print(colorize(f"    {fid}", _HINT_TONE))


def _warn_cluster_overlap(
    plan: dict,
    *,
    cluster_name: str,
    issue_ids: list[str],
) -> None:
    member_set = set(issue_ids)
    for other_name, other_cluster in plan.get("clusters", {}).items():
        if other_name == cluster_name or other_cluster.get("auto"):
            continue
        other_ids = set(cluster_issue_ids(other_cluster))
        if not other_ids:
            continue
        overlap = member_set & other_ids
        if len(overlap) <= len(other_ids) * 0.5:
            continue
        percent = int(len(overlap) / len(other_ids) * 100)
        print(
            colorize(
                f"  Warning: {len(overlap)} issue(s) also in cluster '{other_name}' "
                f"({len(overlap)}/{len(other_ids)} = {percent}% overlap).",
                "yellow",
            )
        )


def _handle_no_match(state: dict, plan: dict, patterns: list[str]) -> None:
    print(colorize("  No matching issues found.", "yellow"))
    _print_pattern_hints()
    _suggest_close_matches(state, plan, patterns)


def _cmd_cluster_add(args: argparse.Namespace) -> None:
    state = command_runtime(args).state
    if not require_issue_inventory(state):
        return

    cluster_name: str = getattr(args, "cluster_name", "")
    patterns: list[str] = getattr(args, "patterns", [])
    dry_run: bool = getattr(args, "dry_run", False)

    plan = load_plan()
    issue_ids = resolve_ids_from_patterns(state, patterns, plan=plan)
    if not issue_ids:
        _handle_no_match(state, plan, patterns)
        return

    if dry_run:
        _print_cluster_dry_run(
            action="add",
            cluster_name=f"to {cluster_name}:",
            issue_ids=issue_ids,
        )
        return

    try:
        count = add_to_cluster(plan, cluster_name, issue_ids)
    except ValueError as ex:
        print(colorize(f"  {ex}", "red"))
        return

    _warn_cluster_overlap(plan, cluster_name=cluster_name, issue_ids=issue_ids)

    append_log_entry(plan, "cluster_add", issue_ids=issue_ids, cluster_name=cluster_name, actor="user")
    save_plan(plan)
    print(colorize(f"  Added {count} item(s) to cluster {cluster_name}.", "green"))


def _cmd_cluster_remove(args: argparse.Namespace) -> None:
    state = command_runtime(args).state
    if not require_issue_inventory(state):
        return

    cluster_name: str = getattr(args, "cluster_name", "")
    patterns: list[str] = getattr(args, "patterns", [])
    dry_run: bool = getattr(args, "dry_run", False)

    plan = load_plan()
    issue_ids = resolve_ids_from_patterns(state, patterns, plan=plan)
    if not issue_ids:
        _handle_no_match(state, plan, patterns)
        return

    if dry_run:
        _print_cluster_dry_run(
            action="remove",
            cluster_name=f"from {cluster_name}:",
            issue_ids=issue_ids,
        )
        return

    try:
        count = remove_from_cluster(plan, cluster_name, issue_ids)
    except ValueError as ex:
        print(colorize(f"  {ex}", "red"))
        return

    append_log_entry(plan, "cluster_remove", issue_ids=issue_ids, cluster_name=cluster_name, actor="user")
    save_plan(plan)
    print(colorize(f"  Removed {count} item(s) from cluster {cluster_name}.", "green"))


def _cmd_cluster_update(args: argparse.Namespace) -> None:
    """Update cluster description, steps, and/or priority."""
    _cmd_cluster_update_impl(args)


def cmd_cluster_dispatch(args: argparse.Namespace) -> None:
    """Route cluster subcommands."""
    cluster_action = getattr(args, "cluster_action", None)
    dispatch = {
        "create": _cmd_cluster_create,
        "add": _cmd_cluster_add,
        "remove": _cmd_cluster_remove,
        "delete": _cmd_cluster_delete,
        "reorder": _cmd_cluster_reorder,
        "show": _cmd_cluster_show,
        "list": _cmd_cluster_list,
        "update": _cmd_cluster_update,
        "merge": _cmd_cluster_merge,
        "export": _cmd_cluster_export,
        "import": _cmd_cluster_import,
    }
    handler = dispatch.get(cluster_action)
    if handler is None:
        _cmd_cluster_list(args)
        return
    handler(args)


__all__ = [
    "_cmd_cluster_add",
    "_cmd_cluster_remove",
    "_cmd_cluster_update",
    "cmd_cluster_dispatch",
]
