"""Pruning helpers for auto-generated plan clusters."""

from __future__ import annotations


def prune_stale_clusters(
    plan: dict,
    issues: dict,
    clusters: dict,
    active_auto_keys: set[str],
    now: str,
) -> int:
    """Delete auto-clusters that no longer have matching groups."""
    changes = 0
    for name in list(clusters.keys()):
        cluster = clusters[name]
        if not cluster.get("auto"):
            continue
        cluster_key = cluster.get("cluster_key", "")
        if cluster_key in active_auto_keys:
            continue
        if cluster.get("user_modified"):
            alive = [
                issue_id
                for issue_id in cluster.get("issue_ids", [])
                if issue_id in issues and issues[issue_id].get("status") == "open"
            ]
            if alive:
                if len(alive) != len(cluster.get("issue_ids", [])):
                    cluster["issue_ids"] = alive
                    cluster["updated_at"] = now
                    changes += 1
                continue
        del clusters[name]
        for issue_id in cluster.get("issue_ids", []):
            override = plan.get("overrides", {}).get(issue_id)
            if override and override.get("cluster") == name:
                override["cluster"] = None
                override["updated_at"] = now
        if plan.get("active_cluster") == name:
            plan["active_cluster"] = None
        changes += 1
    return changes


__all__ = ["prune_stale_clusters"]
