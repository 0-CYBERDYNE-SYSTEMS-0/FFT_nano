"""Language registration API focused on canonical framework boundaries.

Runtime code should prefer ``desloppify.languages.framework`` for framework
access; this module stays limited to registration and language lookup.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import TypeVar

from desloppify.languages.framework import (
    LangConfig,
    auto_detect_lang,
    available_langs,
    get_lang,
    make_lang_config,
)
from desloppify.languages._framework.contract_validation import validate_lang_contract
from desloppify.languages._framework.policy import REQUIRED_DIRS, REQUIRED_FILES
from desloppify.languages._framework.registry.discovery import load_all
from desloppify.languages._framework.registry.registration import (
    register_lang_class_with,
)
from desloppify.languages._framework.registry.state import all_keys, register
from desloppify.languages._framework.structure_validation import validate_lang_structure

T = TypeVar("T")


def register_lang(name: str) -> Callable[[T], T]:
    """Decorator to register a language config class.

    Validates structure, instantiates the class, validates the contract,
    and stores the *instance* in the registry.
    """

    def decorator(cls: T) -> T:
        register_lang_class_with(
            name,
            cls,
            validate_lang_structure_fn=validate_lang_structure,
        )
        return cls

    return decorator


def register_generic_lang(name: str, cfg: LangConfig) -> None:
    """Register a pre-built language plugin instance (no package structure required)."""
    validate_lang_contract(name, cfg)
    register(name, cfg)


def reload_lang_plugins() -> list[str]:
    """Force plugin rediscovery and return refreshed language names."""
    load_all(force_reload=True)
    return sorted(all_keys())


__all__ = [
    "REQUIRED_FILES",
    "REQUIRED_DIRS",
    "register_lang",
    "register_generic_lang",
    "reload_lang_plugins",
    "get_lang",
    "available_langs",
    "auto_detect_lang",
    "make_lang_config",
    "validate_lang_structure",
    "validate_lang_contract",
]
