"""Issue noise budget parsing and filtering."""

from __future__ import annotations

__all__ = [
    "DEFAULT_ISSUE_NOISE_BUDGET",
    "DEFAULT_ISSUE_NOISE_GLOBAL_BUDGET",
    "resolve_issue_noise_budget",
    "resolve_issue_noise_global_budget",
    "resolve_issue_noise_settings",
    "apply_issue_noise_budget",
]

DEFAULT_ISSUE_NOISE_BUDGET = 10
DEFAULT_ISSUE_NOISE_GLOBAL_BUDGET = 0
_CONFIDENCE_ORDER = {"high": 0, "medium": 1, "low": 2}


def _resolve_non_negative_int(raw_value: object, default: int) -> tuple[int, bool]:
    """Parse a non-negative integer with fallback. Returns (value, was_valid)."""
    try:
        value = int(raw_value)
    except (TypeError, ValueError):
        return default, False
    if value < 0:
        return 0, False
    return value, True


def resolve_issue_noise_budget(
    config: dict | None, *, default: int = DEFAULT_ISSUE_NOISE_BUDGET
) -> int:
    """Resolve per-detector noise budget from config with safe fallback."""
    if not config:
        return default
    budget, _valid = _resolve_non_negative_int(
        config.get("issue_noise_budget", default), default
    )
    return budget


def resolve_issue_noise_global_budget(
    config: dict | None, *, default: int = DEFAULT_ISSUE_NOISE_GLOBAL_BUDGET
) -> int:
    """Resolve global noise budget from config with safe fallback."""
    if not config:
        return default
    budget, _valid = _resolve_non_negative_int(
        config.get("issue_noise_global_budget", default),
        default,
    )
    return budget


def resolve_issue_noise_settings(
    config: dict | None,
    *,
    per_default: int = DEFAULT_ISSUE_NOISE_BUDGET,
    global_default: int = DEFAULT_ISSUE_NOISE_GLOBAL_BUDGET,
) -> tuple[int, int, str | None]:
    """Resolve per-detector/global budgets and return an optional warning."""
    if not config:
        return per_default, global_default, None

    per_value = config.get("issue_noise_budget", per_default)
    global_value = config.get("issue_noise_global_budget", global_default)
    per_budget, per_valid = _resolve_non_negative_int(per_value, per_default)
    global_budget, global_valid = _resolve_non_negative_int(
        global_value, global_default
    )

    warning_parts: list[str] = []
    if not per_valid:
        warning_parts.append(
            f"Invalid config `issue_noise_budget={per_value!r}`; using {per_budget}"
        )
    if not global_valid:
        warning_parts.append(
            f"Invalid config `issue_noise_global_budget={global_value!r}`; using {global_budget}"
        )
    warning = " | ".join(warning_parts) if warning_parts else None
    return per_budget, global_budget, warning


def _issue_priority_key(issue: dict) -> tuple[int, int, str]:
    """Sort by actionable priority (tier/confidence/id)."""
    return (
        issue.get("tier", 3),
        _CONFIDENCE_ORDER.get(issue.get("confidence", "low"), 9),
        issue.get("id", ""),
    )


def _issue_display_key(issue: dict) -> tuple[str, int, int, str]:
    """Sort by file/tier/confidence/id for deterministic display order."""
    return (
        issue.get("file", ""),
        issue.get("tier", 3),
        _CONFIDENCE_ORDER.get(issue.get("confidence", "low"), 9),
        issue.get("id", ""),
    )


def _group_issues_by_detector(issues: list[dict]) -> dict[str, list[dict]]:
    grouped: dict[str, list[dict]] = {}
    for issue in issues:
        detector = issue.get("detector", "unknown")
        grouped.setdefault(detector, []).append(issue)
    return grouped


def _cap_detector_groups(
    grouped: dict[str, list[dict]], budget: int
) -> tuple[dict[str, list[dict]], dict[str, int]]:
    capped_by_detector: dict[str, list[dict]] = {}
    hidden_by_detector: dict[str, int] = {}

    for detector, detector_issues in grouped.items():
        detector_issues.sort(key=_issue_priority_key)
        capped = detector_issues if budget <= 0 else detector_issues[:budget]
        capped_by_detector[detector] = list(capped)
        hidden_count = max(0, len(detector_issues) - len(capped))
        if hidden_count:
            hidden_by_detector[detector] = hidden_count

    return capped_by_detector, hidden_by_detector


def _round_robin_global_budget(
    capped_by_detector: dict[str, list[dict]], global_budget: int
) -> tuple[list[dict], dict[str, int]]:
    surfaced: list[dict] = []
    hidden_after_global: dict[str, int] = {}

    detector_order = sorted(
        capped_by_detector.keys(),
        key=lambda detector: (
            _issue_priority_key(capped_by_detector[detector][0])
            if capped_by_detector[detector]
            else (9, 9, ""),
            detector,
        ),
    )
    consumed: dict[str, int] = {detector: 0 for detector in detector_order}

    while len(surfaced) < global_budget:
        progressed = False
        for detector in detector_order:
            idx = consumed[detector]
            detector_items = capped_by_detector[detector]
            if idx >= len(detector_items):
                continue
            surfaced.append(detector_items[idx])
            consumed[detector] = idx + 1
            progressed = True
            if len(surfaced) >= global_budget:
                break
        if not progressed:
            break

    for detector, detector_items in capped_by_detector.items():
        dropped = len(detector_items) - consumed.get(detector, 0)
        if dropped > 0:
            hidden_after_global[detector] = dropped

    return surfaced, hidden_after_global


def _sort_hidden_counts(hidden_by_detector: dict[str, int]) -> dict[str, int]:
    return dict(
        sorted(hidden_by_detector.items(), key=lambda item: (-item[1], item[0]))
    )


def apply_issue_noise_budget(
    issues: list[dict],
    budget: int = DEFAULT_ISSUE_NOISE_BUDGET,
    global_budget: int = DEFAULT_ISSUE_NOISE_GLOBAL_BUDGET,
) -> tuple[list[dict], dict[str, int]]:
    """Cap surfaced issues per detector and return hidden counts."""
    if budget <= 0 and global_budget <= 0:
        return list(issues), {}

    grouped = _group_issues_by_detector(issues)
    capped_by_detector, hidden_by_detector = _cap_detector_groups(grouped, budget)

    if global_budget > 0:
        surfaced, hidden_after_global = _round_robin_global_budget(
            capped_by_detector,
            global_budget,
        )
        for detector, count in hidden_after_global.items():
            hidden_by_detector[detector] = hidden_by_detector.get(detector, 0) + count
    else:
        surfaced = [item for items in capped_by_detector.values() for item in items]

    surfaced.sort(key=_issue_display_key)
    return surfaced, _sort_hidden_counts(hidden_by_detector)
