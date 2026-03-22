"""Stale-wontfix scan augmentation helpers."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from desloppify import state as state_mod
from desloppify.base.discovery.file_paths import resolve_path

_STRUCTURAL_COMPLEXITY_GROWTH_THRESHOLD = 10
_STRUCTURAL_LOC_GROWTH_THRESHOLD = 50


def _in_scan_scope(filepath: str, scan_path: Path, *, project_root: Path) -> bool:
    if scan_path.resolve() == project_root.resolve():
        return True
    full = Path(resolve_path(filepath))
    root = scan_path.resolve()
    return full == root or root in full.parents


def _to_float(value: object) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int | float):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            return None
    return None


def _structural_growth_details(
    snapshot: dict[str, Any],
    current: dict[str, Any],
) -> dict[str, dict[str, float]]:
    """Return structural drift details for wontfix issues."""
    snapshot_detail = (
        snapshot.get("detail", {}) if isinstance(snapshot.get("detail"), dict) else {}
    )
    current_detail = (
        current.get("detail", {}) if isinstance(current.get("detail"), dict) else {}
    )
    drift: dict[str, dict[str, float]] = {}

    old_complexity = _to_float(snapshot_detail.get("complexity_score"))
    new_complexity = _to_float(current_detail.get("complexity_score"))
    if (
        old_complexity is not None
        and new_complexity is not None
        and new_complexity >= old_complexity + _STRUCTURAL_COMPLEXITY_GROWTH_THRESHOLD
    ):
        drift["complexity_score"] = {"from": old_complexity, "to": new_complexity}

    old_loc = _to_float(snapshot_detail.get("loc"))
    new_loc = _to_float(current_detail.get("loc"))
    if (
        old_loc is not None
        and new_loc is not None
        and new_loc >= old_loc + _STRUCTURAL_LOC_GROWTH_THRESHOLD
    ):
        drift["loc"] = {"from": old_loc, "to": new_loc}

    return drift


def _wontfix_staleness_reasons(
    previous: dict[str, Any],
    current: dict[str, Any],
    *,
    since_scan: int,
    decay_scans: int,
) -> tuple[list[str], dict[str, dict[str, float]]]:
    """Determine why a wontfix issue is stale and compute structural drift."""
    reasons: list[str] = []
    if decay_scans > 0 and since_scan >= decay_scans:
        reasons.append("scan_decay")

    drift: dict[str, dict[str, float]] = {}
    if previous.get("detector") == "structural":
        snapshot = previous.get("wontfix_snapshot")
        if isinstance(snapshot, dict):
            drift = _structural_growth_details(snapshot, current)
            if drift:
                reasons.append("severity_drift")

    return reasons, drift


def _format_drift_summary(drift: dict[str, dict[str, float]]) -> str:
    """Format structural drift metrics into a human-readable suffix."""
    parts = []
    if "complexity_score" in drift:
        comp = drift["complexity_score"]
        parts.append(f"complexity {comp['from']:.0f}->{comp['to']:.0f}")
    if "loc" in drift:
        loc = drift["loc"]
        parts.append(f"loc {loc['from']:.0f}->{loc['to']:.0f}")
    return f"; drift: {', '.join(parts)}" if parts else ""


def _build_stale_wontfix_issue(
    issue_id: str,
    previous: dict[str, Any],
    *,
    reasons: list[str],
    drift: dict[str, dict[str, float]],
    since_scan: int,
) -> dict[str, Any]:
    """Construct a stale_wontfix issue from staleness metadata."""
    tier = 4 if "severity_drift" in reasons else 3
    confidence = "high" if "severity_drift" in reasons else "medium"
    reason_text = " + ".join(reasons)
    summary = (
        f"Stale wontfix ({reason_text}): re-triage `{issue_id}` "
        f"(last reviewed {since_scan} scans ago)"
    )
    summary += _format_drift_summary(drift)

    return state_mod.make_issue(
        "stale_wontfix",
        previous.get("file", ""),
        issue_id,
        tier=tier,
        confidence=confidence,
        summary=summary,
        detail={
            "subtype": "stale_wontfix",
            "original_issue_id": issue_id,
            "original_detector": previous.get("detector"),
            "reasons": reasons,
            "scans_since_wontfix": since_scan,
            "drift": drift,
        },
    )


def augment_with_stale_wontfix_issues(
    issues: list[dict[str, Any]],
    *,
    state: state_mod.StateModel,
    scan_path: Path,
    project_root: Path,
    decay_scans: int,
) -> tuple[list[dict[str, Any]], int]:
    """Append re-triage issues for stale or worsening wontfix debt."""
    existing = (state.get("work_items") or state.get("issues", {}))
    if not isinstance(existing, dict):
        return issues, 0

    current_by_id = {
        issue.get("id"): issue
        for issue in issues
        if issue.get("id")
    }
    augmented = list(issues)
    monitored = 0

    for issue_id, previous in existing.items():
        if not isinstance(previous, dict):
            continue
        if previous.get("status") != "wontfix":
            continue
        if issue_id not in current_by_id:
            continue
        if not _in_scan_scope(
            str(previous.get("file", "")),
            scan_path,
            project_root=project_root,
        ):
            continue

        monitored += 1
        scan_count = int(state.get("scan_count", 0) or 0)
        since_scan = scan_count - int(previous.get("wontfix_scan_count", scan_count) or 0)
        since_scan = max(since_scan, 0)

        reasons, drift = _wontfix_staleness_reasons(
            previous,
            current_by_id[issue_id],
            since_scan=since_scan,
            decay_scans=decay_scans,
        )
        if not reasons:
            continue

        augmented.append(
            _build_stale_wontfix_issue(
                issue_id,
                previous,
                reasons=reasons,
                drift=drift,
                since_scan=since_scan,
            )
        )

    return augmented, monitored


__all__ = ["augment_with_stale_wontfix_issues"]
