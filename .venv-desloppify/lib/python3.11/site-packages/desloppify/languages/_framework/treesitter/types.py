"""Shared tree-sitter spec types."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass


@dataclass(frozen=True)
class TreeSitterLangSpec:
    """Per-language tree-sitter configuration."""

    grammar: str
    function_query: str
    comment_node_types: frozenset[str]
    string_node_types: frozenset[str] = frozenset()

    import_query: str = ""
    resolve_import: Callable[[str, str, str], str | None] | None = None

    class_query: str = ""

    log_patterns: tuple[str, ...] = (
        r"^\s*(?:fmt\.Print|log\.)",
        r"^\s*(?:println!|eprintln!|dbg!)",
        r"^\s*(?:puts |p |pp )",
        r"^\s*(?:print\(|NSLog)",
        r"^\s*(?:System\.out\.|Logger\.)",
        r"^\s*console\.",
    )


__all__ = ["TreeSitterLangSpec"]
