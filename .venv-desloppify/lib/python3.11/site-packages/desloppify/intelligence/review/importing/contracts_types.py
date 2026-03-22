"""Typed schemas and constants for review import payload contracts."""

from __future__ import annotations

from typing import Any, NotRequired, Required, TypedDict

REVIEW_ISSUE_REQUIRED_FIELDS = (
    "dimension",
    "identifier",
    "summary",
    "confidence",
    "suggestion",
    "related_files",
    "evidence",
)
VALID_REVIEW_CONFIDENCE = frozenset({"high", "medium", "low"})


class ReviewIssuePayload(TypedDict, total=False):
    """Single issue entry in review import payloads."""

    file: str
    dimension: str
    identifier: str
    summary: str
    confidence: str
    suggestion: str
    evidence: list[str]
    related_files: list[str]
    reasoning: str
    evidence_lines: list[int]
    concern_verdict: str
    concern_fingerprint: str
    concern_type: str
    concern_file: str


class ReviewScopePayload(TypedDict, total=False):
    """Optional import-scope metadata shipped with review payloads."""

    imported_dimensions: list[str]
    full_sweep_included: bool


class ReviewProvenancePayload(TypedDict, total=False):
    """Optional provenance block for imported review artifacts."""

    kind: str
    blind: bool
    runner: str
    packet_sha256: str
    packet_path: str


class AssessmentProvenanceStatus(TypedDict, total=False):
    """Normalized provenance trust-check result for assessment imports."""

    trusted: Required[bool]
    reason: Required[str]
    import_file: Required[str]
    runner: str
    packet_path: str
    packet_sha256: str


class AssessmentImportPolicy(TypedDict, total=False):
    """Assessment import policy selected during payload validation."""

    assessments_present: Required[bool]
    assessment_count: Required[int]
    trusted: Required[bool]
    mode: Required[str]
    reason: Required[str]
    provenance: Required[AssessmentProvenanceStatus]
    attest: NotRequired[str]


class ReviewImportPayload(TypedDict, total=False):
    """Raw top-level review import payload before parser-level validation."""

    issues: NotRequired[list[ReviewIssuePayload]]
    assessments: NotRequired[dict[str, Any]]
    reviewed_files: NotRequired[list[str]]
    review_scope: NotRequired[ReviewScopePayload]
    provenance: NotRequired[ReviewProvenancePayload]
    dimension_notes: NotRequired[dict[str, Any]]
    _assessment_policy: NotRequired[AssessmentImportPolicy]


class NormalizedReviewImportPayload(TypedDict):
    """Normalized review import payload after parser-level validation."""

    issues: list[ReviewIssuePayload]
    assessments: dict[str, Any]
    reviewed_files: list[str]
    review_scope: dict[str, Any]
    provenance: dict[str, Any]
    dimension_notes: dict[str, Any]
    _assessment_policy: AssessmentImportPolicy


__all__ = [
    "AssessmentImportPolicy",
    "AssessmentProvenanceStatus",
    "NormalizedReviewImportPayload",
    "REVIEW_ISSUE_REQUIRED_FIELDS",
    "ReviewImportPayload",
    "ReviewIssuePayload",
    "ReviewProvenancePayload",
    "ReviewScopePayload",
    "VALID_REVIEW_CONFIDENCE",
]
