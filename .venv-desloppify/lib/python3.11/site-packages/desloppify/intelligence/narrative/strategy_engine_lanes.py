"""Lane partitioning helpers for narrative strategy execution."""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from desloppify.intelligence.narrative._constants import _DETECTOR_CASCADE


def _cleanup_lane_actions(actions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    cascade_rank = {detector: idx for idx, detector in enumerate(_DETECTOR_CASCADE)}

    def sort_key(action: dict[str, Any]) -> tuple[int, float]:
        detector = action.get("detector", "")
        return (cascade_rank.get(detector, 99), -action.get("impact", 0))

    return sorted(actions, key=sort_key)


def _files_for_actions(
    actions: Iterable[dict[str, Any]], files_by_detector: dict[str, set[str]]
) -> set[str]:
    files: set[str] = set()
    for action in actions:
        detector = action.get("detector")
        if detector and detector in files_by_detector:
            files |= files_by_detector[detector]
    return files


def _group_by_file_overlap(
    action_files: list[tuple[dict[str, Any], set[str]]],
) -> list[list[tuple[dict[str, Any], set[str]]]]:
    """Group actions whose file sets overlap using union-find."""
    item_count = len(action_files)
    if item_count == 0:
        return []

    parent = list(range(item_count))

    def find(index: int) -> int:
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index

    def union(left: int, right: int) -> None:
        left_root, right_root = find(left), find(right)
        if left_root != right_root:
            parent[left_root] = right_root

    for left in range(item_count):
        for right in range(left + 1, item_count):
            if action_files[left][1] & action_files[right][1]:
                union(left, right)

    grouped_indices: dict[int, list[int]] = {}
    for index in range(item_count):
        grouped_indices.setdefault(find(index), []).append(index)

    return [
        [action_files[index] for index in indices]
        for indices in grouped_indices.values()
    ]


def _refactor_lanes(
    refactor_actions: list[dict[str, Any]],
    files_by_detector: dict[str, set[str]],
) -> dict[str, dict[str, Any]]:
    """Split refactor work into independent lanes by file overlap."""
    lanes: dict[str, dict] = {}
    action_files = [
        (action, files_by_detector.get(action.get("detector"), set()))
        for action in refactor_actions
    ]

    test_coverage_actions = [
        (action, files)
        for action, files in action_files
        if action.get("detector") == "test_coverage"
    ]
    other_actions = [
        (action, files)
        for action, files in action_files
        if action.get("detector") != "test_coverage"
    ]

    groups = _group_by_file_overlap(other_actions)
    for index, group in enumerate(groups):
        lane_name = f"refactor_{index}" if len(groups) > 1 else "refactor"
        lanes[lane_name] = {
            "actions": [action["priority"] for action, _ in group],
            "file_count": len(
                _files_for_actions((action for action, _ in group), files_by_detector)
            ),
            "total_impact": round(
                sum(action.get("impact", 0) for action, _ in group), 1
            ),
            "automation": "manual",
            "run_first": False,
        }

    if test_coverage_actions:
        lanes["test_coverage"] = {
            "actions": [action["priority"] for action, _ in test_coverage_actions],
            "file_count": len(
                _files_for_actions(
                    (action for action, _ in test_coverage_actions), files_by_detector
                )
            ),
            "total_impact": round(
                sum(action.get("impact", 0) for action, _ in test_coverage_actions), 1
            ),
            "automation": "manual",
            "run_first": False,
        }

    return lanes


def compute_lanes(
    actions: list[dict[str, Any]],
    files_by_detector: dict[str, set[str]],
) -> dict[str, dict[str, Any]]:
    """Partition actions into parallelizable work lanes."""
    lanes: dict[str, dict] = {}

    cleanup_actions = _cleanup_lane_actions(
        [action for action in actions if action.get("type") == "auto_fix"]
    )
    reorganize_actions = [
        action for action in actions if action.get("type") == "reorganize"
    ]
    debt_actions = [action for action in actions if action.get("type") == "debt_review"]
    refactor_actions = [
        action
        for action in actions
        if action.get("type") not in {"auto_fix", "reorganize", "debt_review"}
    ]

    if cleanup_actions:
        cleanup_files = _files_for_actions(cleanup_actions, files_by_detector)
        lanes["cleanup"] = {
            "actions": [action["priority"] for action in cleanup_actions],
            "file_count": len(cleanup_files),
            "total_impact": round(
                sum(action.get("impact", 0) for action in cleanup_actions), 1
            ),
            "automation": "full",
            "run_first": False,
        }

    if reorganize_actions:
        lanes["restructure"] = {
            "actions": [action["priority"] for action in reorganize_actions],
            "file_count": len(
                _files_for_actions(reorganize_actions, files_by_detector)
            ),
            "total_impact": round(
                sum(action.get("impact", 0) for action in reorganize_actions), 1
            ),
            "automation": "manual",
            "run_first": False,
        }

    if refactor_actions:
        lanes.update(_refactor_lanes(refactor_actions, files_by_detector))

    if debt_actions:
        lanes["debt_review"] = {
            "actions": [action["priority"] for action in debt_actions],
            "file_count": 0,
            "total_impact": 0.0,
            "automation": "manual",
            "run_first": False,
        }

    if "cleanup" in lanes:
        for lane_name, lane in lanes.items():
            if lane_name == "cleanup":
                continue
            lane_files = _files_for_actions(
                (action for action in actions if action["priority"] in lane["actions"]),
                files_by_detector,
            )
            if cleanup_files & lane_files:
                lanes["cleanup"]["run_first"] = True
                break

    return lanes


def significant_lane(lane_name: str, lane: dict[str, Any]) -> bool:
    """Return True when lane contributes to real parallelization opportunities."""
    if lane_name == "debt_review" or lane.get("run_first"):
        return False
    return lane.get("file_count", 0) >= 5 or lane.get("total_impact", 0) >= 1.0


__all__ = [
    "compute_lanes",
    "significant_lane",
]
