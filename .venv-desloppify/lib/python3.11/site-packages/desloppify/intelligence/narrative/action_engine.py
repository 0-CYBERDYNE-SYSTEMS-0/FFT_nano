"""Action computation engine used by narrative query generation."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from desloppify.engine._scoring.detection import merge_potentials
from desloppify.engine._scoring.results.core import compute_score_impact
from desloppify.intelligence.narrative._constants import DETECTOR_TOOLS
from desloppify.intelligence.narrative.action_engine_routing import (
    _annotate_with_clusters,
    _append_debt_action,
    _append_refactor_actions,
    _append_reorganize_actions,
    _assign_priorities,
    _dimension_name,
)
from desloppify.intelligence.narrative.action_models import ActionContext, ActionItem
from desloppify.languages.framework import get_lang
from desloppify.state_io import StateModel


def supported_fixers(state: StateModel, lang: str | None) -> set[str] | None:
    """Return supported fixers for the active language, or None when unknown."""
    if not lang:
        return None

    capabilities = state.get("lang_capabilities", {}).get(lang, {})
    fixers = capabilities.get("fixers")
    if isinstance(fixers, list):
        return {fixer for fixer in fixers if isinstance(fixer, str)}

    try:
        return set(get_lang(lang).fixers.keys())
    except (ImportError, ValueError):
        return None


def _impact_calculator(
    dimension_scores: dict[str, dict[str, Any]],
    state: StateModel,
) -> Callable[[str, int], float]:
    """Build an impact estimator closure keyed by detector and count."""
    merged_potentials = merge_potentials(state.get("potentials", {}))
    if not merged_potentials or not dimension_scores:
        return lambda _detector, _count: 0.0

    scoring_view = {
        name: {
            "score": values["score"],
            "tier": values.get("tier", 3),
            "detectors": values.get("detectors", {}),
        }
        for name, values in dimension_scores.items()
    }

    def _impact(detector: str, count: int) -> float:
        return compute_score_impact(scoring_view, merged_potentials, detector, count)

    return _impact


def _fixer_has_applicable_issues(
    state: StateModel,
    detector: str,
    fixer_name: str,
) -> bool:
    """For smells, verify the fixer has matching open issues."""
    if detector != "smells":
        return True
    smell_id = fixer_name.replace("-", "_")
    return any(
        issue.get("status") == "open"
        and not issue.get("suppressed")
        and issue.get("detector") == "smells"
        and issue.get("detail", {}).get("smell_id") == smell_id
        for issue in (state.get("work_items") or state.get("issues", {})).values()
    )


def _append_auto_fix_actions(
    actions: list[ActionItem],
    by_detector: dict[str, int],
    supported: set[str] | None,
    impact_for: Callable[[str, int], float],
    state: StateModel,
) -> None:
    """Append auto-fix/manual-fix actions for detectors with auto fixers."""
    for detector, tool_info in DETECTOR_TOOLS.items():
        if tool_info["action_type"] != "auto_fix":
            continue
        count = by_detector.get(detector, 0)
        if count == 0:
            continue

        impact = round(impact_for(detector, count), 1)
        available_fixers = [
            fixer
            for fixer in tool_info["fixers"]
            if (supported is None or fixer in supported)
            and _fixer_has_applicable_issues(state, detector, fixer)
        ]
        if not available_fixers:
            actions.append(
                {
                    "type": "manual_fix",
                    "detector": detector,
                    "count": count,
                    "description": (
                        f"{count} {detector} issues — inspect with "
                        "`desloppify next` and fix manually"
                    ),
                    "command": f"desloppify show {detector} --status open",
                    "impact": impact,
                    "dimension": _dimension_name(detector),
                }
            )
            continue

        fixer = available_fixers[0]
        actions.append(
            {
                "type": "auto_fix",
                "detector": detector,
                "count": count,
                "description": (
                    f"{count} {detector} issues — run "
                    f"`desloppify autofix {fixer} --dry-run` to preview, then apply"
                ),
                "command": f"desloppify autofix {fixer} --dry-run",
                "impact": impact,
                "dimension": _dimension_name(detector),
            }
        )


def compute_actions(ctx: ActionContext) -> list[ActionItem]:
    """Compute prioritized action list with tool mapping."""
    actions: list[ActionItem] = []
    impact_for = _impact_calculator(ctx.dimension_scores, ctx.state)
    supported = supported_fixers(ctx.state, ctx.lang)

    _append_auto_fix_actions(actions, ctx.by_detector, supported, impact_for, ctx.state)
    _append_reorganize_actions(actions, ctx.by_detector, impact_for)
    _append_refactor_actions(actions, ctx.by_detector, impact_for)
    _append_debt_action(actions, ctx.debt)

    prioritized = _assign_priorities(actions)
    _annotate_with_clusters(prioritized, ctx.clusters)
    return prioritized
