"""Progress rendering helpers for triage command handlers."""

from __future__ import annotations

from desloppify.app.commands.helpers.issue_id_display import short_issue_id
from desloppify.app.commands.plan.triage.review_coverage import (
    cluster_issue_ids,
    triage_coverage,
)
from desloppify.base.output.terminal import colorize


def _print_progress(plan: dict, open_issues: dict) -> None:
    """Show cluster state and unclustered issues."""
    clusters = plan.get("clusters", {})
    _print_active_clusters(clusters)
    unclustered = _collect_unclustered_issues(clusters, open_issues)
    _print_unclustered_issues(plan, open_issues, unclustered)


def _print_active_clusters(clusters: dict[str, dict]) -> None:
    """Print current clusters that contain issues."""
    active_clusters = {
        name: cluster for name, cluster in clusters.items() if cluster_issue_ids(cluster)
    }
    if not active_clusters:
        return
    print(colorize("\n  Current clusters:", "cyan"))
    for name, cluster in active_clusters.items():
        count = len(cluster_issue_ids(cluster))
        desc = cluster.get("description") or ""
        tag_str = _cluster_tag_summary(cluster)
        desc_str = f" - {desc}" if desc else ""
        print(f"    {name}: {count} items{tag_str}{desc_str}")


def _cluster_tag_summary(cluster: dict) -> str:
    """Build compact tag summary for one cluster row."""
    steps = cluster.get("action_steps", [])
    auto = cluster.get("auto", False)
    tags: list[str] = []
    tags.append("auto" if auto else "manual")
    tags.append("desc" if cluster.get("description") else "no desc")
    if steps:
        tags.append(f"{len(steps)} steps")
    elif not auto:
        tags.append("no steps")
    return f" [{', '.join(tags)}]"


def _collect_unclustered_issues(clusters: dict[str, dict], open_issues: dict) -> list[str]:
    """Return issue IDs that are not attached to any cluster."""
    all_clustered: set[str] = set()
    for cluster in clusters.values():
        all_clustered.update(cluster_issue_ids(cluster))
    return [issue_id for issue_id in open_issues if issue_id not in all_clustered]


def _print_unclustered_issues(
    plan: dict,
    open_issues: dict,
    unclustered: list[str],
) -> None:
    """Print unclustered issues summary or all-clustered confirmation."""
    if unclustered:
        print(colorize(f"\n  {len(unclustered)} issues not yet in a cluster:", "yellow"))
        for issue_id in unclustered[:10]:
            issue = open_issues[issue_id]
            dim = (
                (issue.get("detail", {}) or {}).get("dimension", "")
                if isinstance(issue.get("detail"), dict)
                else ""
            )
            short = short_issue_id(issue_id)
            print(f"    [{short}] [{dim}] {issue.get('summary', '')}")
        if len(unclustered) > 10:
            print(colorize(f"    ... and {len(unclustered) - 10} more", "dim"))
        return
    if open_issues:
        organized, total, _ = triage_coverage(plan)
        print(colorize(f"\n  All {organized}/{total} issues are in clusters.", "green"))
