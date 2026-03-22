"""Legacy `desloppify.state_scoring` wrapper.

Prefer `desloppify.state_score_snapshot` in new code. This module stays as a
compatibility entrypoint for older imports.
"""

from desloppify.state_score_snapshot import (
    ScoreSnapshot,
    get_objective_score,
    get_overall_score,
    get_strict_score,
    get_verified_strict_score,
    suppression_metrics,
)


def score_snapshot(state):
    """Load all four canonical scores while honoring local monkeypatches."""
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
