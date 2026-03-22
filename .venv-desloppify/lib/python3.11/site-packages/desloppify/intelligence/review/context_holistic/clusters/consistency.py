"""Consistency and duplication evidence clusters."""

from __future__ import annotations


def _build_duplicate_clusters(by_detector: dict[str, list[dict]]) -> list[dict]:
    """From dupes and boilerplate_duplication detectors."""
    results: list[dict] = []
    for det_name in ("dupes", "boilerplate_duplication"):
        for issue in by_detector.get(det_name, []):
            detail = issue.get("detail", {})
            if not isinstance(detail, dict):
                detail = {}
            detail.setdefault("kind", det_name)
            detail.setdefault("name", "")
            detail.setdefault("function", "")
            detail.setdefault("files", [])
            kind = detail.get("kind", det_name)
            name = detail.get(
                "name", detail.get("function", issue.get("summary", "")[:60])
            )
            files = detail.get("files", [])
            if not isinstance(files, list) or not files:
                fallback = issue.get("file", "")
                files = [fallback] if fallback else []
            results.append(
                {
                    "kind": kind,
                    "cluster_size": len(files) if files else 1,
                    "name": name,
                    "files": files[:10],
                }
            )
    return results[:20]


def _build_naming_drift(by_detector: dict[str, list[dict]]) -> list[dict]:
    """From naming detector."""
    dir_data: dict[str, dict] = {}
    for issue in by_detector.get("naming", []):
        filepath = issue.get("file", "")
        detail = issue.get("detail", {})
        if not isinstance(detail, dict):
            detail = {}
        detail.setdefault("expected_convention", "")
        parts = filepath.rsplit("/", 1)
        directory = parts[0] + "/" if len(parts) > 1 else "./"
        entry = dir_data.setdefault(
            directory,
            {
                "directory": directory,
                "majority": detail.get("expected_convention", ""),
                "minority_count": 0,
                "outliers": [],
            },
        )
        entry["minority_count"] += 1
        if filepath not in entry["outliers"]:
            entry["outliers"].append(filepath)
        if not entry["majority"] and detail.get("expected_convention"):
            entry["majority"] = detail["expected_convention"]

    results = sorted(dir_data.values(), key=lambda e: -e["minority_count"])
    return results[:20]


__all__ = ["_build_duplicate_clusters", "_build_naming_drift"]
