"""Cluster show/list display handlers."""

from __future__ import annotations

import argparse

from desloppify.app.commands.helpers.command_runtime import command_runtime
from desloppify.app.commands.plan.shared.cluster_membership import cluster_issue_ids
from desloppify.base.output.terminal import colorize
from desloppify.engine.plan_state import load_plan

from .steps import print_step


def _print_cluster_member(idx: int, fid: str, issue: dict | None) -> None:
    """Print a single cluster member line with optional issue details."""
    print(f"    {idx}. {fid}")
    if not issue:
        return
    file = issue.get("file", "")
    lines = issue.get("detail", {}).get("lines", [])
    line_str = f" at lines: {', '.join(str(ln) for ln in lines)}" if lines else ""
    if file:
        print(colorize(f"       File: {file}{line_str}", "dim"))
    summary = issue.get("summary", "")
    if summary:
        print(colorize(f"       {summary}", "dim"))
    suggestion = issue.get("detail", {}).get("suggestion", "") if isinstance(issue.get("detail"), dict) else ""
    if suggestion:
        print(colorize(f"       Suggestion: {suggestion[:200]}", "dim"))


def _load_issues_best_effort(args: argparse.Namespace) -> dict:
    """Load issues from state, returning empty dict on failure."""
    rt = command_runtime(args)
    return rt.state.get("work_items") or rt.state.get("issues", {})


def _load_cluster_or_print_missing(cluster_name: str) -> dict | None:
    plan = load_plan()
    cluster = plan.get("clusters", {}).get(cluster_name)
    if cluster is not None:
        return cluster
    print(colorize(f"  Cluster {cluster_name!r} does not exist.", "red"))
    return None


def _print_cluster_metadata(cluster_name: str, cluster: dict) -> None:
    auto_tag = "Auto-generated" if cluster.get("auto") else "Manual"
    cluster_key = cluster.get("cluster_key", "")
    key_type = f" ({cluster_key.split('::', 1)[0]})" if cluster_key else ""
    print(colorize(f"  Cluster: {cluster_name}", "bold"))
    print(colorize(f"  Type: {auto_tag}{key_type}", "dim"))
    priority = cluster.get("priority")
    if priority is not None:
        print(colorize(f"  Priority: {priority}", "dim"))
    dep_order = cluster.get("dependency_order")
    if dep_order is not None:
        print(colorize(f"  Dependency order: {dep_order}", "dim"))
    desc = cluster.get("description") or ""
    if desc:
        print(colorize(f"  Description: {desc}", "dim"))
    action = cluster.get("action") or ""
    if action:
        print(colorize(f"  Action: {action}", "dim"))


def _print_cluster_steps(steps: list[dict] | list[str]) -> None:
    if not steps:
        return
    done_count = sum(1 for s in steps if isinstance(s, dict) and s.get("done", False))
    print()
    suffix = f" — {done_count}/{len(steps)} done" if done_count else ""
    print(colorize(f"  Steps ({len(steps)}){suffix}:", "dim"))
    for i, step in enumerate(steps, 1):
        print_step(i, step, colorize_fn=colorize)


def _short_member_id(fid: str) -> str:
    """Shorten an issue ID to its last segment for compact display."""
    return fid.rsplit("::", 1)[-1]


def _print_cluster_members(args: argparse.Namespace, issue_ids: list[str], *, has_steps: bool) -> None:
    print()
    if not issue_ids:
        print(colorize("  Members: (none)", "dim"))
        return

    # When steps exist, members are audit trail — show compact list only.
    # When no steps, members ARE the work — show full detail.
    if has_steps:
        short_ids = [_short_member_id(fid) for fid in issue_ids]
        label = f"  Members ({len(issue_ids)}): "
        # Wrap IDs to fit ~100 char lines
        lines: list[str] = []
        current = label
        for i, sid in enumerate(short_ids):
            sep = ", " if i > 0 else ""
            if len(current) + len(sep) + len(sid) > 100 and current != label:
                lines.append(current)
                current = "    " + sid
            else:
                current += sep + sid
        lines.append(current)
        for line in lines:
            print(colorize(line, "dim"))
        print(colorize(f"  Full detail: desloppify show <member-id> --no-budget", "dim"))
        return

    issues = _load_issues_best_effort(args)
    print(colorize(f"  Members ({len(issue_ids)}):", "dim"))
    for idx, fid in enumerate(issue_ids, 1):
        _print_cluster_member(idx, fid, issues.get(fid))


def _print_cluster_commands(cluster_name: str) -> None:
    print()
    print(colorize("  Commands:", "dim"))
    print(colorize(f'    Resolve all:  desloppify plan resolve "{cluster_name}" --note "<what>" --attest "..."', "dim"))
    print(colorize(f"    Drill in:     desloppify next --cluster {cluster_name} --count 10", "dim"))
    print(colorize(f"    Skip:         desloppify plan skip {cluster_name}", "dim"))


def _cmd_cluster_show(args: argparse.Namespace) -> None:
    cluster_name: str = getattr(args, "cluster_name", "")
    cluster = _load_cluster_or_print_missing(cluster_name)
    if cluster is None:
        return

    _print_cluster_metadata(cluster_name, cluster)
    steps = cluster.get("action_steps") or []
    issue_ids = cluster_issue_ids(cluster)
    _print_cluster_steps(steps)
    _print_cluster_members(args, issue_ids, has_steps=bool(steps))
    _print_cluster_commands(cluster_name)


def _sorted_clusters_by_queue_pos(
    clusters: dict,
    queue_order: list[str],
) -> tuple[list[tuple[str, dict]], dict[str, int]]:
    """Sort clusters by (priority, earliest queue position)."""
    pos_map = {fid: i for i, fid in enumerate(queue_order)}

    def _min_pos(cluster_data: dict) -> int:
        positions = [pos_map[fid] for fid in cluster_issue_ids(cluster_data) if fid in pos_map]
        return min(positions) if positions else 999_999

    min_pos_cache = {name: _min_pos(c) for name, c in clusters.items()}
    sorted_clusters = sorted(
        clusters.items(),
        key=lambda kv: (kv[1].get("priority", 999), min_pos_cache[kv[0]]),
    )
    return sorted_clusters, min_pos_cache


def _print_cluster_list_verbose(
    sorted_clusters: list[tuple[str, dict]],
    min_pos_cache: dict[str, int],
    active: str | None,
) -> None:
    """Print the verbose table view of the cluster list."""
    # Filter out empty auto-clusters — they're noise
    visible = [
        (name, cluster) for name, cluster in sorted_clusters
        if len(cluster_issue_ids(cluster)) > 0 or not cluster.get("auto")
    ]
    if not visible:
        print("  No clusters with items.")
        return

    empty_auto = len(sorted_clusters) - len(visible)
    name_width = max(20, min(35, max(len(name) for name, _ in visible)))
    total_items = sum(len(cluster_issue_ids(c)) for _, c in visible)
    total_steps = sum(len(c.get("action_steps") or []) for _, c in visible)
    print(colorize(
        f"  {len(visible)} clusters ({total_items} issues, {total_steps} steps):",
        "bold",
    ))
    if empty_auto:
        print(colorize(f"  ({empty_auto} empty auto-clusters hidden)", "dim"))
    print()
    header = f"  {'Name':<{name_width}}  {'Issues':>6}  {'Steps':>5}  {'Effort':<10}"
    sep = f"  {'─'*name_width}  {'─'*6}  {'─'*5}  {'─'*10}"
    print(colorize(header, "dim"))
    print(colorize(sep, "dim"))
    for name, cluster in visible:
        print(
            _cluster_list_verbose_row(
                name,
                cluster,
                min_pos_cache[name],
                name_width=name_width,
                active=active,
            )
        )
    print()


def _cluster_list_name_width(sorted_clusters: list[tuple[str, dict]]) -> int:
    return max(20, min(35, max(len(name) for name, _ in sorted_clusters)))


def _cluster_list_verbose_header(name_width: int, has_dep: bool) -> tuple[str, str]:
    dep_header = f"  {'Dep':>3}" if has_dep else ""
    header = (
        f"  {'#pos':<5}  {'Pri':>3}{dep_header}  {'Name':<{name_width}}"
        f"  {'Items':>5}  {'Steps':>5}  {'Effort':<14}  {'Type':<6}  Description"
    )
    dep_sep = f"  {'─'*3}" if has_dep else ""
    sep = (
        f"  {'─'*4}  {'─'*3}{dep_sep}  {'─'*name_width}"
        f"  {'─'*5}  {'─'*5}  {'─'*14}  {'─'*6}  {'─'*40}"
    )
    return header, sep


def _cluster_list_description(desc: str, *, min_pos: int, member_count: int) -> str:
    if not desc and min_pos == 999_999 and not member_count:
        return "(no queue position — no members)"
    return desc


def _cluster_dependency_token(cluster: dict, *, has_dep: bool) -> str:
    if not has_dep:
        return ""
    dep_order = cluster.get("dependency_order")
    dep_token = dep_order if dep_order is not None else "—"
    return f"  {dep_token:>3}"


def _effort_summary(steps: list[dict]) -> str:
    """Summarize step effort tags into a compact string like '3T 1S'."""
    if not steps:
        return "—"
    from collections import Counter
    counts: Counter[str] = Counter()
    for s in steps:
        if isinstance(s, dict):
            effort = s.get("effort", "")
            if effort:
                counts[effort] += 1
    if not counts:
        return "—"
    # Order: trivial < small < medium < large
    order = {"trivial": 0, "small": 1, "medium": 2, "large": 3}
    abbrev = {"trivial": "T", "small": "S", "medium": "M", "large": "L"}
    parts = []
    for effort, _ in sorted(counts.items(), key=lambda kv: order.get(kv[0], 9)):
        parts.append(f"{counts[effort]}{abbrev.get(effort, effort[0].upper())}")
    return " ".join(parts)


def _cluster_list_verbose_row(
    name: str,
    cluster: dict,
    min_pos: int,
    *,
    name_width: int,
    active: str | None,
) -> str:
    member_count = len(cluster_issue_ids(cluster))
    steps = cluster.get("action_steps") or []
    steps_str = str(len(steps)) if steps else "—"
    effort_str = _effort_summary(steps)
    name_display = (name[: name_width - 1] + "…") if len(name) > name_width else name
    focused = " *" if name == active else ""
    return (
        f"  {name_display:<{name_width}}"
        f"  {member_count:>6}  {steps_str:>5}  {effort_str:<10}{focused}"
    )


def _print_missing_steps(gaps: list[tuple[str, list[str]]]) -> None:
    print(colorize(f"  {len(gaps)} cluster(s) need action steps:", "bold"))
    for name, missing in gaps:
        print(colorize(f"    {name}: missing {', '.join(missing)}", "yellow"))
    print()
    print(colorize("  Fix with:", "dim"))
    print(colorize('    desloppify plan cluster update <name> --description "..." --steps "step1" "step2"', "dim"))
    print(colorize('    desloppify plan cluster update <name> --add-step "step title" --detail "sub-details"', "dim"))


def _print_cluster_list_summary(
    sorted_clusters: list[tuple[str, dict]],
    min_pos_cache: dict[str, int],
    active: str | None,
) -> None:
    print(colorize("  Clusters (ordered by priority/queue position):", "bold"))
    for name, cluster in sorted_clusters:
        min_p = min_pos_cache[name]
        pos_str = f"#{min_p}" if min_p < 999_999 else "—"
        priority = cluster.get("priority")
        pri_tag = f" [P{priority}]" if priority is not None else ""
        member_count = len(cluster_issue_ids(cluster))
        desc = cluster.get("description") or ""
        marker = " (focused)" if name == active else ""
        desc_str = f" — {desc}" if desc else ""
        auto_tag = " [auto]" if cluster.get("auto") else ""
        print(f"    {pos_str:>5} {pri_tag} {name}: {member_count} items{auto_tag}{desc_str}{marker}")


def _cmd_cluster_list(args: argparse.Namespace) -> None:
    plan = load_plan()
    clusters = plan.get("clusters", {})
    active = plan.get("active_cluster")
    verbose: bool = getattr(args, "verbose", False)
    missing_steps: bool = getattr(args, "missing_steps", False)

    if not clusters:
        print("  No clusters defined.")
        return

    queue_order: list[str] = plan.get("queue_order", [])
    sorted_clusters, min_pos_cache = _sorted_clusters_by_queue_pos(clusters, queue_order)

    if missing_steps:
        from desloppify.app.commands.plan.triage.stages.helpers import unenriched_clusters

        gaps = unenriched_clusters(plan)
        if not gaps:
            print(colorize("  All clusters have action steps.", "green"))
            return
        _print_missing_steps(gaps)
        return

    if verbose:
        _print_cluster_list_verbose(sorted_clusters, min_pos_cache, active)
        return

    _print_cluster_list_summary(sorted_clusters, min_pos_cache, active)


__all__ = ["_cmd_cluster_list", "_cmd_cluster_show"]
