"""State access helpers for review import workflows."""

from __future__ import annotations

from desloppify.engine._state.schema import StateModel


def ensure_review_file_cache(state: StateModel) -> dict[str, object]:
    """Access ``state["review_cache"]["files"]``, creating if absent."""
    return state.setdefault("review_cache", {}).setdefault("files", {})


def ensure_lang_potentials(state: StateModel, lang_name: str) -> dict[str, object]:
    """Access ``state["potentials"][lang_name]``, creating if absent."""
    return state.setdefault("potentials", {}).setdefault(lang_name, {})


__all__ = ["ensure_lang_potentials", "ensure_review_file_cache"]
