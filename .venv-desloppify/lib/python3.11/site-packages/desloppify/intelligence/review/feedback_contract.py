"""Shared subjective-review contract for prompts, normalization, and import validation."""

from __future__ import annotations

LOW_SCORE_ISSUE_THRESHOLD = 85.0
ASSESSMENT_FEEDBACK_THRESHOLD = 100.0
HIGH_SCORE_ISSUES_NOTE_THRESHOLD = 85.0
DIMENSION_NOTE_ISSUES_KEY = "issues_preventing_higher_score"
LEGACY_DIMENSION_NOTE_ISSUES_KEY = "unreported_risk"
REVIEW_QUALITY_HIGH_SCORE_MISSING_ISSUES_KEY = "high_score_missing_issue_note"
LEGACY_REVIEW_QUALITY_HIGH_SCORE_MISSING_ISSUES_KEY = "high_score_without_risk"
DEFAULT_MAX_BATCH_ISSUES = 10
TRUSTED_IMPORT_COVERAGE_OVERRIDE_FLAG = "--allow-partial"


def max_batch_issues_for_dimension_count(dimension_count: int) -> int:
    """Return the normalized max issues budget for one batch payload."""
    safe_count = max(0, int(dimension_count))
    return max(DEFAULT_MAX_BATCH_ISSUES, safe_count)


def score_requires_dimension_issue(score: float) -> bool:
    """Return True when score requires at least one explicit issue."""
    return float(score) < LOW_SCORE_ISSUE_THRESHOLD


def score_requires_explicit_feedback(score: float) -> bool:
    """Return True when score requires a issue or dimension-note evidence."""
    return float(score) < ASSESSMENT_FEEDBACK_THRESHOLD


__all__ = [
    "ASSESSMENT_FEEDBACK_THRESHOLD",
    "DIMENSION_NOTE_ISSUES_KEY",
    "DEFAULT_MAX_BATCH_ISSUES",
    "HIGH_SCORE_ISSUES_NOTE_THRESHOLD",
    "LEGACY_DIMENSION_NOTE_ISSUES_KEY",
    "LEGACY_REVIEW_QUALITY_HIGH_SCORE_MISSING_ISSUES_KEY",
    "REVIEW_QUALITY_HIGH_SCORE_MISSING_ISSUES_KEY",
    "TRUSTED_IMPORT_COVERAGE_OVERRIDE_FLAG",
    "LOW_SCORE_ISSUE_THRESHOLD",
    "max_batch_issues_for_dimension_count",
    "score_requires_dimension_issue",
    "score_requires_explicit_feedback",
]
