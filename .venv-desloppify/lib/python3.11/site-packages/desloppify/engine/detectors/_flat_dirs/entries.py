"""Entry construction and sorting for flat-directory detector findings."""

from __future__ import annotations

from collections import Counter
from pathlib import Path

from .config import FlatDirDetectionConfig


def format_flat_dir_summary(entry: dict) -> str:
    """Render a human-readable summary for a flat/fragmented directory entry."""
    kind = str(entry.get("kind", "overload"))
    file_count = int(entry.get("file_count", 0))
    child_dir_count = int(entry.get("child_dir_count", 0))
    combined_score = int(entry.get("combined_score", file_count))
    sparse_child_count = int(entry.get("sparse_child_count", 0))
    sparse_file_threshold = int(entry.get("sparse_child_file_threshold", 1))
    parent_sibling_count = int(entry.get("parent_sibling_count", 0))
    wrapper_item_count = int(entry.get("wrapper_item_count", 0))
    if kind == "fragmented":
        return (
            "Directory fragmentation: "
            f"{file_count} files, {child_dir_count} child dirs "
            f"(combined {combined_score}); "
            f"{sparse_child_count}/{child_dir_count} child dirs have <= "
            f"{sparse_file_threshold} file(s) — consider flattening/grouping"
        )
    if kind == "overload_fragmented":
        return (
            "Directory overload: "
            f"{file_count} files, {child_dir_count} child dirs "
            f"(combined {combined_score}); "
            f"{sparse_child_count}/{child_dir_count} child dirs have <= "
            f"{sparse_file_threshold} file(s)"
        )
    if kind == "thin_wrapper":
        return (
            "Thin wrapper directory: "
            f"{file_count} files, {child_dir_count} child dirs "
            f"({wrapper_item_count} item) in parent with "
            f"{parent_sibling_count} sibling dirs — consider flattening"
        )
    return (
        "Directory overload: "
        f"{file_count} files, {child_dir_count} child dirs "
        f"(combined {combined_score}) — consider grouping by domain"
    )


def is_overloaded(
    *,
    file_count: int,
    direct_child_count: int,
    combined_score: int,
    settings: FlatDirDetectionConfig,
) -> bool:
    """Check overload conditions based on file count and fan-out thresholds."""
    return (
        file_count >= settings.threshold
        or direct_child_count >= settings.child_dir_threshold
        or combined_score >= settings.combined_threshold
    )


def fragmentation_entry(
    *,
    dir_path: str,
    file_count: int,
    direct_children: set[str],
    direct_child_count: int,
    combined_score: int,
    settings: FlatDirDetectionConfig,
    dir_counts: Counter[str],
    child_dirs: dict[str, set[str]],
) -> dict | None:
    """Build a fragmentation finding when many sparse child dirs are present."""
    sparse_child_count = 0
    for child in direct_children:
        child_file_count = int(dir_counts.get(child, 0))
        child_child_count = len(child_dirs.get(child, set()))
        if (
            child_file_count <= settings.sparse_child_file_threshold
            and child_child_count == 0
        ):
            sparse_child_count += 1
    sparse_child_ratio = (
        float(sparse_child_count) / float(direct_child_count)
        if direct_child_count
        else 0.0
    )
    fragmented = (
        direct_child_count >= settings.sparse_parent_child_threshold
        and sparse_child_count >= settings.sparse_child_count_threshold
        and sparse_child_ratio >= settings.sparse_child_ratio_threshold
    )
    if not fragmented:
        return None
    return {
        "directory": dir_path,
        "file_count": file_count,
        "child_dir_count": direct_child_count,
        "combined_score": combined_score,
        "kind": "fragmented",
        "sparse_child_count": sparse_child_count,
        "sparse_child_ratio": sparse_child_ratio,
        "sparse_child_file_threshold": settings.sparse_child_file_threshold,
    }


def thin_wrapper_entry(
    *,
    dir_path: str,
    thin_names: set[str],
    file_count: int,
    direct_child_count: int,
    combined_score: int,
    settings: FlatDirDetectionConfig,
    child_dirs: dict[str, set[str]],
) -> dict | None:
    """Build a thin-wrapper finding for one-item grouping directories."""
    dir_name = Path(dir_path).name.lower()
    parent_key = str(Path(dir_path).parent)
    parent_sibling_count = len(child_dirs.get(parent_key, set()))
    wrapper_item_count = file_count + direct_child_count
    thin_wrapper = (
        dir_name in thin_names
        and wrapper_item_count == 1
        and file_count <= settings.thin_wrapper_max_file_count
        and direct_child_count <= settings.thin_wrapper_max_child_dir_count
        and parent_sibling_count >= settings.thin_wrapper_parent_sibling_threshold
    )
    if not thin_wrapper:
        return None
    return {
        "directory": dir_path,
        "file_count": file_count,
        "child_dir_count": direct_child_count,
        "combined_score": combined_score,
        "kind": "thin_wrapper",
        "parent_sibling_count": parent_sibling_count,
        "wrapper_item_count": wrapper_item_count,
    }


def sort_entries(entries: list[dict]) -> list[dict]:
    """Sort findings by severity and structural context."""
    return sorted(
        entries,
        key=lambda entry: (
            -int(entry["combined_score"]),
            -int(entry.get("parent_sibling_count", 0)),
            -int(entry.get("sparse_child_count", 0)),
            -int(entry["child_dir_count"]),
            -int(entry["file_count"]),
        ),
    )


__all__ = [
    "format_flat_dir_summary",
    "fragmentation_entry",
    "is_overloaded",
    "sort_entries",
    "thin_wrapper_entry",
]
