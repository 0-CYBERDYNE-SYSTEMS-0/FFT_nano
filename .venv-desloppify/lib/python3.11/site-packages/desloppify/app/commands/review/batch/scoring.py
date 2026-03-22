"""Scoring primitives for holistic review batch merges."""

from __future__ import annotations

from dataclasses import dataclass

# Blending ratio between weighted mean and per-batch floor score.
_WEIGHTED_MEAN_BLEND = 0.7
_FLOOR_BLEND_WEIGHT = 0.3

# Bottom percentile of weight used for floor calculation.
_FLOOR_PERCENTILE = 0.1


def _percentile_floor(
    weighted_scores: list[tuple[float, float]],
    fallback: float,
) -> float:
    """Return weighted mean of the bottom ``_FLOOR_PERCENTILE`` of total weight.

    Sorts entries by score ascending and accumulates weight until the
    threshold fraction of total weight is reached.  The result is the
    weighted mean of those bottom entries, so bad code penalises
    proportionally regardless of file boundaries.

    Falls back to ``min()`` when only one entry exists.
    """
    if len(weighted_scores) <= 1:
        return min((s for s, _ in weighted_scores), default=fallback)

    total_weight = sum(w for _, w in weighted_scores)
    if total_weight <= 0:
        return fallback

    threshold = total_weight * _FLOOR_PERCENTILE
    sorted_scores = sorted(weighted_scores, key=lambda t: t[0])

    accumulated_weight = 0.0
    numerator = 0.0
    for score, weight in sorted_scores:
        accumulated_weight += weight
        numerator += score * weight
        if accumulated_weight >= threshold:
            break

    if accumulated_weight <= 0:
        return fallback
    return numerator / accumulated_weight


@dataclass(frozen=True)
class ScoreInputs:
    """Normalized inputs for a single dimension merge computation."""

    weighted_mean: float
    floor: float


@dataclass(frozen=True)
class ScoreBreakdown:
    """Named intermediate values for one merged dimension score."""

    weighted_mean: float
    floor: float
    floor_aware: float
    final_score: float


class DimensionMergeScorer:
    """Compute merged scores for holistic review dimensions."""

    def score_dimension(self, inputs: ScoreInputs) -> ScoreBreakdown:
        """Compute one merged score from the reviewer's numeric assessments."""
        floor_aware = (
            _WEIGHTED_MEAN_BLEND * inputs.weighted_mean
            + _FLOOR_BLEND_WEIGHT * inputs.floor
        )
        final_score = round(max(0.0, min(100.0, floor_aware)), 1)
        return ScoreBreakdown(
            weighted_mean=inputs.weighted_mean,
            floor=inputs.floor,
            floor_aware=floor_aware,
            final_score=final_score,
        )

    def merge_scores(
        self,
        score_buckets: dict[str, list[tuple[float, float]]],
    ) -> dict[str, float]:
        """Compute floor-aware weighted mean for each dimension."""
        merged: dict[str, float] = {}
        for key, weighted_scores in sorted(score_buckets.items()):
            if not weighted_scores:
                continue
            numerator = sum(score * weight for score, weight in weighted_scores)
            denominator = sum(weight for _, weight in weighted_scores)
            weighted_mean = numerator / max(denominator, 1.0)
            floor = _percentile_floor(weighted_scores, fallback=weighted_mean)
            breakdown = self.score_dimension(
                ScoreInputs(
                    weighted_mean=weighted_mean,
                    floor=floor,
                )
            )
            merged[key] = breakdown.final_score
        return merged


__all__ = ["DimensionMergeScorer", "ScoreBreakdown", "ScoreInputs", "_percentile_floor"]
