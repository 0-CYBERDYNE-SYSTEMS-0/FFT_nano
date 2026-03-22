"""Shared assembly helpers for Python language configuration."""

from __future__ import annotations

import os
from functools import partial
from pathlib import Path

from desloppify.base.discovery.source import find_py_files
from desloppify.base.discovery.paths import get_area
from desloppify.engine.detectors.base import FunctionInfo
from desloppify.languages.python.extractors import extract_py_functions

_get_py_area = partial(get_area, min_depth=3)


def py_extract_functions(path: Path) -> list[FunctionInfo]:
    """Extract all Python functions for duplicate detection."""
    functions = []
    for filepath in find_py_files(path):
        functions.extend(extract_py_functions(filepath))
    return functions


def scan_root_from_files(files: list[str]) -> Path | None:
    """Derive the common ancestor directory from a list of file paths."""
    py_files = [f for f in files if f.endswith(".py")]
    if not py_files:
        return None
    try:
        common = Path(os.path.commonpath(py_files))
        return common if common.is_dir() else common.parent
    except ValueError:
        return None


__all__ = ["_get_py_area", "py_extract_functions", "scan_root_from_files"]
