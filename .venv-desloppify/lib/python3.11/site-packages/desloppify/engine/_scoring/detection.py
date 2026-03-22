"""Per-detector scoring calculations."""

from __future__ import annotations

from dataclasses import dataclass, field

from desloppify.base.scoring_constants import (
    CONFIDENCE_WEIGHTS,
    HOLISTIC_MULTIPLIER,
)
from desloppify.engine._scoring.policy.core import (
    FAILURE_STATUSES_BY_MODE,
    SCORING_MODES,
    ScoreMode,
    detector_policy,
)
from desloppify.engine._state.issue_semantics import is_scoring_excluded_detector
from desloppify.engine._state.schema import Issue

# Tiered file-count cap thresholds for non-LOC file-based detectors.
# Controls how many issues per file contribute to the weighted failure sum.
_FILE_CAP_HIGH_THRESHOLD = 6     # issues in file for high cap
_FILE_CAP_MID_THRESHOLD = 3      # issues in file for mid cap
_FILE_CAP_HIGH = 2.0             # cap value at high concentration
_FILE_CAP_MID = 1.5              # cap value at mid concentration
_FILE_CAP_LOW = 1.0              # cap value at low concentration (1-2 issues)


def merge_potentials(potentials_by_lang: dict[str, dict[str, int]]) -> dict[str, int]:
    """Sum potentials across languages per detector."""
    merged: dict[str, int] = {}
    for lang_potentials in potentials_by_lang.values():
        for detector, count in lang_potentials.items():
            merged[detector] = merged.get(detector, 0) + count
    return merged


def _iter_scoring_candidates(
    detector: str,
    issues: dict[str, Issue],
    excluded_zones: frozenset[str],
):
    """Yield in-scope issues for a detector (zone-filtered)."""
    for issue in issues.values():
        if issue.get("suppressed"):
            continue
        if issue.get("detector") != detector:
            continue
        if issue.get("zone", "production") in excluded_zones:
            continue
        yield issue


def _issue_weight(issue: Issue, *, use_loc_weight: bool) -> float:
    """Compute the scoring weight for a single issue."""
    if use_loc_weight:
        return issue.get("detail", {}).get("loc_weight", 1.0)
    return CONFIDENCE_WEIGHTS.get(issue.get("confidence", "medium"), 0.7)


def _file_count_cap(issues_in_file: int) -> float:
    """Tiered cap for non-LOC file-based detectors.

    Keeps file-count denominator semantics while preserving concentration signal:
    1-2 issues => _FILE_CAP_LOW, 3-5 => _FILE_CAP_MID, 6+ => _FILE_CAP_HIGH.
    """
    if issues_in_file >= _FILE_CAP_HIGH_THRESHOLD:
        return _FILE_CAP_HIGH
    if issues_in_file >= _FILE_CAP_MID_THRESHOLD:
        return _FILE_CAP_MID
    return _FILE_CAP_LOW


@dataclass
class _ModeAccum:
    """Per-mode accumulator for file-based detector scoring."""

    by_file: dict[str, float] = field(default_factory=dict)
    by_file_count: dict[str, int] = field(default_factory=dict)
    file_cap: dict[str, float] = field(default_factory=dict)
    holistic_sum: float = 0.0
    issue_count: int = 0


def _file_based_failures_by_mode(
    detector: str,
    issues: dict[str, Issue],
    policy,
) -> dict[ScoreMode, tuple[int, float]]:
    """Accumulate weighted failures by score mode for file-based detectors."""
    accum: dict[ScoreMode, _ModeAccum] = {mode: _ModeAccum() for mode in SCORING_MODES}

    for issue in _iter_scoring_candidates(detector, issues, policy.excluded_zones):
        status = issue.get("status", "open")
        holistic = issue.get("file") == "." and issue.get("detail", {}).get(
            "holistic"
        )

        for mode in SCORING_MODES:
            if status not in FAILURE_STATUSES_BY_MODE[mode]:
                continue

            if holistic:
                accum[mode].holistic_sum += (
                    _issue_weight(issue, use_loc_weight=False) * HOLISTIC_MULTIPLIER
                )
                accum[mode].issue_count += 1
                continue

            weight = _issue_weight(issue, use_loc_weight=policy.use_loc_weight)
            file_key = issue.get("file", "")
            a = accum[mode]
            a.by_file[file_key] = a.by_file.get(file_key, 0.0) + weight
            a.by_file_count[file_key] = a.by_file_count.get(file_key, 0) + 1
            if policy.use_loc_weight and file_key not in a.file_cap:
                a.file_cap[file_key] = weight
            a.issue_count += 1

    out: dict[ScoreMode, tuple[int, float]] = {}
    for mode in SCORING_MODES:
        a = accum[mode]
        if policy.use_loc_weight:
            weighted = sum(
                min(weighted_sum, a.file_cap.get(file_key, weighted_sum))
                for file_key, weighted_sum in a.by_file.items()
            )
        else:
            weighted = sum(
                min(weighted_sum, _file_count_cap(a.by_file_count.get(file_key, 0)))
                for file_key, weighted_sum in a.by_file.items()
            )
        out[mode] = (a.issue_count, weighted + a.holistic_sum)
    return out


def detector_stats_by_mode(
    detector: str,
    issues: dict[str, Issue],
    potential: int,
) -> dict[ScoreMode, tuple[float, int, float]]:
    """Compute (pass_rate, issue_count, weighted_failures) for each score mode."""
    if potential <= 0:
        return {mode: (1.0, 0, 0.0) for mode in SCORING_MODES}

    # Some detectors remain queue-visible but are intentionally excluded from
    # detector-side scoring.
    if is_scoring_excluded_detector(detector):
        return {mode: (1.0, 0, 0.0) for mode in SCORING_MODES}

    policy = detector_policy(detector)

    if policy.file_based:
        mode_failures = _file_based_failures_by_mode(detector, issues, policy)
    else:
        issue_count: dict[ScoreMode, int] = {mode: 0 for mode in SCORING_MODES}
        weighted_failures: dict[ScoreMode, float] = {
            mode: 0.0 for mode in SCORING_MODES
        }

        for issue in _iter_scoring_candidates(
            detector, issues, policy.excluded_zones
        ):
            status = issue.get("status", "open")
            weight = _issue_weight(issue, use_loc_weight=False)
            for mode in SCORING_MODES:
                if status not in FAILURE_STATUSES_BY_MODE[mode]:
                    continue
                issue_count[mode] += 1
                weighted_failures[mode] += weight

        mode_failures = {
            mode: (issue_count[mode], weighted_failures[mode]) for mode in SCORING_MODES
        }

    out: dict[ScoreMode, tuple[float, int, float]] = {}
    for mode in SCORING_MODES:
        issues, weighted = mode_failures[mode]
        pass_rate = max(0.0, (potential - weighted) / potential)
        out[mode] = (pass_rate, issues, weighted)
    return out


def detector_pass_rate(
    detector: str,
    issues: dict[str, Issue],
    potential: int,
    *,
    strict: bool = False,
) -> tuple[float, int, float]:
    """Pass rate for one detector.

    Returns (pass_rate, issue_count, weighted_failures).
    Zero potential -> (1.0, 0, 0.0).
    """
    mode: ScoreMode = "strict" if strict else "lenient"
    return detector_stats_by_mode(detector, issues, potential)[mode]


__all__ = [
    "detector_pass_rate",
    "detector_stats_by_mode",
    "merge_potentials",
]
