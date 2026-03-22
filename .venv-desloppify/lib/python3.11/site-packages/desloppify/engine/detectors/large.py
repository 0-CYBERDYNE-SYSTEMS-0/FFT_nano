"""Large file detection (LOC threshold)."""

from __future__ import annotations

import logging
from pathlib import Path

from desloppify.base.output.fallbacks import log_best_effort_failure
from desloppify.base.discovery.file_paths import count_lines, resolve_scan_file

logger = logging.getLogger(__name__)


def detect_large_files(
    path: Path, file_finder, threshold: int = 500
) -> tuple[list[dict], int]:
    """Find files exceeding a line count threshold."""
    files = file_finder(path)
    entries = []
    for filepath in files:
        try:
            p = resolve_scan_file(filepath, scan_root=path)
            loc = count_lines(p)
            if loc > threshold:
                entries.append({"file": filepath, "loc": loc})
        except (OSError, UnicodeDecodeError) as exc:
            log_best_effort_failure(
                logger,
                f"read large-file detector candidate {filepath}",
                exc,
            )
            continue
    return sorted(entries, key=lambda e: -e["loc"]), len(files)


__all__ = ["detect_large_files"]
