"""Shared C/C++ plugin helpers."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from desloppify.languages.cxx.detectors.deps import build_dep_graph as _build_dep_graph

def build_cxx_dep_graph(path: Path) -> dict[str, dict[str, Any]]:
    """Build the C/C++ dependency graph through the language detector module."""
    return _build_dep_graph(path)
