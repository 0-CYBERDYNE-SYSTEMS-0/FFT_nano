"""Compatibility bridge to grouped tree-sitter namespace module.

Canonical implementation now lives in desloppify.languages._framework.treesitter.analysis.complexity_nesting.
"""

from __future__ import annotations

from ._compat_bridge import load_compat_exports

_IMPL, __all__ = load_compat_exports(globals(), "desloppify.languages._framework.treesitter.analysis.complexity_nesting")
