"""Work-item and score-related TypedDict models for persisted state payloads."""

from __future__ import annotations

from typing import Any, NotRequired, TypedDict

from desloppify.base.enums import Status


class WorkItem(TypedDict):
    """The central data structure: a normalized tracked work item."""

    id: str
    detector: str
    work_item_kind: str
    issue_kind: str
    origin: str
    file: str
    tier: int
    confidence: str
    summary: str
    # Known detail shapes per detector/work item (non-exhaustive, for reference):
    #
    # structural:      {loc, complexity_score?, complexity_signals?: list[str],
    #                   name? (god class), ...god_class_metrics}
    # smells:          {smell_id, severity, count, lines: list[int]}
    # dupes:           {fn_a: dict, fn_b: dict, similarity, kind, cluster_size,
    #                   cluster: list}
    # coupling:        {target, tool?, direction, sole_tool?, importer_count?,
    #                   loc?, source_tool?, target_tool?}
    # single_use:      {loc, sole_importer}
    # orphaned:        {loc}
    # facade:          {loc, importers, imports_from: list[str], kind}
    # review:          {holistic?: bool, dimension?, related_files?: list[str],
    #                   suggestion?, evidence?: list[str], investigation?,
    #                   merged_at?}
    # review_coverage: {reason, loc?, age_days?, old_files?, new_files?}
    # security:        {kind, severity, line, content, remediation}
    # test_coverage:   {kind, loc?, importer_count?, loc_weight?,
    #                   test_file?, test_functions?, assertions?, mocks?,
    #                   snapshots?}
    # props:           {passthrough entry fields minus "file"}
    # subjective_assessment (synthetic): {dimension_name, dimension, failing,
    #                   strict_score, open_review_issues?}
    # workflow (synthetic): {stage?, strict?, plan_start_strict?, delta?,
    #                   total_review_issues?, explanation?}
    detail: dict[str, Any]
    status: Status
    note: str | None
    first_seen: str
    last_seen: str
    resolved_at: str | None
    reopen_count: int
    suppressed: NotRequired[bool]
    suppressed_at: NotRequired[str | None]
    suppression_pattern: NotRequired[str | None]
    resolution_attestation: NotRequired[dict[str, str | bool | None]]
    lang: NotRequired[str]
    zone: NotRequired[str]


# Legacy type alias retained while the codebase finishes moving to
# work-item-first naming.
Issue = WorkItem


class TierStats(TypedDict, total=False):
    open: int
    fixed: int
    auto_resolved: int
    wontfix: int
    false_positive: int
    deferred: int
    triaged_out: int


class StateStats(TypedDict, total=False):
    total: int
    open: int
    fixed: int
    auto_resolved: int
    wontfix: int
    false_positive: int
    deferred: int
    triaged_out: int
    by_tier: dict[str, TierStats]


class DimensionScore(TypedDict, total=False):
    score: float
    strict: float
    verified_strict_score: float
    checks: int
    failing: int
    tier: int
    carried_forward: bool
    detectors: dict[str, Any]
    coverage_status: str
    coverage_confidence: float
    coverage_impacts: list[dict[str, Any]]


class ScoreConfidenceDetector(TypedDict, total=False):
    """Detector-level confidence details persisted after each scan."""

    detector: str
    status: str
    confidence: float
    summary: str
    impact: str
    remediation: str
    tool: str
    reason: str


class ScoreConfidenceModel(TypedDict, total=False):
    """State-level score confidence summary."""

    status: str
    confidence: float
    detectors: list[ScoreConfidenceDetector]
    dimensions: list[str]


class ScanHistoryEntry(TypedDict, total=False):
    timestamp: str
    lang: str | None
    strict_score: float | None
    verified_strict_score: float | None
    objective_score: float | None
    overall_score: float | None
    open: int
    diff_new: int
    diff_resolved: int
    ignored: int
    raw_issues: int
    suppressed_pct: float
    ignore_patterns: int
    subjective_integrity: dict[str, Any] | None
    dimension_scores: dict[str, dict[str, float]] | None
    score_confidence: ScoreConfidenceModel | None


__all__ = [
    "WorkItem",
    "Issue",
    "TierStats",
    "StateStats",
    "DimensionScore",
    "ScoreConfidenceDetector",
    "ScoreConfidenceModel",
    "ScanHistoryEntry",
]
