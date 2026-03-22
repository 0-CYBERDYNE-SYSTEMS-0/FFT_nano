"""Language framework root contract (types only).

Top-level role:
- expose stable type contracts shared by language plugins.

Non-role (owned by explicit submodules, not this root):
- command composition scaffolding: ``commands_base`` / ``commands_base_registry``
- plugin discovery and registration lifecycle: ``discovery`` / ``registration``
- runtime wiring and accessors: ``runtime`` / ``runtime_accessors``
- parser and tree-sitter infrastructure: ``treesitter.*``

Keep this module minimal so ``languages._framework`` is not a catch-all entrypoint.
"""

from __future__ import annotations

from .base.types import (
    BoundaryRule,
    DetectorPhase,
    FixerConfig,
    FixResult,
    LangConfig,
    LangValueSpec,
)

__all__ = [
    "BoundaryRule",
    "DetectorPhase",
    "FixerConfig",
    "FixResult",
    "LangConfig",
    "LangValueSpec",
]
