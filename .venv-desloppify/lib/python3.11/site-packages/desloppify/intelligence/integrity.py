"""Lightweight integrity helpers for subjective/review scoring.

This module intentionally lives outside ``desloppify.intelligence.review`` so command/state
paths can import it without loading the heavier review package.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping

from desloppify.engine._state.issue_semantics import is_assessment_request
from desloppify.engine._scoring.policy.core import (
    SUBJECTIVE_TARGET_MATCH_TOLERANCE,
    matches_target_score,
)

__all__ = [
    "SUBJECTIVE_TARGET_MATCH_TOLERANCE",
    "is_holistic_subjective_issue",
    "is_subjective_review_open",
    "matches_target_score",
    "subjective_review_open_breakdown",
    "unassessed_subjective_dimensions",
]


# ---------------------------------------------------------------------------
# Internal iteration helper
# ---------------------------------------------------------------------------


def _iter_issues(
    issues: Mapping[str, dict] | Iterable[dict],
) -> Iterable[tuple[str, dict]]:
    """Yield (issue_id, issue) pairs from mapping or iterable inputs."""
    if isinstance(issues, Mapping):
        for issue_id, issue in issues.items():
            if isinstance(issue, dict):
                yield str(issue_id), issue
        return

    for index, issue in enumerate(issues):
        if isinstance(issue, dict):
            yield str(index), issue


# ---------------------------------------------------------------------------
# Public helpers (formerly in integrity/review.py)
# ---------------------------------------------------------------------------


def is_subjective_review_open(issue: dict) -> bool:
    """Return True when a issue is an open subjective-review signal."""
    return issue.get("status") == "open" and is_assessment_request(issue)


def is_holistic_subjective_issue(issue: dict, *, issue_id: str = "") -> bool:
    """Best-effort check for holistic subjective-review coverage issues.

    With dimension-level subjective_review issues, this checks for legacy
    holistic markers (backward compat) and the new dimension-level format.
    """
    candidate_id = str(issue.get("id") or issue_id or "")
    # Legacy holistic markers
    if "::holistic_unreviewed" in candidate_id or "::holistic_stale" in candidate_id:
        return True

    summary = str(issue.get("summary", "") or "").lower()
    if "holistic" in summary and "review" in summary:
        return True

    detail = issue.get("detail", {})
    if detail.get("holistic"):
        return True

    # Dimension-level issues are codebase-wide by nature
    if is_assessment_request(issue) and detail.get("dimension"):
        return True

    return False


def subjective_review_open_breakdown(
    issues: Mapping[str, dict] | Iterable[dict],
) -> tuple[int, dict[str, int], dict[str, int]]:
    """Return open subjective count plus reason and dimension breakdowns."""
    reason_counts: dict[str, int] = {}
    dimension_counts: dict[str, int] = {}
    total = 0

    for issue_id, issue in _iter_issues(issues):
        if not is_subjective_review_open(issue):
            continue

        total += 1
        detail = issue.get("detail", {})
        reason = str(detail.get("reason", "other") or "other")
        reason_counts[reason] = reason_counts.get(reason, 0) + 1

        dim = str(detail.get("dimension", "") or "")
        if dim:
            dimension_counts[dim] = dimension_counts.get(dim, 0) + 1

    return total, reason_counts, dimension_counts


def unassessed_subjective_dimensions(dim_scores: dict | None) -> list[str]:
    """Return subjective dimension display names that are still 0% placeholders."""
    if not dim_scores:
        return []

    unassessed: list[str] = []
    for name, info in dim_scores.items():
        detectors = info.get("detectors", {})
        if "subjective_assessment" not in detectors:
            continue
        assessment_meta = detectors.get("subjective_assessment", {})
        if isinstance(assessment_meta, dict) and assessment_meta.get("placeholder"):
            unassessed.append(name)
            continue
        strict_val = float(info.get("strict", info.get("score", 100.0)))
        issues = int(info.get("failing", 0))
        if strict_val <= 0.0 and issues == 0:
            unassessed.append(name)

    unassessed.sort()
    return unassessed
