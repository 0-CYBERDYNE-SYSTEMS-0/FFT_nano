"""Compatibility exports for plan schema normalization and upgrade helpers."""

from __future__ import annotations

from desloppify.engine._plan.schema.normalize import (
    ensure_container_types,
    normalize_cluster_defaults,
)
from desloppify.engine._plan.schema.version_upgrades import (
    migrate_deferred_to_skipped,
    migrate_epics_to_clusters,
    migrate_synthesis_to_triage,
    migrate_v5_to_v6,
    upgrade_plan_to_v7,
    upgrade_plan_to_v8,
)


__all__ = [
    "ensure_container_types",
    "upgrade_plan_to_v7",
    "upgrade_plan_to_v8",
    "migrate_deferred_to_skipped",
    "migrate_epics_to_clusters",
    "migrate_synthesis_to_triage",
    "migrate_v5_to_v6",
    "normalize_cluster_defaults",
]
