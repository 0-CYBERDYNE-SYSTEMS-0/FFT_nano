"""Dimension and overall scoring aggregation helpers."""

from __future__ import annotations

from dataclasses import dataclass

from desloppify.engine._scoring.detection import detector_stats_by_mode
from desloppify.engine._scoring.policy.core import (
    DIMENSIONS,
    FAILURE_STATUSES_BY_MODE,
    SCORING_MODES,
    ScoreMode,
)
from desloppify.engine._scoring.results.health import (
    compute_health_breakdown,
    compute_health_score,
)
from desloppify.engine._scoring.results.impact import (
    compute_score_impact,
    get_dimension_for_detector,
)
from desloppify.engine._scoring.subjective.core import (
    append_subjective_dimensions,
)


@dataclass(frozen=True)
class ScoreBundle:
    dimension_scores: dict[str, dict]
    strict_dimension_scores: dict[str, dict]
    verified_strict_dimension_scores: dict[str, dict]
    overall_score: float
    objective_score: float
    strict_score: float
    verified_strict_score: float


def compute_dimension_scores_by_mode(
    issues: dict,
    potentials: dict[str, int],
    *,
    subjective_assessments: dict | None = None,
    allowed_subjective_dimensions: set[str] | None = None,
) -> dict[ScoreMode, dict[str, dict]]:
    """Compute dimension scores for lenient/strict/verified_strict in one pass."""
    results: dict[ScoreMode, dict[str, dict]] = {mode: {} for mode in SCORING_MODES}

    for dim in DIMENSIONS:
        totals = {
            mode: {
                "checks": 0,
                "failing": 0,
                "weighted_failures": 0.0,
                "detectors": {},
            }
            for mode in SCORING_MODES
        }

        for detector in dim.detectors:
            potential = potentials.get(detector, 0)
            if potential <= 0:
                continue

            detector_stats = detector_stats_by_mode(detector, issues, potential)
            for mode in SCORING_MODES:
                pass_rate, failing, weighted = detector_stats[mode]
                totals[mode]["checks"] += potential
                totals[mode]["failing"] += failing
                totals[mode]["weighted_failures"] += weighted
                totals[mode]["detectors"][detector] = {
                    "potential": potential,
                    "pass_rate": pass_rate,
                    "failing": failing,
                    "weighted_failures": weighted,
                }

        for mode in SCORING_MODES:
            total_checks = totals[mode]["checks"]
            if total_checks <= 0:
                continue
            dim_score = (
                max(
                    0.0,
                    (total_checks - totals[mode]["weighted_failures"]) / total_checks,
                )
                * 100
            )
            results[mode][dim.name] = {
                "score": round(dim_score, 1),
                "tier": dim.tier,
                "checks": total_checks,
                "failing": totals[mode]["failing"],
                "detectors": totals[mode]["detectors"],
            }

    for mode in SCORING_MODES:
        append_subjective_dimensions(
            results[mode],
            issues,
            subjective_assessments,
            FAILURE_STATUSES_BY_MODE[mode],
            allowed_dimensions=allowed_subjective_dimensions,
        )
    return results


def compute_dimension_scores(
    issues: dict,
    potentials: dict[str, int],
    *,
    strict: bool = False,
    subjective_assessments: dict | None = None,
    allowed_subjective_dimensions: set[str] | None = None,
) -> dict[str, dict]:
    """Compute per-dimension scores from issues and potentials."""
    mode: ScoreMode = "strict" if strict else "lenient"
    return compute_dimension_scores_by_mode(
        issues,
        potentials,
        subjective_assessments=subjective_assessments,
        allowed_subjective_dimensions=allowed_subjective_dimensions,
    )[mode]


def compute_score_bundle(
    issues: dict,
    potentials: dict[str, int],
    *,
    subjective_assessments: dict | None = None,
    allowed_subjective_dimensions: set[str] | None = None,
) -> ScoreBundle:
    """Compute all score channels from one scoring engine pass."""
    by_mode = compute_dimension_scores_by_mode(
        issues,
        potentials,
        subjective_assessments=subjective_assessments,
        allowed_subjective_dimensions=allowed_subjective_dimensions,
    )

    lenient_scores = by_mode["lenient"]
    strict_scores = by_mode["strict"]
    verified_strict_scores = by_mode["verified_strict"]

    mechanical_lenient_scores = {
        name: data
        for name, data in lenient_scores.items()
        if "subjective_assessment" not in data.get("detectors", {})
    }

    return ScoreBundle(
        dimension_scores=lenient_scores,
        strict_dimension_scores=strict_scores,
        verified_strict_dimension_scores=verified_strict_scores,
        overall_score=compute_health_score(lenient_scores),
        objective_score=compute_health_score(mechanical_lenient_scores),
        strict_score=compute_health_score(strict_scores),
        verified_strict_score=compute_health_score(verified_strict_scores),
    )


__all__ = [
    "ScoreBundle",
    "compute_dimension_scores_by_mode",
    "compute_dimension_scores",
    "compute_health_breakdown",
    "compute_health_score",
    "compute_score_bundle",
    "compute_score_impact",
    "get_dimension_for_detector",
]
