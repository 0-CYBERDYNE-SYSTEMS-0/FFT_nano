"""Typed models and helpers for Python smell detector internals."""

from __future__ import annotations

import ast
from collections.abc import Callable
from typing import TypeAlias, TypedDict


class SmellMatch(TypedDict):
    """Normalized smell match shape."""

    file: str
    line: int
    content: str


SmellCounts: TypeAlias = dict[str, list[SmellMatch]]

# Return-based detector contracts used by dispatch registries.
NodeCollector: TypeAlias = Callable[[str, ast.AST, ast.Module], list[SmellMatch]]
TreeCollector: TypeAlias = Callable[
    [str, ast.Module, tuple[ast.AST, ...] | None], list[SmellMatch]
]


def _match_key(match: SmellMatch) -> tuple[str, int, str]:
    return (match["file"], int(match["line"]), match["content"])


def dedupe_smell_matches(matches: list[SmellMatch]) -> list[SmellMatch]:
    """Return stable deterministic list of unique smell matches."""
    seen: set[tuple[str, int, str]] = set()
    unique: list[SmellMatch] = []
    for match in sorted(matches, key=_match_key):
        key = _match_key(match)
        if key in seen:
            continue
        seen.add(key)
        unique.append(match)
    return unique


def merge_smell_matches(
    smell_counts: SmellCounts, smell_id: str, matches: list[SmellMatch]
) -> None:
    """Merge deduped matches into smell_counts[smell_id] without duplicate entries."""
    if not matches:
        return
    target = smell_counts.setdefault(smell_id, [])
    existing = {_match_key(match) for match in target}
    for match in dedupe_smell_matches(matches):
        key = _match_key(match)
        if key in existing:
            continue
        target.append(match)
        existing.add(key)
