"""Default scaffold behaviors shared by language adapters."""

from __future__ import annotations

SCAFFOLD_VERIFY_HINT = "desloppify detect deps"
SCAFFOLD_HOLISTIC_REVIEW_DIMENSIONS = [
    "cross_module_architecture",
    "error_consistency",
    "abstraction_fitness",
    "test_strategy",
]


def scaffold_find_replacements(
    source_abs: str, dest_abs: str, graph: dict
) -> dict[str, list[tuple[str, str]]]:
    """Default scaffold move behavior until language-specific move support exists."""
    del source_abs, dest_abs, graph
    return {}


def scaffold_find_self_replacements(
    source_abs: str, dest_abs: str, graph: dict
) -> list[tuple[str, str]]:
    """Default scaffold self-replacement behavior until move support exists."""
    del source_abs, dest_abs, graph
    return []


def scaffold_verify_hint() -> str:
    """Return the default verification command for scaffolded move adapters."""
    return SCAFFOLD_VERIFY_HINT


__all__ = [
    "SCAFFOLD_HOLISTIC_REVIEW_DIMENSIONS",
    "SCAFFOLD_VERIFY_HINT",
    "scaffold_find_replacements",
    "scaffold_find_self_replacements",
    "scaffold_verify_hint",
]
