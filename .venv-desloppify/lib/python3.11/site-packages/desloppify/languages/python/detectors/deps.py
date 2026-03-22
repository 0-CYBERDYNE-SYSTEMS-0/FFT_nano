"""Python import graph builder — parses import/from statements, resolves to files."""

from __future__ import annotations

import ast
import logging
from collections import defaultdict
from pathlib import Path
from typing import Any

from desloppify.base.discovery.file_paths import resolve_path

from desloppify.base.discovery.source import find_py_files
from desloppify.base.discovery.paths import get_project_root
from desloppify.engine.detectors.graph import finalize_graph
from desloppify.languages.python.detectors.deps_dynamic import (
    find_python_dynamic_imports,
)
from desloppify.languages.python.detectors.deps_resolution import (
    resolve_python_from_import as _resolve_python_from_import,
)
from desloppify.languages.python.detectors.deps_resolution import (
    resolve_python_import as _resolve_python_import,
)

logger = logging.getLogger(__name__)

def build_dep_graph(
    path: Path,
    roslyn_cmd: str | None = None,
) -> dict[str, dict[str, Any]]:
    """Build a dependency graph for Python files.

    Uses ast.parse for reliable import extraction (handles multi-line imports,
    parenthesized imports, aliases, etc.).

    Returns {resolved_path: {"imports": set, "importers": set, "import_count", "importer_count"}}
    """
    del roslyn_cmd
    py_files = find_py_files(path)

    graph: dict[str, dict] = defaultdict(
        lambda: {
            "imports": set(),
            "importers": set(),
            "deferred_imports": set(),
        }
    )

    for filepath in py_files:
        abs_path = (
            filepath if Path(filepath).is_absolute() else str(get_project_root() / filepath)
        )
        try:
            content = Path(abs_path).read_text()
            tree = ast.parse(content, filename=abs_path)
        except (OSError, UnicodeDecodeError, SyntaxError) as exc:
            logger.debug(
                "Skipping unreadable/unparseable python file %s in deps detector: %s",
                filepath,
                exc,
            )
            continue

        source_resolved = resolve_path(filepath)
        graph[source_resolved]  # ensure entry

        # Collect top-level function/class line ranges to detect deferred imports
        top_level_scopes: list[tuple[int, int]] = []
        for node in ast.iter_child_nodes(tree):
            if isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef | ast.ClassDef):
                end = getattr(node, "end_lineno", node.lineno)
                top_level_scopes.append((node.lineno, end))

        for node in ast.walk(tree):
            if not isinstance(node, ast.Import | ast.ImportFrom):
                continue

            is_deferred = any(
                start <= node.lineno <= end for start, end in top_level_scopes
            )

            if isinstance(node, ast.ImportFrom):
                # Build module_path from level (dots) + module name
                dots = "." * (node.level or 0)
                module = node.module or ""
                module_path = dots + module

                import_names = ", ".join(a.name for a in node.names)
                targets = _resolve_python_from_import(
                    module_path, import_names, filepath, path
                )

                for target in targets:
                    graph[source_resolved]["imports"].add(target)
                    graph[target]["importers"].add(source_resolved)
                    if is_deferred:
                        graph[source_resolved]["deferred_imports"].add(target)

            elif isinstance(node, ast.Import):
                for alias in node.names:
                    target = _resolve_python_import(alias.name, filepath, path)
                    if target:
                        graph[source_resolved]["imports"].add(target)
                        graph[target]["importers"].add(source_resolved)
                        if is_deferred:
                            graph[source_resolved]["deferred_imports"].add(target)

    return finalize_graph(dict(graph))

__all__ = ["build_dep_graph", "find_python_dynamic_imports"]
