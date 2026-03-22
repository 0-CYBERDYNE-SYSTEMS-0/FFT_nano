"""Coupling analysis: boundary violations and boundary candidates.

These detect architectural violations in codebases with shared/tools structure.
The algorithms work on any dep graph — the boundary definitions (what prefixes
constitute "shared" vs "tools") are provided by the caller.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path

from desloppify.base.discovery.file_paths import rel
from desloppify.base.output.fallbacks import log_best_effort_failure
from desloppify.base.discovery.file_paths import count_lines, resolve_scan_file

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class CouplingEdgeCounts:
    """Explicit coupling-edge counters.

    `eligible_edges` tracks the denominator universe for a detector.
    `violating_edges` tracks only edges that violate the rule.
    """

    violating_edges: int = 0
    eligible_edges: int = 0


def _norm_path(path: str) -> str:
    """Normalize path separators for cross-platform prefix matching."""
    return path.replace("\\", "/")


def _norm_prefix(prefix: str, *, name: str) -> str:
    """Normalize a directory prefix and ensure trailing slash."""
    p = _norm_path(str(prefix).strip())
    if not p:
        raise ValueError(f"{name} must be a non-empty directory prefix")
    return p if p.endswith("/") else p + "/"


def _norm_root(path: Path) -> str:
    """Normalize project root path for absolute/relative prefix matching."""
    try:
        root = _norm_path(str(path.resolve()))
    except OSError:
        root = _norm_path(str(path))
    return root if root.endswith("/") else root + "/"


def _rel_to_root(value: str, root_norm: str) -> str:
    """Return root-relative variant (best effort) for path/prefix matching."""
    if value.startswith(root_norm):
        return value[len(root_norm) :]
    return value.lstrip("/")


def _matches_prefix(value: str, prefix: str, *, root_norm: str) -> bool:
    """Match value against prefix regardless of abs/rel shape."""
    if value.startswith(prefix):
        return True
    return _rel_to_root(value, root_norm).startswith(_rel_to_root(prefix, root_norm))


def _strip_prefix(value: str, prefix: str, *, root_norm: str) -> str:
    """Strip prefix from value while tolerating abs/rel shape differences."""
    if value.startswith(prefix):
        return value[len(prefix) :]
    value_rel = _rel_to_root(value, root_norm)
    prefix_rel = _rel_to_root(prefix, root_norm)
    if value_rel.startswith(prefix_rel):
        return value_rel[len(prefix_rel) :]
    return value


def detect_coupling_violations(
    path: Path, graph: dict, shared_prefix: str, tools_prefix: str
) -> tuple[list[dict], CouplingEdgeCounts]:
    """Find files in shared/ that import from tools/ (backwards coupling)."""
    shared_prefix_norm = _norm_prefix(shared_prefix, name="shared_prefix")
    tools_prefix_norm = _norm_prefix(tools_prefix, name="tools_prefix")
    root_norm = _norm_root(path)

    violating_edges = 0
    eligible_edges = 0
    entries = []
    for filepath, entry in graph.items():
        filepath_norm = _norm_path(filepath)
        if not _matches_prefix(filepath_norm, shared_prefix_norm, root_norm=root_norm):
            continue
        for target in entry["imports"]:
            target_norm = _norm_path(target)
            if _matches_prefix(target_norm, tools_prefix_norm, root_norm=root_norm):
                violating_edges += 1
                eligible_edges += 1
                remainder = _strip_prefix(
                    target_norm, tools_prefix_norm, root_norm=root_norm
                )
                tool = remainder.split("/")[0] if "/" in remainder else remainder
                entries.append(
                    {
                        "file": filepath,
                        "target": rel(target),
                        "tool": tool,
                        "direction": "shared→tools",
                    }
                )
            elif _matches_prefix(target_norm, shared_prefix_norm, root_norm=root_norm):
                eligible_edges += 1
    return sorted(entries, key=lambda e: (e["file"], e["target"])), CouplingEdgeCounts(
        violating_edges=violating_edges,
        eligible_edges=eligible_edges,
    )


def detect_boundary_candidates(
    path: Path,
    graph: dict,
    shared_prefix: str,
    tools_prefix: str,
    skip_basenames: set[str] | None = None,
) -> tuple[list[dict], int]:
    """Find shared/ files whose importers ALL come from a single tool."""
    shared_prefix_norm = _norm_prefix(shared_prefix, name="shared_prefix")
    tools_prefix_norm = _norm_prefix(tools_prefix, name="tools_prefix")
    root_norm = _norm_root(path)
    ui_prefix_norm = shared_prefix_norm + "components/ui/"

    total_shared = 0
    entries = []
    skip_basenames = skip_basenames or set()
    for filepath, entry in graph.items():
        filepath_norm = _norm_path(filepath)
        if not _matches_prefix(filepath_norm, shared_prefix_norm, root_norm=root_norm):
            continue
        total_shared += 1
        basename = Path(filepath).name
        if basename in skip_basenames:
            continue
        if _matches_prefix(filepath_norm, ui_prefix_norm, root_norm=root_norm):
            continue
        if entry["importer_count"] == 0:
            continue

        tool_areas = set()
        has_non_tool_importer = False
        for imp in entry["importers"]:
            imp_norm = _norm_path(imp)
            if _matches_prefix(imp_norm, tools_prefix_norm, root_norm=root_norm):
                remainder = _strip_prefix(
                    imp_norm, tools_prefix_norm, root_norm=root_norm
                )
                tool = remainder.split("/")[0]
                tool_areas.add(tool)
            else:
                has_non_tool_importer = True

        if len(tool_areas) == 1 and not has_non_tool_importer:
            try:
                resolved = resolve_scan_file(filepath, scan_root=path)
                if not resolved.exists():
                    raise FileNotFoundError(resolved)
                loc = count_lines(resolved)
            except (OSError, UnicodeDecodeError) as exc:
                log_best_effort_failure(
                    logger,
                    f"read coupling detector candidate {filepath}",
                    exc,
                )
                continue
            entries.append(
                {
                    "file": filepath,
                    "sole_tool": f"src/tools/{list(tool_areas)[0]}",
                    "importer_count": entry["importer_count"],
                    "loc": loc,
                }
            )

    return sorted(entries, key=lambda e: -e["loc"]), total_shared


def detect_cross_tool_imports(
    path: Path, graph: dict, tools_prefix: str
) -> tuple[list[dict], CouplingEdgeCounts]:
    """Find tools/A files that import from tools/B (cross-tool coupling)."""
    tools_prefix_norm = _norm_prefix(tools_prefix, name="tools_prefix")
    root_norm = _norm_root(path)

    violating_edges = 0
    eligible_edges = 0
    entries = []
    for filepath, entry in graph.items():
        filepath_norm = _norm_path(filepath)
        if not _matches_prefix(filepath_norm, tools_prefix_norm, root_norm=root_norm):
            continue
        remainder = _strip_prefix(filepath_norm, tools_prefix_norm, root_norm=root_norm)
        if "/" not in remainder:
            continue
        source_tool = remainder.split("/")[0]
        for target in entry["imports"]:
            target_norm = _norm_path(target)
            if not _matches_prefix(target_norm, tools_prefix_norm, root_norm=root_norm):
                continue
            target_tool = _strip_prefix(
                target_norm, tools_prefix_norm, root_norm=root_norm
            ).split("/")[0]
            eligible_edges += 1
            if source_tool != target_tool:
                violating_edges += 1
                entries.append(
                    {
                        "file": filepath,
                        "target": rel(target),
                        "source_tool": source_tool,
                        "target_tool": target_tool,
                        "direction": "tools→tools",
                    }
                )
    return sorted(entries, key=lambda e: (e["source_tool"], e["file"])), CouplingEdgeCounts(
        violating_edges=violating_edges,
        eligible_edges=eligible_edges,
    )


__all__ = [
    "CouplingEdgeCounts",
    "detect_boundary_candidates",
    "detect_coupling_violations",
    "detect_cross_tool_imports",
]
