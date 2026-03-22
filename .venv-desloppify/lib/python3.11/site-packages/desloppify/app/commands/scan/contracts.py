"""Typed boundary contracts for scan workflow and scan query payloads."""

from __future__ import annotations

from typing import Any, TypedDict

from desloppify.languages.framework import DetectorCoverageRecord, ScanCoverageRecord


class ScanQueuePayload(TypedDict, total=False):
    """Query payload for queue-style scan follow-up output."""

    hidden_by_detector: dict[str, int]
    hidden_total: int


class ScanQueryPayload(TypedDict, total=False):
    """Persisted scan query payload written to query.json."""

    command: str
    overall_score: float | None
    objective_score: float | None
    strict_score: float | None
    verified_strict_score: float | None
    prev_overall_score: float | None
    prev_objective_score: float | None
    prev_strict_score: float | None
    prev_verified_strict_score: float | None
    profile: str
    noise_budget: int
    noise_global_budget: int
    hidden_by_detector: dict[str, int]
    hidden_total: int
    diff: dict[str, object]
    stats: dict[str, object]
    open_scope: dict[str, int] | None
    warnings: list[str]
    dimension_scores: dict[str, object] | None
    score_breakdown: dict[str, object] | None
    subjective_integrity: dict[str, object] | None
    score_confidence: dict[str, object] | None
    potentials: dict[str, object] | None
    scan_coverage: dict[str, ScanCoverageRecord] | None
    zone_distribution: dict[str, int] | None
    narrative: dict[str, object]
    config: dict[str, Any]


__all__ = [
    "DetectorCoverageRecord",
    "ScanCoverageRecord",
    "ScanQueryPayload",
]
