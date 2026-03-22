"""Legacy subjective-dimension constants and name helpers."""

from __future__ import annotations

DISPLAY_NAMES: dict[str, str] = {
    # Holistic dimensions
    "cross_module_architecture": "Cross-module arch",
    "initialization_coupling": "Init coupling",
    "convention_outlier": "Convention drift",
    "error_consistency": "Error consistency",
    "abstraction_fitness": "Abstraction fit",
    "dependency_health": "Dep health",
    "test_strategy": "Test strategy",
    "api_surface_coherence": "API coherence",
    "authorization_consistency": "Auth consistency",
    "ai_generated_debt": "AI generated debt",
    "incomplete_migration": "Stale migration",
    "package_organization": "Structure nav",
    "high_level_elegance": "High elegance",
    "mid_level_elegance": "Mid elegance",
    "low_level_elegance": "Low elegance",
    # Design coherence (concerns bridge)
    "design_coherence": "Design coherence",
    # Per-file review dimensions
    "naming_quality": "Naming quality",
    "logic_clarity": "Logic clarity",
    "type_safety": "Type safety",
    "contract_coherence": "Contracts",
}

LEGACY_DISPLAY_NAMES: dict[str, str] = DISPLAY_NAMES

LEGACY_SUBJECTIVE_WEIGHTS_BY_DISPLAY: dict[str, float] = {
    "high elegance": 22.0,
    "mid elegance": 22.0,
    "low elegance": 12.0,
    "contracts": 12.0,
    "type safety": 12.0,
    "abstraction fit": 8.0,
    "logic clarity": 6.0,
    "structure nav": 5.0,
    "error consistency": 3.0,
    "naming quality": 2.0,
    "ai generated debt": 1.0,
    "design coherence": 10.0,
}

LEGACY_RESET_ON_SCAN_DIMENSIONS: frozenset[str] = frozenset(
    {
        "naming_quality",
        "error_consistency",
        "abstraction_fitness",
        "logic_clarity",
        "ai_generated_debt",
        "type_safety",
        "contract_coherence",
        "package_organization",
        "high_level_elegance",
        "mid_level_elegance",
        "low_level_elegance",
    }
)

LEGACY_WEIGHT_BY_DIMENSION: dict[str, float] = {}
for _dimension_key, _display_name in LEGACY_DISPLAY_NAMES.items():
    _weight = LEGACY_SUBJECTIVE_WEIGHTS_BY_DISPLAY.get(
        " ".join(_display_name.strip().lower().split())
    )
    if _weight is not None:
        LEGACY_WEIGHT_BY_DIMENSION[_dimension_key] = _weight


def normalize_dimension_name(name: str) -> str:
    return "_".join(str(name).strip().lower().replace("-", "_").split())


def title_display_name(dimension_key: str) -> str:
    return dimension_key.replace("_", " ").title()


def normalize_lang_name(lang_name: str | None) -> str | None:
    if not isinstance(lang_name, str):
        return None
    cleaned = lang_name.strip().lower()
    return cleaned or None


__all__ = [
    "DISPLAY_NAMES",
    "LEGACY_DISPLAY_NAMES",
    "LEGACY_RESET_ON_SCAN_DIMENSIONS",
    "LEGACY_WEIGHT_BY_DIMENSION",
    "normalize_dimension_name",
    "normalize_lang_name",
    "title_display_name",
]
