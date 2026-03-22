"""Data collection and tree-building helpers for visualization output."""

from __future__ import annotations

import logging
from collections import defaultdict
from pathlib import Path
from typing import Any

import desloppify.languages.framework as lang_api
from desloppify.base.discovery.file_paths import rel, resolve_scan_file
from desloppify.base.discovery.source import find_source_files
from desloppify.base.output.fallbacks import (
    log_best_effort_failure,
    warn_best_effort,
)

logger = logging.getLogger(__name__)

_RECOVERABLE_LANG_RESOLUTION_ERRORS = (
    ImportError,
    ValueError,
    TypeError,
    AttributeError,
    OSError,
    RuntimeError,
)


def _resolve_visualization_lang(path: Path, lang):
    """Resolve language config for visualization if not already provided."""
    if lang:
        return lang

    search_roots = [path if path.is_dir() else path.parent]
    search_roots.extend(search_roots[0].parents)
    warned = False
    for root in search_roots:
        try:
            detected = lang_api.auto_detect_lang(root)
        except _RECOVERABLE_LANG_RESOLUTION_ERRORS as exc:
            log_best_effort_failure(
                logger,
                f"auto-detect visualization language for {root}",
                exc,
            )
            if not warned:
                warned = True
                warn_best_effort(
                    "Could not auto-detect language plugins for visualization; "
                    f"using fallback source discovery ({type(exc).__name__}: {exc})."
                )
            continue
        if detected:
            try:
                return lang_api.get_lang(detected)
            except _RECOVERABLE_LANG_RESOLUTION_ERRORS as exc:
                log_best_effort_failure(
                    logger,
                    f"load visualization language plugin '{detected}'",
                    exc,
                )
                if not warned:
                    warned = True
                    warn_best_effort(
                        "Visualization language plugin failed to load; using fallback source discovery "
                        f"({type(exc).__name__}: {exc})."
                    )
                continue
    return None


def _fallback_source_files(path: Path) -> list[str]:
    """Collect source files using extensions from all registered language plugins."""
    extensions: set[str] = set()
    warned = False
    for lang_name in lang_api.available_langs():
        try:
            cfg = lang_api.get_lang(lang_name)
        except _RECOVERABLE_LANG_RESOLUTION_ERRORS as exc:
            log_best_effort_failure(
                logger,
                f"load fallback visualization language plugin '{lang_name}'",
                exc,
            )
            if not warned:
                warned = True
                warn_best_effort(
                    "Some language plugins could not be loaded for visualization fallback; using available plugins only "
                    f"({type(exc).__name__}: {exc})."
                )
            continue
        extensions.update(cfg.extensions)
    if not extensions:
        return []
    return find_source_files(path, sorted(extensions))


def _collect_file_data(path: Path, lang=None) -> list[dict]:
    """Collect LOC for all source files using the language's file finder."""
    resolved_lang = _resolve_visualization_lang(path, lang)
    if resolved_lang and resolved_lang.file_finder:
        source_files = resolved_lang.file_finder(path)
    else:
        source_files = _fallback_source_files(path)
    files = []
    warned_read_failure = False
    for filepath in source_files:
        try:
            p = resolve_scan_file(filepath, scan_root=path)
            content = p.read_text()
            loc = len(content.splitlines())
            files.append(
                {
                    "path": rel(filepath),
                    "abs_path": str(p.resolve()),
                    "loc": loc,
                }
            )
        except (OSError, UnicodeDecodeError) as exc:
            log_best_effort_failure(
                logger, f"read visualization source file {filepath}", exc
            )
            if not warned_read_failure:
                warned_read_failure = True
                warn_best_effort(
                    "Some visualization source files could not be read; output may be incomplete."
                )
            continue
    return files


def _build_tree(files: list[dict], dep_graph: dict, issues_by_file: dict) -> dict:
    """Build nested tree structure for D3 treemap."""
    root: dict = {"name": "src", "children": {}}

    for f in files:
        parts = f["path"].split("/")
        # Skip leading 'src/' since root is already 'src'
        if parts and parts[0] == "src":
            parts = parts[1:]
        node = root
        for part in parts[:-1]:
            if part not in node["children"]:
                node["children"][part] = {"name": part, "children": {}}
            node = node["children"][part]

        filename = parts[-1]
        resolved = f["abs_path"]
        dep_entry = dep_graph.get(resolved, {"import_count": 0, "importer_count": 0})
        file_issues = issues_by_file.get(f["path"], [])
        open_issues = [ff for ff in file_issues if ff.get("status") == "open"]

        node["children"][filename] = {
            "name": filename,
            "path": f["path"],
            "loc": max(f["loc"], 1),  # D3 needs >0 values
            "fan_in": dep_entry.get("importer_count", 0),
            "fan_out": dep_entry.get("import_count", 0),
            "issues_total": len(file_issues),
            "issues_open": len(open_issues),
            "issue_summaries": [ff.get("summary", "") for ff in open_issues[:20]],
        }

    # Convert children dicts to arrays (D3 format)
    def to_array(node: dict[str, Any]) -> None:
        if "children" in node and isinstance(node["children"], dict):
            children = list(node["children"].values())
            for child in children:
                to_array(child)
            node["children"] = children
            # Remove empty directories
            node["children"] = [
                c
                for c in node["children"]
                if "loc" in c or ("children" in c and c["children"])
            ]

    to_array(root)
    return root


def _build_dep_graph_for_path(path: Path, lang) -> dict:
    """Build dependency graph using the resolved language plugin."""
    resolved_lang = _resolve_visualization_lang(path, lang)
    if resolved_lang and resolved_lang.build_dep_graph:
        try:
            return resolved_lang.build_dep_graph(path)
        except (
            OSError,
            UnicodeDecodeError,
            ValueError,
            RuntimeError,
            TypeError,
        ) as exc:
            log_best_effort_failure(logger, "build visualization dependency graph", exc)
            warn_best_effort(
                "Could not build visualization dependency graph; showing file-only view."
            )
    return {}


def _issues_by_file(state: dict | None) -> dict[str, list]:
    """Group issues from state by file path."""
    result: dict[str, list] = defaultdict(list)
    work_items = (state.get("work_items") or state.get("issues", {})) if state else {}
    if work_items:
        for f in work_items.values():
            result[f["file"]].append(f)
    return result


__all__ = [
    "_build_dep_graph_for_path",
    "_build_tree",
    "_collect_file_data",
    "_fallback_source_files",
    "_issues_by_file",
    "_resolve_visualization_lang",
]
