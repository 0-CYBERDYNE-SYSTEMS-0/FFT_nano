"""Shared subjective-assessment integrity helpers for review import flows."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

DimensionScoreRow = dict[str, Any]
SubjectiveAtTargetFn = Callable[..., list[DimensionScoreRow]]


def subjective_at_target_dimensions(
    state_or_dim_scores: dict[str, Any],
    dim_scores: dict[str, Any] | None = None,
    *,
    target: float,
    scorecard_subjective_entries_fn,
    matches_target_score_fn,
) -> list[dict[str, Any]]:
    """Return scorecard-aligned subjective rows that sit on the target threshold."""
    state = state_or_dim_scores
    if dim_scores is None:
        dim_scores = state_or_dim_scores
        state = {"dimension_scores": dim_scores}

    rows: list[dict[str, Any]] = []
    for entry in scorecard_subjective_entries_fn(state, dim_scores=dim_scores):
        if entry.get("placeholder"):
            continue
        strict_val = float(entry.get("strict", entry.get("score", 100.0)))
        if matches_target_score_fn(strict_val, target):
            rows.append(
                {
                    "name": str(entry.get("name", "Subjective")),
                    "score": strict_val,
                    "cli_keys": list(entry.get("cli_keys", [])),
                }
            )
    rows.sort(key=lambda item: item["name"].lower())
    return rows


def bind_scorecard_subjective_at_target(
    *,
    reporting_dimensions_mod,
    subjective_integrity_mod,
) -> SubjectiveAtTargetFn:
    """Bind scorecard-specific dependencies once for import/output call sites."""
    return lambda state_or_dim_scores, dim_scores=None, *, target: (
        subjective_at_target_dimensions(
            state_or_dim_scores,
            dim_scores,
            target=target,
            scorecard_subjective_entries_fn=reporting_dimensions_mod.scorecard_subjective_entries,
            matches_target_score_fn=subjective_integrity_mod.matches_target_score,
        )
    )


__all__ = [
    "bind_scorecard_subjective_at_target",
    "subjective_at_target_dimensions",
]
