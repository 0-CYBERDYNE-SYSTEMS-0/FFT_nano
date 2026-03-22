"""Collector registry and dimension-to-collector mappings for batch builders."""

from __future__ import annotations

from .prepare_batches_collectors_quality import (
    _abstractions_files,
    _arch_coupling_files,
    _conventions_files,
    _testing_api_files,
    _workflow_seam_files,
)
from .prepare_batches_collectors_structure import (
    _ai_debt_files,
    _authorization_files,
    _package_org_files,
    _state_design_files,
)

_DIMENSION_FILE_MAPPING: dict[str, str] = {
    "cross_module_architecture": "arch_coupling",
    "high_level_elegance": "package_org",
    "convention_outlier": "conventions",
    "error_consistency": "conventions",
    "naming_quality": "conventions",
    "abstraction_fitness": "abstractions",
    "dependency_health": "abstractions",
    "low_level_elegance": "abstractions",
    "mid_level_elegance": "workflow_seams",
    "test_strategy": "testing_api",
    "api_surface_coherence": "testing_api",
    "authorization_consistency": "authorization",
    "ai_generated_debt": "ai_debt",
    "incomplete_migration": "ai_debt",
    "package_organization": "package_org",
    "initialization_coupling": "state_design",
    "design_coherence": "state_design",
    "contract_coherence": "abstractions",
    "logic_clarity": "abstractions",
    "type_safety": "abstractions",
}

_FILE_COLLECTORS = {
    "arch_coupling": _arch_coupling_files,
    "conventions": _conventions_files,
    "abstractions": _abstractions_files,
    "testing_api": _testing_api_files,
    "workflow_seams": _workflow_seam_files,
    "authorization": _authorization_files,
    "ai_debt": _ai_debt_files,
    "package_org": _package_org_files,
    "state_design": _state_design_files,
}

__all__ = [
    "_DIMENSION_FILE_MAPPING",
    "_FILE_COLLECTORS",
    "_abstractions_files",
    "_ai_debt_files",
    "_arch_coupling_files",
    "_authorization_files",
    "_conventions_files",
    "_package_org_files",
    "_state_design_files",
    "_testing_api_files",
]
