"""Policy constants for language plugin validation."""

from __future__ import annotations

REQUIRED_FILES: tuple[str, ...] = (
    "extractors.py",
    "review.py",
    "test_coverage.py",
)

REQUIRED_DIRS: tuple[str, ...] = ("detectors", "fixers", "tests")

ALLOWED_SCAN_PROFILES: frozenset[str] = frozenset({"objective", "full", "ci"})

# Default holistic review dimensions for full-plugin languages.
HOLISTIC_REVIEW_DIMENSIONS: list[str] = [
    "cross_module_architecture",
    "convention_outlier",
    "error_consistency",
    "abstraction_fitness",
    "api_surface_coherence",
    "authorization_consistency",
    "ai_generated_debt",
    "incomplete_migration",
    "package_organization",
    "high_level_elegance",
    "mid_level_elegance",
    "low_level_elegance",
]
