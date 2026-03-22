"""Security and cross-cutting evidence clusters."""

from __future__ import annotations

from collections import Counter, defaultdict


def _build_security_hotspots(by_detector: dict[str, list[dict]]) -> list[dict]:
    """Files with 3+ security issues grouped by severity."""
    file_counts: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for issue in by_detector.get("security", []):
        filepath = issue.get("file", "")
        if not filepath:
            continue
        detail = issue.get("detail", {})
        severity = detail.get("severity", "medium") if isinstance(detail, dict) else "medium"
        file_counts[filepath][severity] += 1

    results = []
    for filepath, counts in file_counts.items():
        total = sum(counts.values())
        if total < 3:
            continue
        results.append(
            {
                "file": filepath,
                "high_severity": counts.get("high", 0),
                "medium_severity": counts.get("medium", 0),
                "total": total,
            }
        )
    results.sort(key=lambda e: (-e["high_severity"], -e["total"]))
    return results[:20]


def _build_signal_density(by_file: dict[str, list[dict]]) -> list[dict]:
    """Top 20 files by number of distinct detectors firing."""
    results: list[dict] = []
    for filepath, file_issues in by_file.items():
        detectors = set()
        for issue in file_issues:
            det = issue.get("detector", "")
            if det:
                detectors.add(det)
        if len(detectors) >= 2:
            results.append(
                {
                    "file": filepath,
                    "detector_count": len(detectors),
                    "issue_count": len(file_issues),
                    "detectors": sorted(detectors),
                }
            )
    results.sort(key=lambda e: (-e["detector_count"], -e["issue_count"]))
    return results[:20]


def _build_systemic_patterns(
    smell_counter: Counter[str],
    smell_files: dict[str, list[str]],
) -> list[dict]:
    """Smell subtypes appearing in 5+ files."""
    results: list[dict] = []
    for smell_id, _count in smell_counter.most_common():
        unique_files = sorted(set(smell_files.get(smell_id, [])))
        if len(unique_files) < 5:
            continue
        file_counts = Counter(smell_files[smell_id])
        hotspots = [f"{f} ({c})" for f, c in file_counts.most_common(5)]
        results.append(
            {
                "pattern": smell_id,
                "file_count": len(unique_files),
                "hotspots": hotspots,
            }
        )
    return results[:20]


__all__ = ["_build_security_hotspots", "_build_signal_density", "_build_systemic_patterns"]
