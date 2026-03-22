"""Approved dynamic loader seams for app-layer command modules."""

from __future__ import annotations

import importlib
import logging
from types import ModuleType

from desloppify.base.exception_sets import CommandError

logger = logging.getLogger(__name__)


def load_score_update_module() -> ModuleType:
    """Load the queue/score update helper on demand."""
    return importlib.import_module("desloppify.app.commands.helpers.score_update")


def load_optional_scorecard_module() -> ModuleType | None:
    """Load the optional scorecard module when PIL-backed output is available."""
    try:
        return importlib.import_module("desloppify.app.output.scorecard")
    except ImportError:
        return None


def load_language_move_module(lang_name: str) -> ModuleType:
    """Load a language move module, falling back to the shared scaffold."""
    module_name = f"desloppify.languages.{lang_name}.move"
    try:
        return importlib.import_module(module_name)
    except ImportError as exc:
        if exc.name != module_name:
            raise CommandError(
                f"Failed to import language move module {module_name}: {exc}"
            ) from exc
        logger.debug("Language-specific move module missing: %s", module_name)

    scaffold_module = "desloppify.languages._framework.scaffold_move"
    try:
        return importlib.import_module(scaffold_module)
    except ImportError as exc:
        raise CommandError(
            f"Move not yet supported for language: {lang_name} ({exc})"
        ) from exc


__all__ = [
    "load_language_move_module",
    "load_optional_scorecard_module",
    "load_score_update_module",
]
