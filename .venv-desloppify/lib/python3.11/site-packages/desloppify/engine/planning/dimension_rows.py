"""Scorecard dimension row helpers for the engine/planning layer.

Provides ``scorecard_dimension_rows`` without importing app-layer modules.
App-layer scorecard renderers import this to keep dependency direction clean.
"""

from __future__ import annotations

from desloppify.engine._scoring.policy.core import DIMENSIONS
from desloppify.engine.planning.scorecard_dimensions import (
    prepare_scorecard_dimensions,
)


def scorecard_dimension_rows(
    state: dict,
    *,
    dim_scores: dict | None = None,
) -> list[tuple[str, dict]]:
    """Return scorecard rows using canonical dimension ordering.

    Uses shared engine-level scorecard projection, then falls back to a simple
    mechanical-dimension listing when no rows are projected.
    """
    if dim_scores is None:
        dim_scores = (
            state.get("dimension_scores", {}) if isinstance(state, dict) else {}
        )
        projected_state = state
    else:
        projected_state = dict(state)
        projected_state["dimension_scores"] = dim_scores

    rows = prepare_scorecard_dimensions(projected_state)
    if rows:
        return rows

    # Fallback for synthetic/unit-test states without full scorecard context.
    fallback_dim_scores = dim_scores or {}
    if not isinstance(fallback_dim_scores, dict):
        return []

    mechanical_names = [dimension.name for dimension in DIMENSIONS]
    fallback_rows: list[tuple[str, dict]] = []
    for name in mechanical_names:
        data = fallback_dim_scores.get(name)
        if isinstance(data, dict):
            fallback_rows.append((name, data))
    fallback_rows.extend(
        sorted(
            [
                (name, data)
                for name, data in fallback_dim_scores.items()
                if name not in mechanical_names and isinstance(data, dict)
            ],
            key=lambda item: item[0].lower(),
        )
    )
    return fallback_rows
