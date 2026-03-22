"""Health score aggregation helpers."""

from __future__ import annotations

from typing import TypedDict

from desloppify.base.text_utils import is_numeric
from desloppify.engine._scoring.policy.core import (
    MECHANICAL_DIMENSION_WEIGHTS,
    MECHANICAL_WEIGHT_FRACTION,
    MIN_SAMPLE,
    SUBJECTIVE_DIMENSION_WEIGHTS,
    SUBJECTIVE_WEIGHT_FRACTION,
)


class HealthBreakdownEntry(TypedDict):
    """Per-dimension contribution row used in score transparency output."""

    name: str
    pool: str
    score: float
    checks: float
    sample_factor: float
    configured_weight: float
    effective_weight: float
    pool_share: float
    overall_per_point: float
    overall_contribution: float
    overall_drag: float


class HealthBreakdown(TypedDict):
    """Typed shape returned by ``compute_health_breakdown``."""

    overall_score: float
    mechanical_fraction: float
    subjective_fraction: float
    mechanical_avg: float
    subjective_avg: float | None
    entries: list[HealthBreakdownEntry]


def _normalize_dimension_name(name: str) -> str:
    return " ".join(str(name).strip().lower().split())


def _mechanical_dimension_weight(name: str) -> float:
    return float(
        MECHANICAL_DIMENSION_WEIGHTS.get(
            _normalize_dimension_name(name),
            1.0,
        )
    )


def _subjective_dimension_weight(name: str, data: dict) -> float:
    subjective_meta = (
        data.get("detectors", {}).get("subjective_assessment", {})
        if isinstance(data, dict)
        else {}
    )
    configured = (
        subjective_meta.get("configured_weight")
        if isinstance(subjective_meta, dict)
        else None
    )
    if is_numeric(configured):
        return max(0.0, float(configured))

    return float(
        SUBJECTIVE_DIMENSION_WEIGHTS.get(
            _normalize_dimension_name(name),
            1.0,
        )
    )


def _empty_health_breakdown() -> HealthBreakdown:
    return {
        "overall_score": 100.0,
        "mechanical_fraction": 1.0,
        "subjective_fraction": 0.0,
        "mechanical_avg": 100.0,
        "subjective_avg": None,
        "entries": [],
    }


def _subjective_row(name: str, score: float, configured: float) -> dict[str, float | str]:
    return {
        "name": str(name),
        "score": score,
        "configured_weight": configured,
        "effective_weight": configured,
    }


def _mechanical_row(name: str, score: float, data: dict) -> dict[str, float | str]:
    checks = float(data.get("checks", 0) or 0)
    sample_factor = min(1.0, checks / MIN_SAMPLE) if checks > 0 else 0.0
    configured = max(0.0, _mechanical_dimension_weight(name))
    effective = configured * sample_factor
    return {
        "name": str(name),
        "score": score,
        "checks": checks,
        "sample_factor": sample_factor,
        "configured_weight": configured,
        "effective_weight": effective,
    }


def _categorize_dimension_row(
    name: str,
    data: dict,
    *,
    score_key: str,
) -> tuple[str, dict[str, float | str]]:
    score = float(data.get(score_key, data.get("score", 0.0)))
    if "subjective_assessment" in data.get("detectors", {}):
        configured = max(0.0, _subjective_dimension_weight(name, data))
        return "subjective", _subjective_row(name, score, configured)
    return "mechanical", _mechanical_row(name, score, data)


def _pool_average(weighted_sum: float, total_weight: float, *, empty_default: float | None) -> float | None:
    if total_weight <= 0:
        return empty_default
    return weighted_sum / total_weight


def _pool_fractions(
    mechanical_weight: float,
    subjective_weight: float,
    subjective_avg: float | None,
) -> tuple[float, float]:
    if subjective_avg is None:
        return 1.0, 0.0
    if mechanical_weight == 0:
        return 0.0, 1.0
    return MECHANICAL_WEIGHT_FRACTION, SUBJECTIVE_WEIGHT_FRACTION


def _overall_health_score(
    mechanical_avg: float,
    subjective_avg: float | None,
    *,
    mechanical_fraction: float,
    subjective_fraction: float,
) -> float:
    if subjective_avg is None:
        return round(mechanical_avg, 1)
    if mechanical_fraction == 0.0:
        return round(subjective_avg, 1)
    return round(
        mechanical_avg * mechanical_fraction + subjective_avg * subjective_fraction,
        1,
    )


def _breakdown_entry(
    row: dict[str, float | str],
    *,
    pool: str,
    total_weight: float,
    pool_fraction: float,
) -> HealthBreakdownEntry:
    pool_share = float(row["effective_weight"]) / total_weight if total_weight > 0 else 0.0
    per_point = pool_fraction * pool_share
    score = float(row["score"])
    checks = float(row["checks"]) if "checks" in row else 0.0
    sample_factor = float(row["sample_factor"]) if "sample_factor" in row else 1.0
    return {
        "name": str(row["name"]),
        "pool": pool,
        "score": score,
        "checks": checks,
        "sample_factor": sample_factor,
        "configured_weight": float(row["configured_weight"]),
        "effective_weight": float(row["effective_weight"]),
        "pool_share": pool_share,
        "overall_per_point": per_point,
        "overall_contribution": per_point * score,
        "overall_drag": per_point * (100.0 - score),
    }


def _breakdown_entries(
    mechanical_rows: list[dict[str, float | str]],
    subjective_rows: list[dict[str, float | str]],
    *,
    mechanical_weight: float,
    subjective_weight: float,
    mechanical_fraction: float,
    subjective_fraction: float,
) -> list[HealthBreakdownEntry]:
    entries: list[HealthBreakdownEntry] = []
    for row in mechanical_rows:
        entries.append(
            _breakdown_entry(
                row,
                pool="mechanical",
                total_weight=mechanical_weight,
                pool_fraction=mechanical_fraction,
            )
        )
    for row in subjective_rows:
        entries.append(
            _breakdown_entry(
                row,
                pool="subjective",
                total_weight=subjective_weight,
                pool_fraction=subjective_fraction,
            )
        )
    return entries


def compute_health_breakdown(
    dimension_scores: dict,
    *,
    score_key: str = "score",
) -> HealthBreakdown:
    """Return pool averages and weighted contribution breakdown for score transparency."""
    if not dimension_scores:
        return _empty_health_breakdown()

    mech_sum = 0.0
    mech_weight = 0.0
    subj_sum = 0.0
    subj_weight = 0.0
    mechanical_rows: list[dict[str, float | str]] = []
    subjective_rows: list[dict[str, float | str]] = []

    for name, data in dimension_scores.items():
        pool, row = _categorize_dimension_row(name, data, score_key=score_key)
        score = float(row["score"])
        effective = float(row["effective_weight"])
        if pool == "subjective":
            subj_sum += score * effective
            subj_weight += effective
            subjective_rows.append(row)
            continue

        mech_sum += score * effective
        mech_weight += effective
        mechanical_rows.append(row)

    mech_avg = float(_pool_average(mech_sum, mech_weight, empty_default=100.0))
    subj_avg = _pool_average(subj_sum, subj_weight, empty_default=None)
    mechanical_fraction, subjective_fraction = _pool_fractions(
        mech_weight,
        subj_weight,
        subj_avg,
    )
    overall_score = _overall_health_score(
        mech_avg,
        subj_avg,
        mechanical_fraction=mechanical_fraction,
        subjective_fraction=subjective_fraction,
    )
    entries = _breakdown_entries(
        mechanical_rows,
        subjective_rows,
        mechanical_weight=mech_weight,
        subjective_weight=subj_weight,
        mechanical_fraction=mechanical_fraction,
        subjective_fraction=subjective_fraction,
    )

    return {
        "overall_score": overall_score,
        "mechanical_fraction": mechanical_fraction,
        "subjective_fraction": subjective_fraction,
        "mechanical_avg": mech_avg,
        "subjective_avg": subj_avg,
        "entries": entries,
    }


def compute_health_score(
    dimension_scores: dict,
    *,
    score_key: str = "score",
) -> float:
    """Budget-weighted blend of mechanical and subjective dimension scores."""
    return float(
        compute_health_breakdown(dimension_scores, score_key=score_key)[
            "overall_score"
        ]
    )


__all__ = ["compute_health_breakdown", "compute_health_score"]
