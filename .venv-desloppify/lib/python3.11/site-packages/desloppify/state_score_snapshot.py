"""Canonical score snapshot helpers for state-derived scoring reads."""

from __future__ import annotations

from typing import NamedTuple

from desloppify.engine._state.schema import StateModel
from desloppify.engine._state.schema_scores import (
    get_objective_score,
    get_overall_score,
    get_strict_score,
    get_verified_strict_score,
)
from desloppify.engine._state.scoring import suppression_metrics


class ScoreSnapshot(NamedTuple):
    """All four canonical scores from a single state dict."""

    overall: float | None
    objective: float | None
    strict: float | None
    verified: float | None


def score_snapshot(state: StateModel) -> ScoreSnapshot:
    """Load all four canonical scores from `state` in one call."""
    return ScoreSnapshot(
        overall=get_overall_score(state),
        objective=get_objective_score(state),
        strict=get_strict_score(state),
        verified=get_verified_strict_score(state),
    )


__all__ = [
    "ScoreSnapshot",
    "get_objective_score",
    "get_overall_score",
    "get_strict_score",
    "get_verified_strict_score",
    "score_snapshot",
    "suppression_metrics",
]
