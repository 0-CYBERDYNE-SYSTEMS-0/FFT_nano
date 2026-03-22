"""Shared helpers for C# language configuration assembly."""

from __future__ import annotations

from pathlib import Path

from desloppify.engine.detectors.base import FunctionInfo
from desloppify.languages.csharp.extractors import extract_csharp_functions, find_csharp_files


def extract_all_csharp_functions(path: Path) -> list[FunctionInfo]:
    """Extract all C# functions for duplicate detection."""
    functions = []
    for filepath in find_csharp_files(path):
        functions.extend(extract_csharp_functions(filepath))
    return functions


__all__ = ["extract_all_csharp_functions"]
