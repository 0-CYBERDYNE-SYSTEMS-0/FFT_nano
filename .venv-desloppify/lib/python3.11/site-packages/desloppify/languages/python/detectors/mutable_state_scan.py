"""File scanning and stale-import detection for mutable state detector."""

from __future__ import annotations

import ast
import logging
from pathlib import Path

from desloppify.base.discovery.paths import get_project_root
from desloppify.base.discovery.source import find_py_files
from desloppify.languages.python.detectors.mutable_state_ast import (
    _collect_module_level_mutables,
    _detect_in_module,
)

logger = logging.getLogger(__name__)


def _resolve_python_path(filepath: str) -> Path:
    p = Path(filepath)
    if p.is_absolute():
        return p
    return get_project_root() / filepath


def _parse_python_file(filepath: str, *, log_context: str) -> ast.Module | None:
    """Read and parse a Python source file; return ``None`` on recoverable errors."""
    try:
        content = _resolve_python_path(filepath).read_text()
    except (OSError, UnicodeDecodeError) as exc:
        logger.debug("Skipping unreadable python file %s in %s: %s", filepath, log_context, exc)
        return None

    try:
        return ast.parse(content, filename=filepath)
    except SyntaxError as exc:
        logger.debug("Skipping unparseable python file %s in %s: %s", filepath, log_context, exc)
        return None


def _detect_stale_imports(
    path: Path,
    mutated_names: dict[str, set[str]],
    entries: list[dict],
) -> None:
    """Detect ``from X import mutable_name`` that creates a stale binding."""
    files = find_py_files(path)

    for filepath in files:
        tree = _parse_python_file(filepath, log_context="stale-import pass")
        if tree is None:
            continue

        for node in ast.walk(tree):
            if not isinstance(node, ast.ImportFrom):
                continue
            module = node.module or ""
            for source_module, names in mutated_names.items():
                if not (
                    module == source_module
                    or module.endswith(f".{source_module}")
                    or source_module.endswith(f".{module}")
                ):
                    continue
                for alias in node.names:
                    if alias.name in names:
                        entries.append(
                            {
                                "file": filepath,
                                "name": alias.name,
                                "line": node.lineno,
                                "mutation_lines": [],
                                "mutation_count": 0,
                                "confidence": "high",
                                "summary": (
                                    f"'from {module} import {alias.name}' creates stale binding - "
                                    f"'{alias.name}' is reassigned at runtime. Import the module instead."
                                ),
                            }
                        )


def detect_global_mutable_config(path: Path) -> tuple[list[dict], int]:
    """Detect module-level mutable state that gets modified from functions.

    Also detects stale import bindings: other modules that `from X import name`
    a mutable that gets reassigned, which creates a stale copy.

    Returns (entries, total_files_checked).
    """
    files = find_py_files(path)
    entries: list[dict] = []
    mutated_names: dict[str, set[str]] = {}

    for filepath in files:
        tree = _parse_python_file(filepath, log_context="mutable-state pass")
        if tree is None:
            continue

        _detect_in_module(filepath, tree, entries)

        mutables = _collect_module_level_mutables(tree)
        if mutables:
            reassigned = set()
            for node in ast.walk(tree):
                if not isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef):
                    continue
                global_names: set[str] = set()
                for child in ast.walk(node):
                    if isinstance(child, ast.Global):
                        global_names.update(child.names)
                for name in global_names:
                    if name in mutables:
                        reassigned.add(name)
            if reassigned:
                module_path = filepath.replace("/", ".").replace("\\", ".")
                if module_path.endswith(".py"):
                    module_path = module_path[:-3]
                mutated_names[module_path] = reassigned

    if mutated_names:
        _detect_stale_imports(path, mutated_names, entries)

    return entries, len(files)


__all__ = [
    "_detect_stale_imports",
    "detect_global_mutable_config",
]
