"""Complexity-focused mechanical evidence clusters."""

from __future__ import annotations

from typing import Any

from .accessors import _get_detail, _get_signals, _safe_num


def _build_complexity_hotspots(
    by_detector: dict[str, list[dict]],
    by_file: dict[str, list[dict]],
) -> list[dict]:
    """Top 20 files by composite complexity score."""
    del by_file
    file_data: dict[str, dict[str, Any]] = {}

    for issue in by_detector.get("structural", []):
        filepath = issue.get("file", "")
        if not filepath:
            continue
        signals = _get_signals(issue)
        entry = file_data.setdefault(
            filepath,
            {
                "file": filepath,
                "loc": 0,
                "complexity_score": 0,
                "signals": [],
                "component_count": 0,
                "function_count": 0,
                "monster_functions": 0,
                "cyclomatic_hotspots": 0,
            },
        )
        entry["loc"] = max(entry["loc"], _safe_num(signals.get("loc")))
        entry["function_count"] = max(
            entry["function_count"], _safe_num(signals.get("function_count"))
        )
        entry["component_count"] = max(
            entry["component_count"], _safe_num(signals.get("component_count"))
        )

        max_params = _safe_num(signals.get("max_params"))
        if max_params >= 5:
            entry["signals"].append(f"{int(max_params)} params")
        max_nesting = _safe_num(signals.get("max_nesting"))
        if max_nesting >= 4:
            entry["signals"].append(f"nesting depth {int(max_nesting)}")
        complexity = _safe_num(signals.get("complexity_score"))
        entry["complexity_score"] = max(entry["complexity_score"], complexity)

    for issue in by_detector.get("smells", []):
        filepath = issue.get("file", "")
        smell_id = _get_detail(issue, "smell_id", "")
        if filepath in file_data:
            if smell_id == "monster_function":
                file_data[filepath]["monster_functions"] += 1
            elif smell_id in ("cyclomatic_complexity", "high_cyclomatic"):
                file_data[filepath]["cyclomatic_hotspots"] += 1

    for issue in by_detector.get("responsibility_cohesion", []):
        filepath = issue.get("file", "")
        if filepath in file_data:
            clusters = _safe_num(_get_detail(issue, "cluster_count"))
            file_data[filepath]["component_count"] = max(
                file_data[filepath]["component_count"], clusters
            )

    for entry in file_data.values():
        entry["_score"] = (
            entry["loc"] / 100
            + entry["complexity_score"]
            + entry["component_count"] * 3
            + entry["monster_functions"] * 10
        )
        entry["signals"] = list(dict.fromkeys(entry["signals"]))

    ranked = sorted(file_data.values(), key=lambda e: -e["_score"])[:20]
    for entry in ranked:
        del entry["_score"]
    return ranked


__all__ = ["_build_complexity_hotspots"]
