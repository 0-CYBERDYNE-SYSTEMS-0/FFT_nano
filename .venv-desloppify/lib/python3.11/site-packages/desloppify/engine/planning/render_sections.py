"""Section render helpers for markdown planning output."""

from __future__ import annotations

from collections import defaultdict

from desloppify.engine.plan_ops import (
    SKIP_KIND_SECTION_LABELS,
    USER_SKIP_KINDS,
    get_issue_description,
    get_issue_note,
)


def summary_lines(stats: dict) -> list[str]:
    open_count = stats.get("open", 0)
    deferred_count = stats.get("deferred", 0) + stats.get("triaged_out", 0)
    total_issues = sum(
        stats.get(key, 0)
        for key in ("open", "fixed", "wontfix", "auto_resolved", "deferred", "triaged_out")
    )
    addressed = total_issues - open_count - deferred_count
    pct = round(addressed / total_issues * 100) if total_issues else 100
    deferred_note = f" · {deferred_count} deferred" if deferred_count else ""
    return [
        f"- **{open_count} open** / {total_issues} total ({pct}% addressed{deferred_note})",
        "",
    ]


def addressed_section(issues: dict) -> list[str]:
    addressed = [issue for issue in issues.values() if issue["status"] != "open"]
    if not addressed:
        return []

    lines: list[str] = ["---", "## Addressed", ""]
    by_status: dict[str, int] = defaultdict(int)
    for issue in addressed:
        by_status[issue["status"]] += 1
    for status, count in sorted(by_status.items()):
        lines.append(f"- **{status}**: {count}")

    wontfix = [
        issue
        for issue in addressed
        if issue["status"] == "wontfix" and issue.get("note")
    ]
    if wontfix:
        lines.extend(["", "### Wontfix (with explanations)", ""])
        for issue in wontfix[:30]:
            lines.append(f"- `{issue['id']}` — {issue['note']}")
    lines.append("")
    return lines


def render_plan_item(item: dict, plan: dict) -> list[str]:
    """Render a single plan item as markdown lines."""
    confidence = item.get("confidence", "medium")
    summary = item.get("summary", "")
    item_id = item.get("id", "")

    lines = [f"- [ ] [{confidence}] {summary}"]
    description = get_issue_description(plan, item_id)
    if description:
        lines.append(f"      → {description}")
    lines.append(f"      `{item_id}`")
    note = get_issue_note(plan, item_id)
    if note:
        lines.append(f"      Note: {note}")
    return lines


def plan_user_ordered_section(
    items: list[dict],
    plan: dict,
) -> list[str]:
    """Render the user-ordered queue section, grouped by cluster."""
    queue_order: list[str] = plan.get("queue_order", [])
    skipped_ids: set[str] = set(plan.get("skipped", {}).keys())
    clusters: dict = plan.get("clusters", {})

    ordered_ids = set(queue_order) - skipped_ids
    if not ordered_ids:
        return []

    by_id = {item.get("id"): item for item in items}
    lines: list[str] = [
        "---",
        f"## User-Ordered Queue ({len(ordered_ids)} items)",
        "",
    ]

    # Build override-based cluster lookup: override cluster wins over issue_ids membership
    overrides: dict = plan.get("overrides", {})
    effective_cluster: dict[str, str] = {}
    for issue_id, ov in overrides.items():
        ov_cluster = ov.get("cluster")
        if ov_cluster and ov_cluster in clusters:
            effective_cluster[issue_id] = ov_cluster

    # queue_order is the single source of truth for item ordering
    queue_pos = {qid: i for i, qid in enumerate(queue_order)}

    # Pre-compute members per cluster, sorted by queue_order position
    cluster_members: dict[str, list[str]] = {}
    cluster_member_sets: dict[str, set[str]] = {}
    for cluster_name, cluster in clusters.items():
        members = [
            issue_id
            for issue_id in cluster.get("issue_ids", [])
            if issue_id in ordered_ids
            and issue_id in by_id
            and effective_cluster.get(issue_id, cluster_name) == cluster_name
        ]
        members.sort(key=lambda x: queue_pos.get(x, float("inf")))
        if members:
            cluster_members[cluster_name] = members
            cluster_member_sets[cluster_name] = set(members)

    # Sort clusters by the queue_order position of their first member
    sorted_cluster_names = sorted(
        cluster_members,
        key=lambda cn: queue_pos.get(cluster_members[cn][0], float("inf")),
    )

    emitted: set[str] = set()
    for cluster_name in sorted_cluster_names:
        member_ids = [mid for mid in cluster_members[cluster_name] if mid not in emitted]
        if not member_ids:
            continue
        desc = clusters[cluster_name].get("description") or ""
        lines.append(f"### Cluster: {cluster_name}")
        if desc:
            lines.append(f"> {desc}")
        lines.append("")
        for issue_id in member_ids:
            item = by_id.get(issue_id)
            if item:
                lines.extend(render_plan_item(item, plan))
                emitted.add(issue_id)
        lines.append("")

    unclustered = [
        issue_id
        for issue_id in queue_order
        if issue_id in ordered_ids and issue_id not in emitted and issue_id in by_id
    ]
    if unclustered:
        if any(cluster.get("issue_ids") for cluster in clusters.values()):
            lines.append("### (unclustered ordered items)")
            lines.append("")
        for issue_id in unclustered:
            item = by_id.get(issue_id)
            if item:
                lines.extend(render_plan_item(item, plan))
        lines.append("")
    return lines


def plan_skipped_section(items: list[dict], plan: dict) -> list[str]:
    """Render the skipped items section, grouped by kind."""
    skipped = plan.get("skipped", {})
    if not skipped:
        return []

    by_id = {item.get("id"): item for item in items}

    by_kind: dict[str, list[str]] = {kind: [] for kind in USER_SKIP_KINDS}
    for issue_id, entry in skipped.items():
        kind = entry.get("kind", "temporary")
        by_kind.setdefault(kind, []).append(issue_id)

    lines: list[str] = [
        "---",
        f"## Skipped ({len(skipped)} items)",
        "",
    ]

    for kind in USER_SKIP_KINDS:
        ids = by_kind.get(kind, [])
        if not ids:
            continue
        lines.append(f"### {SKIP_KIND_SECTION_LABELS[kind]} ({len(ids)})")
        lines.append("")
        for issue_id in ids:
            entry = skipped.get(issue_id, {})
            item = by_id.get(issue_id)
            if item:
                lines.extend(render_plan_item(item, plan))
            else:
                lines.append(f"- ~~{issue_id}~~ (not in current queue)")
            reason = entry.get("reason")
            if reason:
                lines.append(f"      Reason: {reason}")
            note = entry.get("note")
            if note and not get_issue_note(plan, issue_id):
                lines.append(f"      Note: {note}")
            review_after = entry.get("review_after")
            if review_after:
                skipped_at = entry.get("skipped_at_scan", 0)
                lines.append(f"      Review after: scan {skipped_at + review_after}")
        lines.append("")
    return lines


def plan_superseded_section(plan: dict) -> list[str]:
    """Render the superseded items section."""
    superseded = plan.get("superseded", {})
    if not superseded:
        return []

    lines: list[str] = [
        "---",
        f"## Scan Drift ({len(superseded)} items — may need remap)",
        "",
    ]
    for issue_id, entry in superseded.items():
        summary = entry.get("original_summary", "")
        summary_str = f" — {summary}" if summary else ""
        lines.append(f"- ~~{issue_id}~~{summary_str}")
        candidates = entry.get("candidates", [])
        if candidates:
            lines.append(f"  Candidates: {', '.join(candidates[:3])}")
        note = entry.get("note")
        if note:
            lines.append(f"  Note: {note}")
    lines.append("")
    return lines
