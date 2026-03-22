"""Organization and layout evidence clusters."""

from __future__ import annotations

from .accessors import _get_detail, _get_signals, _safe_num


def _build_flat_dir_issues(by_detector: dict[str, list[dict]]) -> list[dict]:
    """From flat_dirs detector."""
    results: list[dict] = []
    for issue in by_detector.get("flat_dirs", []):
        filepath = issue.get("file", "")
        kind = _get_detail(issue, "kind") or _get_detail(issue, "reason", "")
        raw_score = _get_detail(issue, "score")
        if raw_score is None:
            raw_score = _get_detail(issue, "combined_score", 0)
        results.append(
            {
                "directory": filepath,
                "kind": kind,
                "file_count": int(_safe_num(_get_detail(issue, "file_count", 0))),
                "combined_score": int(_safe_num(raw_score)),
            }
        )
    results.sort(key=lambda e: -e["combined_score"])
    return results[:20]


def _build_large_file_distribution(by_detector: dict[str, list[dict]]) -> dict | None:
    """Distribution stats from structural issues."""
    locs: list[float] = []
    for issue in by_detector.get("structural", []):
        signals = _get_signals(issue)
        loc = _safe_num(signals.get("loc"))
        if loc > 0:
            locs.append(loc)
    if not locs:
        return None
    locs.sort()
    n = len(locs)
    return {
        "count": n,
        "median_loc": int(locs[n // 2]),
        "p90_loc": int(locs[int(n * 0.9)]) if n >= 10 else int(locs[-1]),
        "p99_loc": int(locs[int(n * 0.99)]) if n >= 100 else int(locs[-1]),
    }


__all__ = ["_build_flat_dir_issues", "_build_large_file_distribution"]
