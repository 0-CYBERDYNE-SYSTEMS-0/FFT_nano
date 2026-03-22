"""Subjective-score helpers for the `next` command."""

from __future__ import annotations

from typing import Any

from desloppify.base.config import DEFAULT_TARGET_STRICT_SCORE

from .render_support import scorecard_subjective as _scorecard_subjective_impl


def _scorecard_subjective(state: dict, dim_scores: dict) -> list[dict[str, Any]]:
    """Return scorecard-aligned subjective entries for current dimension scores."""
    return _scorecard_subjective_impl(state, dim_scores)


def _low_subjective_dimensions(
    state: dict,
    dim_scores: dict,
    *,
    threshold: float = DEFAULT_TARGET_STRICT_SCORE,
) -> list[tuple[str, float, int]]:
    """Return assessed scorecard-subjective entries below the threshold."""
    low: list[tuple[str, float, int]] = []
    for entry in _scorecard_subjective(state, dim_scores):
        if entry.get("placeholder"):
            continue
        strict_val = float(entry.get("strict", entry.get("score", 100.0)))
        if strict_val < threshold:
            low.append(
                (
                    str(entry.get("name", "Subjective")),
                    strict_val,
                    int(entry.get("failing", 0)),
                )
            )
    low.sort(key=lambda item: item[1])
    return low


__all__ = ["_low_subjective_dimensions", "_scorecard_subjective"]
