"""Fixer selection helpers that own autofix config resolution."""

from __future__ import annotations

import dataclasses
from collections.abc import Callable

from desloppify.app.commands.helpers.lang import resolve_lang
from desloppify.base.exception_sets import CommandError
from desloppify.languages.framework import FixerConfig, LangConfig

_COMMAND_POST_FIX: dict[str, Callable[..., None]] = {}


def resolve_fixer_config(args, fixer_name: str) -> tuple[LangConfig, FixerConfig]:
    """Resolve and normalize fixer config from language registry, or raise."""
    lang = resolve_lang(args)
    if not lang:
        raise CommandError("Could not detect language. Use --lang to specify.")
    if not lang.fixers:
        raise CommandError(f"No auto-fixers available for {lang.name}.")
    if fixer_name not in lang.fixers:
        available = ", ".join(sorted(lang.fixers.keys()))
        raise CommandError(
            f"Unknown fixer: {fixer_name}\n  Available: {available}"
        )
    fixer_config = lang.fixers[fixer_name]
    if fixer_name in _COMMAND_POST_FIX and not fixer_config.post_fix:
        fixer_config = dataclasses.replace(
            fixer_config,
            post_fix=_COMMAND_POST_FIX[fixer_name],
        )
    return lang, fixer_config


def load_fixer(args, fixer_name: str) -> tuple[LangConfig, FixerConfig]:
    """Compatibility alias for older call sites."""
    return resolve_fixer_config(args, fixer_name)


__all__ = ["_COMMAND_POST_FIX", "load_fixer", "resolve_fixer_config"]
