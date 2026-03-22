"""Shared mutable registry state for language plugin discovery."""

from __future__ import annotations

from collections.abc import ItemsView
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from desloppify.languages._framework.base.types import LangConfig

__all__ = [
    "register",
    "get",
    "all_items",
    "all_keys",
    "register_lang_hooks",
    "register_hook",
    "get_hook",
    "clear_hooks",
    "is_registered",
    "remove",
    "clear",
    "set_load_attempted",
    "was_load_attempted",
    "record_load_error",
    "set_load_errors",
    "get_load_errors",
]


@dataclass
class _RegistryState:
    """Mutable language-registry state container."""

    registry: dict[str, LangConfig] = field(default_factory=dict)
    hooks: dict[str, dict[str, object]] = field(default_factory=dict)
    load_attempted: bool = False
    load_errors: dict[str, BaseException] = field(default_factory=dict)


_STATE = _RegistryState()


# ── Public API ────────────────────────────────────────────


def register(name: str, cfg: LangConfig) -> None:
    """Register a language config by name."""
    _STATE.registry[name] = cfg


def get(name: str) -> LangConfig | None:
    """Get a language config by name, or None."""
    return _STATE.registry.get(name)


def all_items() -> ItemsView[str, LangConfig]:
    """Return all (name, config) pairs."""
    return _STATE.registry.items()


def all_keys() -> list[str]:
    """Return all registered language names."""
    return list(_STATE.registry.keys())


def register_lang_hooks(
    lang_name: str,
    *,
    test_coverage: object | None = None,
) -> None:
    """Register optional detector hook modules for a language."""
    if test_coverage is not None:
        register_hook(lang_name, "test_coverage", test_coverage)


def register_hook(lang_name: str, hook_name: str, hook: object) -> None:
    """Register a language hook inside the shared runtime state."""
    hooks = _STATE.hooks.setdefault(lang_name, {})
    hooks[hook_name] = hook


def get_hook(lang_name: str, hook_name: str) -> object | None:
    """Return a previously-registered language hook, if present."""
    return _STATE.hooks.get(lang_name, {}).get(hook_name)


def clear_hooks() -> None:
    """Clear all registered language hooks."""
    _STATE.hooks.clear()


def is_registered(name: str) -> bool:
    """Check if a language is registered."""
    return name in _STATE.registry


def remove(name: str) -> None:
    """Remove a language by name (for testing)."""
    _STATE.registry.pop(name, None)


def clear() -> None:
    """Full reset: registrations, load-attempted flag, and load errors."""
    _STATE.registry.clear()
    _STATE.hooks.clear()
    _STATE.load_attempted = False
    _STATE.load_errors.clear()


def set_load_attempted(value: bool) -> None:
    """Set the load-attempted flag."""
    _STATE.load_attempted = value


def was_load_attempted() -> bool:
    """Check whether plugin loading has been attempted."""
    return _STATE.load_attempted


def record_load_error(name: str, error: BaseException) -> None:
    """Record an import error for a language module."""
    _STATE.load_errors[name] = error


def set_load_errors(errors: dict[str, BaseException]) -> None:
    """Replace the full load-errors dict (used by discovery)."""
    _STATE.load_errors.clear()
    _STATE.load_errors.update(errors)


def get_load_errors() -> dict[str, BaseException]:
    """Return a copy of the load-errors dict."""
    return dict(_STATE.load_errors)
