"""Single-use file detection (file-level importer heuristic for inlining candidates)."""

from __future__ import annotations

import logging
from pathlib import Path

from desloppify.base.output.fallbacks import log_best_effort_failure
from desloppify.base.discovery.file_paths import count_lines, rel, resolve_scan_file

logger = logging.getLogger(__name__)
_LANG_PLUGIN_ENTRYPOINTS = frozenset(
    {
        "commands.py",
        "extractors.py",
        "phases.py",
        "move.py",
        "review.py",
        "test_coverage.py",
    }
)


def _is_lang_plugin_entrypoint(path: Path) -> bool:
    """Whether *path* is a language plugin contract file loaded by convention."""
    if path.name not in _LANG_PLUGIN_ENTRYPOINTS:
        return False
    parts = path.parts
    for idx, segment in enumerate(parts[:-2]):
        if segment not in {"lang", "languages"}:
            continue
        plugin_name = parts[idx + 1]
        return bool(plugin_name and not plugin_name.startswith("_"))
    return False


def _is_test_importer(importer: str) -> bool:
    """Whether an importer path points to test code."""
    p = Path(importer)
    if p.name.startswith("test_"):
        return True
    return any(part in {"tests", "test"} for part in p.parts)


def detect_single_use_abstractions(
    path: Path,
    graph: dict,
    barrel_names: set[str],
) -> tuple[list[dict], int]:
    """Find files imported by exactly one file as inlining candidates."""
    entries = []
    total_candidates = 0
    for filepath, entry in graph.items():
        if entry["importer_count"] != 1:
            continue
        try:
            p = resolve_scan_file(filepath, scan_root=path)
            if not p.exists():
                continue
            basename = p.name
            if basename in barrel_names:
                continue
            if _is_lang_plugin_entrypoint(p):
                continue
            importer = list(entry["importers"])[0]
            if _is_test_importer(importer):
                continue
            total_candidates += 1
            loc = count_lines(p)
            if loc < 20 or loc > 300:
                continue
            entries.append(
                {
                    "file": filepath,
                    "loc": loc,
                    "sole_importer": rel(importer),
                    "reason": f"Only imported by {rel(importer)} — consider inlining",
                    "import_count": entry.get("import_count", 0),
                }
            )
        except (OSError, UnicodeDecodeError) as exc:
            log_best_effort_failure(
                logger,
                f"read single-use detector candidate {filepath}",
                exc,
            )
            continue
    return sorted(entries, key=lambda e: -e["loc"]), total_candidates


__all__ = ["detect_single_use_abstractions"]
