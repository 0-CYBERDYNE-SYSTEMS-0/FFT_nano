"""Subjective-integrity helpers used by state-scoring integration."""

from __future__ import annotations

from copy import deepcopy

from desloppify.engine._scoring.policy.core import matches_target_score

_SUBJECTIVE_TARGET_RESET_THRESHOLD = 2


def _coerce_subjective_score(value: dict | float | int | str | None) -> float:
    """Normalize a subjective assessment score payload to a 0-100 float."""
    raw = value.get("score", 0) if isinstance(value, dict) else value
    try:
        score = float(raw)
    except (TypeError, ValueError):
        score = 0.0
    return max(0.0, min(100.0, score))


def _subjective_target_matches(
    subjective_assessments: dict, *, target: float
) -> list[str]:
    """Return dimension keys whose subjective score matches the target band."""
    matches = [
        dimension
        for dimension, payload in subjective_assessments.items()
        if matches_target_score(_coerce_subjective_score(payload), target)
    ]
    return sorted(matches)


def _subjective_integrity_baseline(target: float | None) -> dict[str, object]:
    """Create baseline subjective-integrity metadata for scan/reporting output."""
    return {
        "status": "disabled" if target is None else "pass",
        "target_score": None if target is None else round(float(target), 2),
        "matched_count": 0,
        "matched_dimensions": [],
        "reset_dimensions": [],
    }


def _apply_subjective_integrity_policy(
    subjective_assessments: dict,
    *,
    target: float,
) -> tuple[dict, dict[str, object]]:
    """Apply anti-gaming penalties for subjective scores clustered on the target."""
    normalized_target = max(0.0, min(100.0, float(target)))
    matched_dimensions = _subjective_target_matches(
        subjective_assessments,
        target=normalized_target,
    )
    meta = _subjective_integrity_baseline(normalized_target)
    meta["matched_count"] = len(matched_dimensions)
    meta["matched_dimensions"] = matched_dimensions

    if len(matched_dimensions) < _SUBJECTIVE_TARGET_RESET_THRESHOLD:
        meta["status"] = "warn" if matched_dimensions else "pass"
        return subjective_assessments, meta

    adjusted = deepcopy(subjective_assessments)
    for dimension in matched_dimensions:
        payload = adjusted.get(dimension)
        if isinstance(payload, dict):
            payload["score"] = 0.0
            payload["integrity_penalty"] = "target_match_reset"
        else:
            adjusted[dimension] = {
                "score": 0.0,
                "integrity_penalty": "target_match_reset",
            }

    meta["status"] = "penalized"
    meta["reset_dimensions"] = matched_dimensions
    return adjusted, meta


def _normalize_integrity_target(
    subjective_integrity_target: float | None,
) -> float | None:
    """Normalize and clamp a subjective integrity target to [0, 100]."""
    if isinstance(subjective_integrity_target, int | float):
        return max(0.0, min(100.0, float(subjective_integrity_target)))
    return None


__all__ = [
    "_apply_subjective_integrity_policy",
    "_normalize_integrity_target",
    "_subjective_integrity_baseline",
]
