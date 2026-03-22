"""Canonical registry/discovery subpackage for language framework helpers."""

from .discovery import load_all, raise_load_errors, reload_all, reset_runtime_state
from .registration import (
    register_full_plugin,
    register_lang_class,
    register_lang_class_with,
)
from .resolution import auto_detect_lang, available_langs, get_lang, make_lang_config
from .state import (
    all_items,
    all_keys,
    clear,
    clear_hooks,
    get,
    get_hook,
    get_load_errors,
    is_registered,
    record_load_error,
    register,
    register_lang_hooks,
    register_hook,
    remove,
    set_load_attempted,
    set_load_errors,
    was_load_attempted,
)

__all__ = [
    "all_items",
    "all_keys",
    "auto_detect_lang",
    "available_langs",
    "clear",
    "clear_hooks",
    "get",
    "get_hook",
    "get_lang",
    "get_load_errors",
    "is_registered",
    "load_all",
    "make_lang_config",
    "raise_load_errors",
    "record_load_error",
    "register",
    "register_lang_hooks",
    "register_full_plugin",
    "register_hook",
    "register_lang_class",
    "register_lang_class_with",
    "reload_all",
    "remove",
    "reset_runtime_state",
    "set_load_attempted",
    "set_load_errors",
    "was_load_attempted",
]
