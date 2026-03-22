"""Directory counting and hierarchy tracking for flat-directory detection."""

from __future__ import annotations

import logging
from collections import Counter
from pathlib import Path

from desloppify.base.discovery.file_paths import resolve_scan_file

logger = logging.getLogger(__name__)


def build_dir_stats(
    scan_root: Path,
    files: list[str],
) -> tuple[Counter[str], dict[str, set[str]]]:
    """Build per-directory file counts and direct-child directory relationships."""
    dir_counts: Counter[str] = Counter()
    child_dirs: dict[str, set[str]] = {}
    for file_path in files:
        try:
            resolved_file = resolve_scan_file(file_path, scan_root=scan_root).resolve()
            parent_path = resolved_file.parent
            parent_rel = parent_path.relative_to(scan_root)
        except (OSError, ValueError) as exc:
            logger.debug("Skipping unresolvable file %s: %s", file_path, exc)
            continue

        parent = str((scan_root / parent_rel).resolve())
        dir_counts[parent] += 1
        parts = parent_rel.parts
        for idx in range(len(parts) - 1):
            ancestor = (scan_root / Path(*parts[: idx + 1])).resolve()
            child = (scan_root / Path(*parts[: idx + 2])).resolve()
            ancestor_key = str(ancestor)
            child_dirs.setdefault(ancestor_key, set()).add(str(child))
    return dir_counts, child_dirs


def all_tracked_dirs(
    dir_counts: Counter[str],
    child_dirs: dict[str, set[str]],
) -> set[str]:
    """Collect all directories present in either file counts or hierarchy edges."""
    tracked_dirs: set[str] = set(dir_counts.keys())
    tracked_dirs.update(child_dirs.keys())
    for children in child_dirs.values():
        tracked_dirs.update(children)
    return tracked_dirs


__all__ = ["all_tracked_dirs", "build_dir_stats"]
