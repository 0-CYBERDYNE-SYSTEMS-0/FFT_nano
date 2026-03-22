"""Dependency architecture evidence clusters."""

from __future__ import annotations

from collections import defaultdict

from .accessors import _get_detail, _get_signals, _safe_num


def _build_boundary_violations(by_detector: dict[str, list[dict]]) -> list[dict]:
    """From coupling and layer_violation detectors."""
    results: list[dict] = []
    for det_name in ("coupling", "layer_violation"):
        for issue in by_detector.get(det_name, []):
            filepath = issue.get("file", "")
            target = _get_detail(issue, "target") or _get_detail(
                issue, "imported_from", ""
            )
            direction = _get_detail(issue, "direction") or _get_detail(
                issue, "violation", ""
            )
            results.append(
                {
                    "file": filepath,
                    "target": target,
                    "direction": direction,
                }
            )
    return results[:30]


def _build_dead_code(by_detector: dict[str, list[dict]]) -> list[dict]:
    """Orphaned files + uncalled functions."""
    results: list[dict] = []
    for issue in by_detector.get("orphaned", []):
        filepath = issue.get("file", "")
        signals = _get_signals(issue)
        loc = _safe_num(signals.get("loc", _get_detail(issue, "loc")))
        results.append({"file": filepath, "kind": "orphaned", "loc": int(loc)})
    for issue in by_detector.get("uncalled_functions", []):
        filepath = issue.get("file", "")
        detail = issue.get("detail", {})
        loc = _safe_num(detail.get("loc", 0)) if isinstance(detail, dict) else 0
        results.append({"file": filepath, "kind": "uncalled", "loc": int(loc)})
    return results[:30]


def _build_private_crossings(by_detector: dict[str, list[dict]]) -> list[dict]:
    """From private_imports detector."""
    results: list[dict] = []
    for issue in by_detector.get("private_imports", []):
        filepath = issue.get("file", "")
        symbol = _get_detail(issue, "symbol") or _get_detail(issue, "name", "")
        source = _get_detail(issue, "source") or _get_detail(
            issue, "imported_from", ""
        )
        target = _get_detail(issue, "target") or filepath
        results.append(
            {
                "file": filepath,
                "symbol": symbol,
                "source": source,
                "target": target,
            }
        )
    return results[:30]


def _build_deferred_import_density(by_file: dict[str, list[dict]]) -> list[dict]:
    """Files with 2+ deferred_import smells (proxy for cycle pressure)."""
    file_counts: dict[str, int] = defaultdict(int)
    for filepath, file_issues in by_file.items():
        for issue in file_issues:
            if issue.get("detector") != "smells":
                continue
            if _get_detail(issue, "smell_id") == "deferred_import":
                file_counts[filepath] += 1

    results = [
        {"file": filepath, "count": count}
        for filepath, count in file_counts.items()
        if count >= 2
    ]
    results.sort(key=lambda e: -e["count"])
    return results[:20]


__all__ = [
    "_build_boundary_violations",
    "_build_dead_code",
    "_build_deferred_import_density",
    "_build_private_crossings",
]
