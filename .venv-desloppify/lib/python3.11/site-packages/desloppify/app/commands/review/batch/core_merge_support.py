"""Merge-support scoring and issue-key helpers for batch review results."""

from __future__ import annotations

from desloppify.intelligence.review.feedback_contract import (
    LEGACY_REVIEW_QUALITY_HIGH_SCORE_MISSING_ISSUES_KEY,
    REVIEW_QUALITY_HIGH_SCORE_MISSING_ISSUES_KEY,
)
from desloppify.intelligence.review.issue_merge import (
    normalize_word_set,
)

from .core_models import (
    BatchDimensionNotePayload,
    BatchIssuePayload,
    BatchResultPayload,
)
from .scoring import DimensionMergeScorer

_DIMENSION_SCORER = DimensionMergeScorer()


def _coerce_numeric_score(score: object) -> float | None:
    if isinstance(score, bool) or not isinstance(score, int | float):
        return None
    return float(score)


def assessment_weight(
    *,
    dimension: str,
    issues: list[BatchIssuePayload],
    dimension_notes: dict[str, BatchDimensionNotePayload],
) -> float:
    """Evidence-weighted assessment score weight with a neutral floor.

    Weighting is evidence-based and score-independent: the raw score does not
    influence how much weight a batch contributes during merge.
    """
    note = dimension_notes.get(dimension, {})
    note_evidence = len(note.get("evidence", [])) if isinstance(note, dict) else 0
    issue_count = sum(
        1 for issue in issues if str(issue.get("dimension", "")).strip() == dimension
    )
    return float(1 + note_evidence + issue_count)


def _accumulate_batch_scores(
    result: BatchResultPayload,
    *,
    score_buckets: dict[str, list[tuple[float, float]]],
    merged_dimension_notes: dict[str, BatchDimensionNotePayload],
    abstraction_axis_scores: dict[str, list[tuple[float, float]]],
    abstraction_sub_axes: tuple[str, ...],
) -> None:
    """Accumulate assessment scores, dimension notes, and sub-axis data from one batch."""
    result_issues = result["issues"]
    result_notes = result["dimension_notes"]
    for key, score in result["assessments"].items():
        weighted_score = _weighted_batch_score(
            key,
            score,
            issues=result_issues,
            dimension_notes=result_notes,
        )
        if weighted_score is None:
            continue
        score_value, weight = weighted_score
        _record_batch_score(
            key,
            score_value,
            weight,
            score_buckets=score_buckets,
        )
        note = result_notes.get(key)
        _merge_strongest_dimension_note(key, note, merged_dimension_notes=merged_dimension_notes)
        _record_abstraction_axis_scores(
            key,
            note,
            weight,
            abstraction_axis_scores=abstraction_axis_scores,
            abstraction_sub_axes=abstraction_sub_axes,
        )


def _weighted_batch_score(
    key: str,
    score: object,
    *,
    issues: list[BatchIssuePayload],
    dimension_notes: dict[str, BatchDimensionNotePayload],
) -> tuple[float, float] | None:
    score_value = _coerce_numeric_score(score)
    if score_value is None:
        return None
    weight = assessment_weight(
        dimension=key,
        issues=issues,
        dimension_notes=dimension_notes,
    )
    return score_value, weight


def _record_batch_score(
    key: str,
    score_value: float,
    weight: float,
    *,
    score_buckets: dict[str, list[tuple[float, float]]],
) -> None:
    score_buckets.setdefault(key, []).append((score_value, weight))


def _evidence_count(note: BatchDimensionNotePayload | None) -> int:
    if not isinstance(note, dict):
        return -1
    return len(note.get("evidence", []))


def _merge_strongest_dimension_note(
    key: str,
    note: BatchDimensionNotePayload | None,
    *,
    merged_dimension_notes: dict[str, BatchDimensionNotePayload],
) -> None:
    if note is None:
        return
    existing = merged_dimension_notes.get(key)
    if _evidence_count(note) > _evidence_count(existing):
        merged_dimension_notes[key] = note


def _record_abstraction_axis_scores(
    key: str,
    note: BatchDimensionNotePayload | None,
    weight: float,
    *,
    abstraction_axis_scores: dict[str, list[tuple[float, float]]],
    abstraction_sub_axes: tuple[str, ...],
) -> None:
    if key != "abstraction_fitness" or not isinstance(note, dict):
        return
    sub_axes = note.get("sub_axes")
    if not isinstance(sub_axes, dict):
        return
    for axis in abstraction_sub_axes:
        axis_score = sub_axes.get(axis)
        if isinstance(axis_score, bool) or not isinstance(axis_score, int | float):
            continue
        abstraction_axis_scores[axis].append((float(axis_score), weight))


def _issue_identity_key(issue: BatchIssuePayload) -> str:
    """Build a stable concept key; prefer dimension+identifier when available."""
    verdict = str(issue.get("concern_verdict", "")).strip().lower()
    fingerprint = str(issue.get("concern_fingerprint", "")).strip()
    if verdict == "dismissed" and fingerprint:
        return f"dismissed::{fingerprint}"

    dim = str(issue.get("dimension", "")).strip()
    ident = str(issue.get("identifier", "")).strip()
    if ident:
        return f"{dim}::{ident}"
    summary = str(issue.get("summary", "")).strip()
    summary_terms = sorted(normalize_word_set(summary))
    if summary_terms:
        return f"{dim}::summary::{','.join(summary_terms[:8])}"
    return f"{dim}::{summary}"


def _accumulate_batch_quality(
    result: BatchResultPayload,
    *,
    coverage_values: list[float],
    evidence_density_values: list[float],
) -> float:
    """Accumulate quality metrics from one batch. Returns high-score-missing-issues delta."""
    quality: object = result["quality"]
    if not isinstance(quality, dict):
        return 0.0
    coverage = quality.get("dimension_coverage")
    density = quality.get("evidence_density")
    missing_issue_note = quality.get(REVIEW_QUALITY_HIGH_SCORE_MISSING_ISSUES_KEY)
    if not isinstance(missing_issue_note, int | float):
        missing_issue_note = quality.get(
            LEGACY_REVIEW_QUALITY_HIGH_SCORE_MISSING_ISSUES_KEY
        )
    if isinstance(coverage, int | float):
        coverage_values.append(float(coverage))
    if isinstance(density, int | float):
        evidence_density_values.append(float(density))
    return (
        float(missing_issue_note)
        if isinstance(missing_issue_note, int | float)
        else 0.0
    )


def _compute_merged_assessments(
    score_buckets: dict[str, list[tuple[float, float]]],
) -> dict[str, float]:
    """Compute merged weighted mean for each dimension."""
    return _DIMENSION_SCORER.merge_scores(score_buckets)


def _compute_abstraction_components(
    merged_assessments: dict[str, float],
    abstraction_axis_scores: dict[str, list[tuple[float, float]]],
    *,
    abstraction_sub_axes: tuple[str, ...],
    abstraction_component_names: dict[str, str],
) -> dict[str, float] | None:
    """Compute weighted abstraction sub-axis component scores."""
    abstraction_score = merged_assessments.get("abstraction_fitness")
    if abstraction_score is None:
        return None

    component_scores: dict[str, float] = {}
    for axis in abstraction_sub_axes:
        weighted = abstraction_axis_scores.get(axis, [])
        if not weighted:
            continue
        numerator = sum(score * weight for score, weight in weighted)
        denominator = sum(weight for _, weight in weighted)
        if denominator <= 0:
            continue
        component_scores[abstraction_component_names[axis]] = round(
            max(0.0, min(100.0, numerator / denominator)),
            1,
        )
    return component_scores if component_scores else None


__all__ = [
    "assessment_weight",
    "_accumulate_batch_quality",
    "_accumulate_batch_scores",
    "_compute_abstraction_components",
    "_compute_merged_assessments",
    "_issue_identity_key",
]
