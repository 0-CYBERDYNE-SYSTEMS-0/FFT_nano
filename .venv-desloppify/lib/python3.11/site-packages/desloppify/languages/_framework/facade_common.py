"""Shared helpers for language-specific re-export facade detectors."""

from __future__ import annotations

from collections.abc import Callable

DEFAULT_MAX_IMPORTERS = 20


def facade_tier_confidence(importer_count: int) -> tuple[int, str]:
    """Determine tier and confidence for a facade based on importer count.

    ≤5 importers: tier 2, confidence high   (easy removal)
    6-20 importers: tier 3, confidence medium (moderate effort)
    >20 importers: tier 4, confidence medium  (large-scale refactor)
    """
    if importer_count <= 5:
        return 2, "high"
    if importer_count <= 20:
        return 3, "medium"
    return 4, "medium"


def detect_reexport_facades_common(
    graph: dict,
    *,
    is_facade_fn: Callable[[str], dict | None],
    max_importers: int = DEFAULT_MAX_IMPORTERS,
) -> tuple[list[dict], int]:
    """Collect file-level re-export facades using a language detector callback.

    By default this excludes very high-importer facades (importers > 20),
    but callers can override the ceiling for broader scans.
    """
    entries: list[dict] = []
    total_checked = 0

    for filepath, node in graph.items():
        total_checked += 1

        result = is_facade_fn(filepath)
        if not result:
            continue

        importer_count = node.get("importer_count", 0)
        if importer_count > max_importers:
            continue

        tier, confidence = facade_tier_confidence(importer_count)

        entries.append(
            {
                "file": filepath,
                "loc": result["loc"],
                "importers": importer_count,
                "imports_from": result["imports_from"],
                "kind": "file",
                "tier": tier,
                "confidence": confidence,
            }
        )

    return entries, total_checked


__all__ = [
    "DEFAULT_MAX_IMPORTERS",
    "facade_tier_confidence",
    "detect_reexport_facades_common",
]
