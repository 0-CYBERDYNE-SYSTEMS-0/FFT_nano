"""Centralized optional dependency availability checks."""

from __future__ import annotations

from importlib.util import find_spec


def has_module(module_name: str) -> bool:
    """Return True when a Python module can be imported in this environment."""
    name = str(module_name or "").strip()
    if not name:
        return False
    return find_spec(name) is not None


def has_tree_sitter_language_pack() -> bool:
    """Return True when tree-sitter language pack extras are installed."""
    return has_module("tree_sitter_language_pack")


__all__ = ["has_module", "has_tree_sitter_language_pack"]

