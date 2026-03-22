"""Data models for review-context construction."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any, TypeAlias


class ReviewContextSchemaError(ValueError):
    """Raised when contextual review payloads violate section-shape contracts."""


SectionPayload: TypeAlias = dict[str, Any]


def _empty_section(name: str) -> SectionPayload:
    _ = name
    return {}


def _coerce_section(
    *,
    section: str,
    value: object,
    strict: bool,
) -> SectionPayload:
    if isinstance(value, Mapping):
        return dict(value)
    if value is None:
        return {}
    if strict:
        raise ReviewContextSchemaError(
            f"review context section '{section}' must be an object, got {type(value).__name__}"
        )
    return {}


@dataclass
class ReviewContext:
    """Codebase-wide context for contextual file evaluation."""

    naming_vocabulary: SectionPayload = field(
        default_factory=lambda: _empty_section("naming_vocabulary")
    )
    error_conventions: SectionPayload = field(
        default_factory=lambda: _empty_section("error_conventions")
    )
    module_patterns: SectionPayload = field(
        default_factory=lambda: _empty_section("module_patterns")
    )
    import_graph_summary: SectionPayload = field(
        default_factory=lambda: _empty_section("import_graph_summary")
    )
    zone_distribution: SectionPayload = field(
        default_factory=lambda: _empty_section("zone_distribution")
    )
    existing_issues: SectionPayload = field(
        default_factory=lambda: _empty_section("existing_issues")
    )
    codebase_stats: SectionPayload = field(
        default_factory=lambda: _empty_section("codebase_stats")
    )
    sibling_conventions: SectionPayload = field(
        default_factory=lambda: _empty_section("sibling_conventions")
    )
    ai_debt_signals: SectionPayload = field(
        default_factory=lambda: _empty_section("ai_debt_signals")
    )
    auth_patterns: SectionPayload = field(
        default_factory=lambda: _empty_section("auth_patterns")
    )
    error_strategies: SectionPayload = field(
        default_factory=lambda: _empty_section("error_strategies")
    )

    _SECTION_NAMES = (
        "naming_vocabulary",
        "error_conventions",
        "module_patterns",
        "import_graph_summary",
        "zone_distribution",
        "existing_issues",
        "codebase_stats",
        "sibling_conventions",
        "ai_debt_signals",
        "auth_patterns",
        "error_strategies",
    )

    def __post_init__(self) -> None:
        self.normalize_sections(strict=True)

    def normalize_sections(self, *, strict: bool) -> None:
        for section in self._SECTION_NAMES:
            setattr(
                self,
                section,
                _coerce_section(section=section, value=getattr(self, section), strict=strict),
            )

    @classmethod
    def from_raw(cls, payload: Mapping[str, Any] | None) -> ReviewContext:
        if payload is not None and not isinstance(payload, Mapping):
            raise ReviewContextSchemaError(
                f"review context payload must be an object, got {type(payload).__name__}"
            )
        raw = payload if isinstance(payload, Mapping) else {}
        return cls(**{section: raw.get(section) for section in cls._SECTION_NAMES})


@dataclass
class HolisticContext:
    """Typed seam contract for holistic review context pipelines."""

    architecture: SectionPayload = field(
        default_factory=lambda: _empty_section("architecture")
    )
    coupling: SectionPayload = field(default_factory=lambda: _empty_section("coupling"))
    conventions: SectionPayload = field(
        default_factory=lambda: _empty_section("conventions")
    )
    errors: SectionPayload = field(default_factory=lambda: _empty_section("errors"))
    abstractions: SectionPayload = field(
        default_factory=lambda: _empty_section("abstractions")
    )
    dependencies: SectionPayload = field(
        default_factory=lambda: _empty_section("dependencies")
    )
    testing: SectionPayload = field(default_factory=lambda: _empty_section("testing"))
    api_surface: SectionPayload = field(
        default_factory=lambda: _empty_section("api_surface")
    )
    structure: SectionPayload = field(default_factory=lambda: _empty_section("structure"))
    codebase_stats: SectionPayload = field(
        default_factory=lambda: _empty_section("codebase_stats")
    )
    authorization: SectionPayload = field(
        default_factory=lambda: _empty_section("authorization")
    )
    ai_debt_signals: SectionPayload = field(
        default_factory=lambda: _empty_section("ai_debt_signals")
    )
    migration_signals: SectionPayload = field(
        default_factory=lambda: _empty_section("migration_signals")
    )
    scan_evidence: SectionPayload = field(
        default_factory=lambda: _empty_section("scan_evidence")
    )

    _SECTION_NAMES = (
        "architecture",
        "coupling",
        "conventions",
        "errors",
        "abstractions",
        "dependencies",
        "testing",
        "api_surface",
        "structure",
        "codebase_stats",
        "authorization",
        "ai_debt_signals",
        "migration_signals",
        "scan_evidence",
    )

    def __post_init__(self) -> None:
        self.normalize_sections(strict=True)

    def normalize_sections(self, *, strict: bool) -> None:
        for section in self._SECTION_NAMES:
            setattr(
                self,
                section,
                _coerce_section(section=section, value=getattr(self, section), strict=strict),
            )

    @classmethod
    def from_raw(cls, payload: Mapping[str, Any] | None) -> HolisticContext:
        if payload is not None and not isinstance(payload, Mapping):
            raise ReviewContextSchemaError(
                f"holistic review context payload must be an object, got {type(payload).__name__}"
            )
        raw = payload if isinstance(payload, Mapping) else {}
        return cls(**{section: raw.get(section) for section in cls._SECTION_NAMES})

    def to_dict(self) -> dict[str, object]:
        return {section: dict(getattr(self, section)) for section in self._SECTION_NAMES}


__all__ = [
    "HolisticContext",
    "ReviewContext",
    "ReviewContextSchemaError",
    "SectionPayload",
]
