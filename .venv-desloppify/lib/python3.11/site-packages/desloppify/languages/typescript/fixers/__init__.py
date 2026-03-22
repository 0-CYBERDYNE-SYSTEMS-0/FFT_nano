"""TypeScript fixer loader utilities."""

from __future__ import annotations

import importlib

__all__ = [
    "fix_debug_logs",
    "fix_unused_imports",
    "fix_unused_vars",
    "fix_unused_params",
    "fix_dead_useeffect",
    "fix_empty_if_chain",
]

_EXPORT_MODULES = {
    "fix_debug_logs": ".logs",
    "fix_unused_imports": ".imports",
    "fix_unused_vars": ".vars",
    "fix_unused_params": ".params",
    "fix_dead_useeffect": ".useeffect",
    "fix_empty_if_chain": ".if_chain",
}


def __getattr__(name: str):
    module_path = _EXPORT_MODULES.get(name)
    if module_path is None:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
    module = importlib.import_module(module_path, __name__)
    value = getattr(module, name)
    globals()[name] = value
    return value


def __dir__() -> list[str]:
    return sorted(set(globals()) | set(__all__))
