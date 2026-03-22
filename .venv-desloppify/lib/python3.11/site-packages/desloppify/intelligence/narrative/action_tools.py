"""Tool inventory helpers for narrative payloads."""

from __future__ import annotations

from typing import Any

from desloppify.intelligence.narrative._constants import DETECTOR_TOOLS
from desloppify.intelligence.narrative.action_engine import supported_fixers
from desloppify.intelligence.narrative.action_models import ToolFixer, ToolInventory
from desloppify.state_io import StateModel


def _move_reasons(by_detector: dict[str, int]) -> list[str]:
    reasons: list[str] = []
    if by_detector.get("orphaned", 0):
        reasons.append(f"{by_detector['orphaned']} orphaned files")
    if by_detector.get("coupling", 0):
        reasons.append(f"{by_detector['coupling']} coupling violations")
    if by_detector.get("single_use", 0):
        reasons.append(f"{by_detector['single_use']} single-use files")
    if by_detector.get("flat_dirs", 0):
        reasons.append(f"{by_detector['flat_dirs']} flat directories")
    if by_detector.get("naming", 0):
        reasons.append(f"{by_detector['naming']} naming issues")
    return reasons


def _build_fixers(
    by_detector: dict[str, int], state: StateModel, lang: str | None
) -> list[ToolFixer]:
    fixers: list[ToolFixer] = []
    supported = supported_fixers(state, lang)

    for detector, tool_info in DETECTOR_TOOLS.items():
        if tool_info["action_type"] != "auto_fix":
            continue
        count = by_detector.get(detector, 0)
        if count == 0:
            continue

        for fixer in tool_info["fixers"]:
            if supported is not None and fixer not in supported:
                continue
            fixers.append(
                {
                    "name": fixer,
                    "detector": detector,
                    "open_count": count,
                    "command": f"desloppify autofix {fixer} --dry-run",
                }
            )

    return fixers


def compute_tools(
    by_detector: dict[str, int],
    state: StateModel,
    lang: str | None,
    badge: dict[str, Any],
) -> ToolInventory:
    move_keys = ["orphaned", "flat_dirs", "naming", "single_use", "coupling", "cycles"]
    organizational_issues = sum(by_detector.get(detector, 0) for detector in move_keys)
    reasons = _move_reasons(by_detector)

    return {
        "fixers": _build_fixers(by_detector, state, lang),
        "move": {
            "available": True,
            "relevant": organizational_issues > 0,
            "reason": " + ".join(reasons) if reasons else None,
            "usage": "desloppify move <source> <dest> [--dry-run]",
        },
        "plan": {
            "command": "desloppify plan",
            "description": "Generate prioritized markdown cleanup plan",
        },
        "badge": badge,
    }
