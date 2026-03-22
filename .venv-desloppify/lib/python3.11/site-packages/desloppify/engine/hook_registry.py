"""Registry accessors for optional language hook modules consumed by detectors."""

from __future__ import annotations

import importlib
import logging
import sys

from desloppify.languages._framework.registry import state as registry_state

logger = logging.getLogger(__name__)


def register_lang_hooks(
    lang_name: str,
    *,
    test_coverage: object | None = None,
) -> None:
    """Register optional detector hook modules for a language."""
    registry_state.register_lang_hooks(
        lang_name,
        test_coverage=test_coverage,
    )


def _bootstrap_language_module(module: object) -> None:
    """Run optional language-module bootstrap hook(s)."""
    register_hooks_fn = getattr(module, "register_hooks", None)
    if register_hooks_fn is not None:
        if not callable(register_hooks_fn):
            raise TypeError("Language module register_hooks entrypoint must be callable")
        register_hooks_fn()
        return
    register_fn = getattr(module, "register", None)
    if register_fn is None:
        return
    if not callable(register_fn):
        raise TypeError("Language module register entrypoint must be callable")
    register_fn()


def get_lang_hook(
    lang_name: str | None,
    hook_name: str,
) -> object | None:
    """Get a previously-registered language hook module, lazy-loading if needed."""
    if not lang_name:
        return None
    hook = registry_state.get_hook(lang_name, hook_name)
    if hook is not None:
        return hook

    # Lazy bootstrap: import the language module and run its registration.
    module_name = f"desloppify.languages.{lang_name}"
    try:
        module = sys.modules.get(module_name) or importlib.import_module(module_name)
        _bootstrap_language_module(module)
    except (ImportError, ValueError, TypeError, RuntimeError, OSError) as exc:
        logger.debug("Unable to bootstrap language hooks for %s: %s", lang_name, exc)
        return None

    return registry_state.get_hook(lang_name, hook_name)


def clear_lang_hooks() -> None:
    """Clear registered language hooks."""
    registry_state.clear_hooks()


def clear_lang_hooks_for_tests() -> None:
    """Compatibility wrapper for older test helpers."""
    clear_lang_hooks()


__all__ = [
    "clear_lang_hooks",
    "clear_lang_hooks_for_tests",
    "get_lang_hook",
    "register_lang_hooks",
]
