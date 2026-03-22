"""Shared move helpers for scaffold-style language plugins."""

from __future__ import annotations

from desloppify.languages._framework.commands.scaffold import (
    scaffold_find_replacements,
    scaffold_find_self_replacements,
    scaffold_verify_hint,
)


def find_replacements(
    source_abs: str,
    dest_abs: str,
    graph: dict,
) -> dict[str, list[tuple[str, str]]]:
    """Default replacement mapping for scaffolded languages."""
    return scaffold_find_replacements(source_abs, dest_abs, graph)


def find_self_replacements(
    source_abs: str,
    dest_abs: str,
    graph: dict,
) -> list[tuple[str, str]]:
    """Default self-replacement mapping for scaffolded languages."""
    return scaffold_find_self_replacements(source_abs, dest_abs, graph)


def get_verify_hint() -> str:
    """Return the default post-move verification command."""
    return scaffold_verify_hint()

__all__ = ["find_replacements", "find_self_replacements", "get_verify_hint"]
