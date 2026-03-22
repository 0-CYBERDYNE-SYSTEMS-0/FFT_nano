"""Shared language-plugin registration helpers."""

from __future__ import annotations

import inspect
from pathlib import Path
from typing import TypeVar

from . import state
from ..base.types import LangConfig
from .resolution import make_lang_config
from ..structure_validation import validate_lang_structure

ConfigType = TypeVar("ConfigType")


def register_lang_class(name: str, config_cls: type[ConfigType]) -> None:
    """Register one language class through canonical framework validation flow."""
    register_lang_structure_fn = validate_lang_structure
    module = inspect.getmodule(config_cls)
    if module and hasattr(module, "__file__"):
        register_lang_structure_fn(Path(module.__file__).parent, name)
    if isinstance(config_cls, type) and issubclass(config_cls, LangConfig):
        cfg = make_lang_config(name, config_cls)
        state.register(name, cfg)
        return
    state.register(name, config_cls)


def register_lang_class_with(
    name: str,
    config_cls: type[ConfigType],
    *,
    validate_lang_structure_fn=validate_lang_structure,
) -> None:
    """Register a class with injectable structure validation seam (tests/callers)."""
    module = inspect.getmodule(config_cls)
    if module and hasattr(module, "__file__"):
        validate_lang_structure_fn(Path(module.__file__).parent, name)
    if isinstance(config_cls, type) and issubclass(config_cls, LangConfig):
        cfg = make_lang_config(name, config_cls)
        state.register(name, cfg)
        return
    state.register(name, config_cls)


def register_full_plugin(
    name: str,
    config_cls: type[ConfigType],
    *,
    test_coverage: object,
) -> None:
    """Register a full language plugin with uniform hooks + duplicate guard."""
    state.register_lang_hooks(name, test_coverage=test_coverage)
    if state.is_registered(name):
        return
    register_lang_class(name, config_cls)


__all__ = [
    "register_full_plugin",
    "register_lang_class",
    "register_lang_class_with",
]
