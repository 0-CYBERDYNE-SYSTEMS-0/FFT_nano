"""Shared typed payload models for review batch normalization and merge."""

from __future__ import annotations

from dataclasses import dataclass
from typing import NotRequired, TypedDict


class NormalizedBatchIssuePayload(TypedDict):
    """Normalized issue payload passed across batch merge/import seams."""

    dimension: str
    identifier: str
    summary: str
    confidence: str
    suggestion: str
    related_files: list[str]
    evidence: list[str]

    impact_scope: str
    fix_scope: str
    reasoning: NotRequired[str]
    evidence_lines: NotRequired[list[int]]


class DismissedConcernPayload(TypedDict):
    """Minimal concern payload preserved when a reviewer dismisses a signal."""

    concern_verdict: str
    concern_fingerprint: str
    concern_type: NotRequired[str]
    concern_file: NotRequired[str]
    reasoning: NotRequired[str]


BatchIssuePayload = NormalizedBatchIssuePayload | DismissedConcernPayload


class BatchDimensionNotePayload(TypedDict, total=False):
    """Normalized per-dimension evidence and scoring context."""

    evidence: list[str]
    impact_scope: str
    fix_scope: str
    confidence: str
    issues_preventing_higher_score: str
    sub_axes: dict[str, float]


class BatchDimensionJudgmentPayload(TypedDict, total=False):
    """Reviewer's holistic judgment narrative for a dimension."""

    strengths: list[str]
    dimension_character: str
    score_rationale: str


class BatchQualityPayload(TypedDict, total=False):
    """Quality telemetry attached to each normalized batch output."""

    dimension_coverage: float
    evidence_density: float
    high_score_missing_issue_note: float
    high_score_without_risk: NotRequired[float]


class BatchResultPayload(TypedDict):
    """Canonical normalized batch payload consumed by merge routines."""

    assessments: dict[str, float]
    issues: list[BatchIssuePayload]
    dimension_notes: dict[str, BatchDimensionNotePayload]
    dimension_judgment: dict[str, BatchDimensionJudgmentPayload]
    quality: BatchQualityPayload
    batch_index: NotRequired[int]
    context_updates: NotRequired[dict[str, dict[str, object]]]


@dataclass(frozen=True)
class NormalizedBatchIssue:
    """Typed internal issue contract for normalized batch payloads."""

    dimension: str
    identifier: str
    summary: str
    confidence: str
    suggestion: str
    related_files: list[str]
    evidence: list[str]
    impact_scope: str
    fix_scope: str
    reasoning: str = ""
    evidence_lines: list[int] | None = None

    def to_payload(self) -> NormalizedBatchIssuePayload:
        payload: NormalizedBatchIssuePayload = {
            "dimension": self.dimension,
            "identifier": self.identifier,
            "summary": self.summary,
            "confidence": self.confidence,
            "suggestion": self.suggestion,
            "related_files": list(self.related_files),
            "evidence": list(self.evidence),
            "impact_scope": self.impact_scope,
            "fix_scope": self.fix_scope,
        }
        if self.reasoning:
            payload["reasoning"] = self.reasoning
        if self.evidence_lines:
            payload["evidence_lines"] = list(self.evidence_lines)
        return payload


__all__ = [
    "BatchDimensionJudgmentPayload",
    "BatchDimensionNotePayload",
    "BatchIssuePayload",
    "BatchQualityPayload",
    "BatchResultPayload",
    "DismissedConcernPayload",
    "NormalizedBatchIssue",
    "NormalizedBatchIssuePayload",
]
