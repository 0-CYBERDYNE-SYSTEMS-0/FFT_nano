"""Direct-test quality issue ranking and construction helpers."""

from __future__ import annotations

import os

_QUALITY_ISSUE_PRIORITY = {
    "assertion_free": 5,
    "placeholder_smoke": 4,
    "smoke": 3,
    "over_mocked": 2,
    "snapshot_heavy": 1,
}


def quality_issue_rank(quality_kind: object) -> int:
    """Return severity rank for a quality issue kind (higher = more severe)."""
    if not isinstance(quality_kind, str):
        return 0
    return _QUALITY_ISSUE_PRIORITY.get(quality_kind, 0)


def quality_issue_item(
    *,
    prod_file: str,
    test_file: str,
    quality: dict,
    loc_weight: float,
) -> dict | None:
    """Build a quality issue payload for a specific test file."""
    basename = os.path.basename(test_file)
    quality_kind = quality.get("quality")
    if quality_kind == "assertion_free":
        return {
            "file": prod_file,
            "name": f"assertion_free::{basename}",
            "tier": 3,
            "confidence": "medium",
            "summary": (
                f"Assertion-free test: {basename} has "
                f"{quality['test_functions']} test functions but 0 assertions"
            ),
            "detail": {
                "kind": "assertion_free_test",
                "test_file": test_file,
                "test_functions": quality["test_functions"],
                "loc_weight": loc_weight,
            },
        }
    if quality_kind == "placeholder_smoke":
        return {
            "file": prod_file,
            "name": f"placeholder::{basename}",
            "tier": 2,
            "confidence": "high",
            "summary": (
                f"Placeholder smoke test: {basename} relies on tautological assertions "
                "and likely inflates coverage confidence"
            ),
            "detail": {
                "kind": "placeholder_test",
                "test_file": test_file,
                "assertions": quality["assertions"],
                "test_functions": quality["test_functions"],
                "loc_weight": loc_weight,
            },
        }
    if quality_kind == "smoke":
        return {
            "file": prod_file,
            "name": f"shallow::{basename}",
            "tier": 3,
            "confidence": "medium",
            "summary": (
                f"Shallow tests: {basename} has {quality['assertions']} assertions across "
                f"{quality['test_functions']} test functions"
            ),
            "detail": {
                "kind": "shallow_tests",
                "test_file": test_file,
                "assertions": quality["assertions"],
                "test_functions": quality["test_functions"],
                "loc_weight": loc_weight,
            },
        }
    if quality_kind == "over_mocked":
        return {
            "file": prod_file,
            "name": f"over_mocked::{basename}",
            "tier": 3,
            "confidence": "low",
            "summary": (
                f"Over-mocked tests: {basename} has "
                f"{quality['mocks']} mocks vs {quality['assertions']} assertions"
            ),
            "detail": {
                "kind": "over_mocked",
                "test_file": test_file,
                "mocks": quality["mocks"],
                "assertions": quality["assertions"],
                "loc_weight": loc_weight,
            },
        }
    if quality_kind == "snapshot_heavy":
        return {
            "file": prod_file,
            "name": f"snapshot_heavy::{basename}",
            "tier": 3,
            "confidence": "low",
            "summary": (
                f"Snapshot-heavy tests: {basename} has {quality['snapshots']} snapshots vs "
                f"{quality['assertions']} assertions"
            ),
            "detail": {
                "kind": "snapshot_heavy",
                "test_file": test_file,
                "snapshots": quality["snapshots"],
                "assertions": quality["assertions"],
                "loc_weight": loc_weight,
            },
        }
    return None


def select_direct_test_quality_issue(
    *,
    prod_file: str,
    related_tests: list[str],
    test_quality: dict[str, dict],
    loc_weight: float,
) -> dict | None:
    """Return one representative quality issue for a directly-tested module."""
    has_adequate_direct_test = False
    selected: tuple[int, str, dict] | None = None

    for test_file in sorted(related_tests):
        quality = test_quality.get(test_file)
        if quality is None:
            continue
        quality_kind = quality.get("quality")
        issue = quality_issue_item(
            prod_file=prod_file,
            test_file=test_file,
            quality=quality,
            loc_weight=loc_weight,
        )
        if issue is None:
            if quality_kind in {"adequate", "thorough"}:
                has_adequate_direct_test = True
            continue

        rank = quality_issue_rank(quality_kind)
        if selected is None:
            selected = (rank, test_file, issue)
            continue
        prev_rank, prev_file, _ = selected
        if rank > prev_rank or (rank == prev_rank and test_file < prev_file):
            selected = (rank, test_file, issue)

    if has_adequate_direct_test or selected is None:
        return None
    return selected[2]


__all__ = [
    "quality_issue_item",
    "quality_issue_rank",
    "select_direct_test_quality_issue",
]
