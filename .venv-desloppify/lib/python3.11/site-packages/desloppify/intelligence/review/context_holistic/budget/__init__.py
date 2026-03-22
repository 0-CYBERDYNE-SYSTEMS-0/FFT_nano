"""Sizing and truncation helpers for holistic context payloads."""

from __future__ import annotations

from .axes import (
    _assemble_context,
    _build_abstraction_leverage_context,
    _build_definition_directness_context,
    _build_delegation_density_context,
    _build_indirection_cost_context,
    _build_interface_honesty_context,
    _build_type_discipline_context,
    _compute_sub_axes,
)
from .scan import _abstractions_context
from .analysis import (
    _count_signature_params,
    _extract_type_names,
    _score_clamped,
)
from .patterns_types import (
    _collect_typed_dict_defs,
    _find_typed_dict_usage_violations,
)
from .patterns_wrappers import (
    _find_delegation_heavy_classes,
    _find_facade_modules,
    _find_python_passthrough_wrappers,
)


def _codebase_stats(file_contents: dict[str, str]) -> dict[str, int]:
    total_loc = sum(len(content.splitlines()) for content in file_contents.values())
    return {
        "total_files": len(file_contents),
        "total_loc": total_loc,
    }


__all__ = [
    "_abstractions_context",
    "_assemble_context",
    "_build_abstraction_leverage_context",
    "_build_definition_directness_context",
    "_build_delegation_density_context",
    "_build_indirection_cost_context",
    "_build_interface_honesty_context",
    "_build_type_discipline_context",
    "_codebase_stats",
    "_compute_sub_axes",
    "_collect_typed_dict_defs",
    "_count_signature_params",
    "_extract_type_names",
    "_find_delegation_heavy_classes",
    "_find_facade_modules",
    "_find_python_passthrough_wrappers",
    "_find_typed_dict_usage_violations",
    "_score_clamped",
]
