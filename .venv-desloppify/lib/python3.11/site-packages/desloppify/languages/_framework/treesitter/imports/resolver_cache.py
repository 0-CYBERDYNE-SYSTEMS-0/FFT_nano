"""Cache primitives for tree-sitter import resolution."""

from __future__ import annotations

import logging
from functools import lru_cache

from desloppify.base.output.fallbacks import log_best_effort_failure

def reset_import_cache() -> None:
    """Reset cached resolver state used by import helpers."""
    read_go_module_path.cache_clear()


@lru_cache(maxsize=512)
def read_go_module_path(go_mod_path: str) -> str:
    """Read module path from go.mod with memoization by absolute path."""
    logger = logging.getLogger(__name__)
    module_path = ""
    try:
        with open(go_mod_path) as f:
            for line in f:
                line = line.strip()
                if line.startswith("module "):
                    module_path = line.split(None, 1)[1].strip()
                    break
    except OSError as exc:
        log_best_effort_failure(logger, f"read go.mod at {go_mod_path}", exc)
    return module_path


__all__ = ["read_go_module_path", "reset_import_cache"]
