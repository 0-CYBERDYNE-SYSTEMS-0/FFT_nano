"""TypedDict model definitions for persisted state payloads."""

from __future__ import annotations

from typing import Any, NotRequired, Required, TypedDict

from desloppify.engine._state.schema_types_issues import (
    DimensionScore,
    Issue,
    WorkItem,
    ScanHistoryEntry,
    ScoreConfidenceDetector,
    ScoreConfidenceModel,
    StateStats,
    TierStats,
)
from desloppify.engine._state.schema_types_review import (
    AssessmentImportAuditEntry,
    AttestationLogEntry,
    ConcernDismissal,
    ContextInsight,
    DimensionContext,
    IgnoreIntegrityModel,
    LangCapability,
    ReviewCacheModel,
    SubjectiveAssessment,
    SubjectiveAssessmentJudgment,
    SubjectiveIntegrity,
)
from desloppify.languages.framework import ScanCoverageRecord


class ScanMetadataModel(TypedDict, total=False):
    source: Required[str]
    # Legacy persisted inputs may still include these derived flags. Canonical
    # normalized payloads derive capabilities from ``source`` instead.
    inventory_available: NotRequired[bool]
    metrics_available: NotRequired[bool]
    plan_queue_available: bool
    reconstructed_issue_count: int


class StateModel(TypedDict, total=False):
    version: Required[int]
    created: Required[str]
    last_scan: Required[str | None]
    scan_count: Required[int]
    overall_score: Required[float]
    objective_score: Required[float]
    strict_score: Required[float]
    verified_strict_score: Required[float]
    stats: Required[StateStats]
    work_items: Required[dict[str, WorkItem]]
    issues: NotRequired[dict[str, WorkItem]]
    dimension_scores: dict[str, DimensionScore]
    scan_path: str | None
    tool_hash: str
    scan_completeness: dict[str, str]
    potentials: dict[str, dict[str, int]]
    codebase_metrics: dict[str, dict[str, Any]]
    scan_coverage: dict[str, ScanCoverageRecord]
    score_confidence: ScoreConfidenceModel
    scan_history: list[ScanHistoryEntry]
    lang_capabilities: dict[str, LangCapability]
    zone_distribution: dict[str, int]
    review_cache: ReviewCacheModel
    reminder_history: dict[str, int]
    ignore_integrity: IgnoreIntegrityModel
    config: dict[str, Any]
    lang: str
    subjective_integrity: Required[SubjectiveIntegrity]
    subjective_assessments: Required[dict[str, SubjectiveAssessment]]
    custom_review_dimensions: list[str]
    assessment_import_audit: list[AssessmentImportAuditEntry]
    attestation_log: list[AttestationLogEntry]
    concern_dismissals: dict[str, ConcernDismissal]
    dimension_contexts: dict[str, DimensionContext]
    _plan_start_scores_for_reveal: dict[str, Any]
    scan_metadata: Required[ScanMetadataModel]


class ScanDiff(TypedDict):
    new: int
    auto_resolved: int
    reopened: int
    total_current: int
    suspect_detectors: list[str]
    chronic_reopeners: list[dict]
    skipped_other_lang: int
    resolved_out_of_scope: int
    ignored: int
    ignore_patterns: int
    raw_issues: int
    suppressed_pct: float
    skipped: NotRequired[int]
    skipped_details: NotRequired[list[dict]]


__all__ = [
    "ConcernDismissal",
    "ContextInsight",
    "DimensionContext",
    "AssessmentImportAuditEntry",
    "AttestationLogEntry",
    "Issue",
    "WorkItem",
    "TierStats",
    "StateStats",
    "DimensionScore",
    "ScoreConfidenceDetector",
    "ScoreConfidenceModel",
    "ScanHistoryEntry",
    "SubjectiveAssessment",
    "SubjectiveAssessmentJudgment",
    "SubjectiveIntegrity",
    "LangCapability",
    "ReviewCacheModel",
    "IgnoreIntegrityModel",
    "ScanMetadataModel",
    "StateModel",
    "ScanDiff",
]
