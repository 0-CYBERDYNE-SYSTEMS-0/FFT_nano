"""Scan coverage projection helpers for state-integrated scoring."""

from __future__ import annotations

from desloppify.base.coercions import coerce_confidence
from desloppify.engine._state.schema import StateModel
from desloppify.languages.framework import ScanCoverageRecord


def _active_scan_coverage(state: StateModel) -> ScanCoverageRecord:
    scan_coverage = state.get("scan_coverage", {})
    if not isinstance(scan_coverage, dict) or not scan_coverage:
        return {}

    lang_name = state.get("lang")
    if isinstance(lang_name, str) and lang_name:
        payload = scan_coverage.get(lang_name, {})
        return payload if isinstance(payload, dict) else {}

    if len(scan_coverage) == 1:
        only = next(iter(scan_coverage.values()))
        return only if isinstance(only, dict) else {}
    return {}


def _full_score_confidence_payload() -> dict[str, object]:
    """Return a score_confidence dict indicating full (unreduced) coverage."""
    return {
        "status": "full",
        "confidence": 1.0,
        "detectors": [],
        "dimensions": [],
    }


def _collect_reduced_detectors(
    detectors_payload: dict,
) -> dict[str, dict[str, object]]:
    """Filter detectors_payload to those with reduced status or sub-1.0 confidence."""
    reduced: dict[str, dict[str, object]] = {}
    for detector, raw in detectors_payload.items():
        if not isinstance(raw, dict):
            continue
        status = str(raw.get("status", "full")).lower()
        confidence = coerce_confidence(raw.get("confidence"), default=1.0)
        if status != "reduced" and confidence >= 1.0:
            continue
        reduced[str(detector)] = dict(raw)
    return reduced


def _score_confidence_detector_entry(
    detector: str, payload: dict[str, object]
) -> dict[str, object]:
    """Build a single score_confidence detector entry from a reduced-detector payload."""
    return {
        "detector": detector,
        "status": str(payload.get("status", "reduced")),
        "confidence": round(
            coerce_confidence(payload.get("confidence"), default=1.0),
            2,
        ),
        "summary": str(payload.get("summary", "") or ""),
        "impact": str(payload.get("impact", "") or ""),
        "remediation": str(payload.get("remediation", "") or ""),
        "tool": str(payload.get("tool", "") or ""),
        "reason": str(payload.get("reason", "") or ""),
    }


def apply_scan_coverage_to_dimension_scores(
    state: StateModel,
    *,
    dimension_scores: dict[str, dict],
) -> None:
    coverage_payload = _active_scan_coverage(state)
    detectors_payload = coverage_payload.get("detectors", {})
    if not isinstance(detectors_payload, dict):
        state["score_confidence"] = _full_score_confidence_payload()
        return

    reduced_detectors = _collect_reduced_detectors(detectors_payload)

    score_confidence_detectors = [
        _score_confidence_detector_entry(det, payload)
        for det, payload in reduced_detectors.items()
    ]

    reduced_dimensions: list[str] = []
    for dim_name, dim_data in dimension_scores.items():
        if not isinstance(dim_data, dict):
            continue
        detectors = dim_data.get("detectors", {})
        if not isinstance(detectors, dict):
            continue

        impacts: list[dict[str, object]] = []
        for detector_name, detector_meta in detectors.items():
            reduced = reduced_detectors.get(str(detector_name))
            if not isinstance(detector_meta, dict):
                continue
            if reduced is None:
                detector_meta.pop("coverage_status", None)
                detector_meta.pop("coverage_confidence", None)
                detector_meta.pop("coverage_summary", None)
                continue
            confidence = coerce_confidence(reduced.get("confidence"), default=1.0)
            status = str(reduced.get("status", "reduced"))
            summary = str(reduced.get("summary", "") or "")
            detector_meta["coverage_status"] = status
            detector_meta["coverage_confidence"] = round(confidence, 2)
            detector_meta["coverage_summary"] = summary
            impacts.append(
                {
                    "detector": str(detector_name),
                    "status": status,
                    "confidence": round(confidence, 2),
                    "summary": summary,
                }
            )

        if not impacts:
            dim_data.pop("coverage_status", None)
            dim_data.pop("coverage_confidence", None)
            dim_data.pop("coverage_impacts", None)
            continue

        reduced_dimensions.append(str(dim_name))
        dim_data["coverage_status"] = "reduced"
        dim_data["coverage_confidence"] = round(
            min(
                coerce_confidence(item.get("confidence"), default=1.0)
                for item in impacts
            ),
            2,
        )
        dim_data["coverage_impacts"] = impacts

    if not score_confidence_detectors:
        state["score_confidence"] = _full_score_confidence_payload()
        return

    state["score_confidence"] = {
        "status": "reduced",
        "confidence": round(
            min(
                coerce_confidence(item.get("confidence"), default=1.0)
                for item in score_confidence_detectors
            ),
            2,
        ),
        "detectors": score_confidence_detectors,
        "dimensions": sorted(set(reduced_dimensions)),
    }


__all__ = ["apply_scan_coverage_to_dimension_scores"]
