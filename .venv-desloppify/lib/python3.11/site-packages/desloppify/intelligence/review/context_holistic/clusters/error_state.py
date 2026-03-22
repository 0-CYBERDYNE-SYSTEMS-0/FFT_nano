"""Error and mutable-state evidence clusters."""

from __future__ import annotations

from collections import defaultdict

from .accessors import _get_detail, _safe_num


def _build_error_hotspots(by_detector: dict[str, list[dict]]) -> list[dict]:
    """Files with 3+ exception handling issues from smells detector."""
    error_smell_ids = frozenset(
        {
            "broad_except",
            "silent_except",
            "empty_except",
            "swallowed_error",
            "bare_except",
        }
    )
    file_counts: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))

    for issue in by_detector.get("smells", []):
        smell_id = _get_detail(issue, "smell_id", "")
        if smell_id not in error_smell_ids:
            continue
        filepath = issue.get("file", "")
        if filepath:
            file_counts[filepath][smell_id] += 1

    results = []
    for filepath, counts in file_counts.items():
        total = sum(counts.values())
        if total < 3:
            continue
        entry = {"file": filepath, "total": total}
        for sid in sorted(error_smell_ids):
            entry[sid] = counts.get(sid, 0)
        results.append(entry)
    results.sort(key=lambda e: -e["total"])
    return results[:20]


def _build_mutable_globals(by_detector: dict[str, list[dict]]) -> list[dict]:
    """All global_mutable_config issues."""
    results: list[dict] = []
    file_data: dict[str, dict] = {}

    for issue in by_detector.get("global_mutable_config", []):
        filepath = issue.get("file", "")
        if not filepath:
            continue
        entry = file_data.setdefault(
            filepath,
            {
                "file": filepath,
                "names": [],
                "total_mutations": 0,
            },
        )
        name = _get_detail(issue, "name", "")
        if name and name not in entry["names"]:
            entry["names"].append(name)
        mutations = _safe_num(_get_detail(issue, "mutations"))
        entry["total_mutations"] += int(mutations) if mutations else 1

    results = sorted(file_data.values(), key=lambda e: -e["total_mutations"])
    return results[:20]


__all__ = ["_build_error_hotspots", "_build_mutable_globals"]
