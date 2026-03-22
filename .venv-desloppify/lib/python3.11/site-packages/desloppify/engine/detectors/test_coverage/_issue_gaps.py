"""Issue builders for transitive-only and untested module coverage gaps."""

from __future__ import annotations

from .metrics import _COMPLEXITY_TIER_UPGRADE

CoverageIssue = dict[str, object]
IssueDetail = dict[str, int | float | str]


def transitive_coverage_gap_issue(
    *,
    file_path: str,
    loc: int,
    importer_count: int,
    loc_weight: float,
    complexity: float,
) -> CoverageIssue:
    """Build issue payload for modules covered only transitively."""
    is_complex = complexity >= _COMPLEXITY_TIER_UPGRADE
    detail: IssueDetail = {
        "kind": "transitive_only",
        "loc": loc,
        "importer_count": importer_count,
        "loc_weight": loc_weight,
    }
    if is_complex:
        detail["complexity_score"] = complexity
    return {
        "file": file_path,
        "name": "transitive_only",
        "tier": 2 if (importer_count >= 10 or is_complex) else 3,
        "confidence": "medium",
        "summary": (
            f"No direct tests ({loc} LOC, {importer_count} importers) "
            "— covered only via imports from tested modules"
        ),
        "detail": detail,
    }


def untested_module_issue(
    *,
    file_path: str,
    loc: int,
    importer_count: int,
    loc_weight: float,
    complexity: float,
) -> CoverageIssue:
    """Build issue payload for untested production modules."""
    is_complex = complexity >= _COMPLEXITY_TIER_UPGRADE
    if importer_count >= 10 or is_complex:
        detail: IssueDetail = {
            "kind": "untested_critical",
            "loc": loc,
            "importer_count": importer_count,
            "loc_weight": loc_weight,
        }
        if is_complex:
            detail["complexity_score"] = complexity
        return {
            "file": file_path,
            "name": "untested_critical",
            "tier": 2,
            "confidence": "high",
            "summary": (
                f"Untested critical module ({loc} LOC, {importer_count} importers) "
                "— high blast radius"
            ),
            "detail": detail,
        }
    return {
        "file": file_path,
        "name": "untested_module",
        "tier": 3,
        "confidence": "high",
        "summary": f"Untested module ({loc} LOC, {importer_count} importers)",
        "detail": {
            "kind": "untested_module",
            "loc": loc,
            "importer_count": importer_count,
            "loc_weight": loc_weight,
        },
    }


__all__ = ["transitive_coverage_gap_issue", "untested_module_issue"]
