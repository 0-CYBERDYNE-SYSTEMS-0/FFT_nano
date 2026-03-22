"""Rendering and follow-up helpers for the status command."""

from __future__ import annotations

from typing import Any

from desloppify.app.commands.helpers.rendering import (
    print_agent_plan,
    print_ranked_actions,
)
from desloppify.app.commands.helpers.subjective import print_subjective_followup
from desloppify.app.commands.scan.reporting import (
    dimensions as reporting_dimensions_mod,
)
from desloppify.base.output.terminal import colorize, print_table
from desloppify.engine._scoring.detection import merge_potentials
from desloppify.engine._scoring.policy.core import DIMENSIONS
from desloppify.engine._scoring.results.core import compute_score_impact
from desloppify.engine._state.schema import StateModel

from .render_dimensions import find_lowest_dimension as _find_lowest_dimension
from .render_dimensions import open_review_issue_counts as _open_review_issue_counts
from .render_dimensions import (
    render_objective_dimensions as _render_objective_dimensions,
)
from .render_dimensions import (
    render_subjective_dimensions as _render_subjective_dimensions,
)
from .render_dimensions import (
    scorecard_subjective_entries_for_status as _scorecard_subjective_entries,
)
from .render_io import (
    StatusQueryRequest,
    show_ignore_summary,
    show_tier_progress_table,
    write_status_query,
)
from .render_structural import build_area_rows as _build_area_rows
from .render_structural import collect_structural_areas as _collect_structural_areas
from .render_structural import render_area_workflow as _render_area_workflow
from .summary import (
    print_open_scope_breakdown,
    print_scan_completeness,
    print_scan_metrics,
    score_summary_lines,
)


def _render_dimension_legend(
    scorecard_subjective: list[dict[str, Any]],
    state: StateModel | None = None,
    *,
    objective_backlog: int = 0,
) -> None:
    """Print the legend footer and, when actionable, the stale rerun command."""
    print(
        colorize("  Health = open penalized | Strict = open + wontfix penalized", "dim")
    )
    print(
        colorize(
            "  Action: fix=auto-fixer | move=reorganize | refactor=manual rewrite | manual=review & fix",
            "dim",
        )
    )
    stale_keys = [
        str(e.get("dimension_key"))
        for e in scorecard_subjective
        if e.get("stale") and e.get("dimension_key")
    ]
    if stale_keys:
        print(
            colorize("  [stale] = assessment outdated", "yellow")
        )
        if objective_backlog <= 0:
            n = len(stale_keys)
            dims_arg = ",".join(stale_keys)
            print(
                colorize(
                    f"  {n} stale dimension{'s' if n != 1 else ''}"
                    f": `desloppify review --prepare --dimensions {dims_arg} --force-review-rerun`",
                    "yellow",
                )
            )


def show_dimension_table(
    state: StateModel, dim_scores: dict[str, Any], *, objective_backlog: int = 0,
) -> None:
    """Show dimension health table with dual scores and progress bars."""
    print()
    bar_len = 20
    print(
        colorize(
            f"  {'Dimension':<22} {'Checks':>7}  {'Health':>6}  {'Strict':>6}  {'Bar':<{bar_len + 2}} {'Tier'}  {'Action'}",
            "dim",
        )
    )
    print(colorize("  " + "─" * 86, "dim"))

    scorecard_subjective = _scorecard_subjective_entries(state, dim_scores)
    lowest_name = _find_lowest_dimension(dim_scores, scorecard_subjective)
    review_issue_counts = _open_review_issue_counts(state)

    _render_objective_dimensions(dim_scores, lowest_name=lowest_name, bar_len=bar_len)
    _render_subjective_dimensions(
        scorecard_subjective,
        lowest_name=lowest_name,
        bar_len=bar_len,
        review_issue_counts=review_issue_counts,
    )
    _render_dimension_legend(scorecard_subjective, state=state, objective_backlog=objective_backlog)
    print()


def _render_plan_focus(plan: dict[str, Any] | None) -> bool:
    if not plan or not plan.get("active_cluster"):
        return False
    cluster_name = plan["active_cluster"]
    cluster = plan.get("clusters", {}).get(cluster_name, {})
    remaining = len(cluster.get("issue_ids", []))
    desc = cluster.get("description") or ""
    desc_str = f" — {desc}" if desc else ""
    print(
        colorize(
            f"  Focus: {cluster_name} ({remaining} items remaining){desc_str}",
            "cyan",
        )
    )
    print()
    return True


def _lowest_focus_context(
    lowest_name: str,
    dim_scores: dict[str, Any],
    scorecard_subjective: list[dict[str, Any]],
) -> tuple[str | None, float, int]:
    for dim in DIMENSIONS:
        if dim.name != lowest_name:
            continue
        dim_score = dim_scores.get(dim.name)
        if not dim_score:
            return None, 101.0, 0
        return (
            "mechanical",
            float(dim_score.get("strict", dim_score["score"])),
            int(dim_score.get("failing", 0)),
        )

    for entry in scorecard_subjective:
        if entry.get("name") != lowest_name:
            continue
        return (
            "subjective",
            float(entry.get("strict", entry.get("score", 100.0))),
            0,
        )
    return None, 101.0, 0


def _mechanical_focus_impact(
    *,
    lowest_name: str,
    lowest_issues: int,
    dim_scores: dict[str, Any],
    state: StateModel,
) -> float | None:
    target_dim = next((d for d in DIMENSIONS if d.name == lowest_name), None)
    if target_dim is None:
        return None
    potentials = merge_potentials(state.get("potentials", {}))
    impact = 0.0
    normalized_scores = {
        key: {
            "score": value["score"],
            "tier": value.get("tier", 3),
            "detectors": value.get("detectors", {}),
        }
        for key, value in dim_scores.items()
        if "score" in value
    }
    for detector in target_dim.detectors:
        impact = compute_score_impact(
            normalized_scores,
            potentials,
            detector,
            lowest_issues,
        )
        if impact > 0:
            return impact
    return impact


def show_focus_suggestion(
    dim_scores: dict[str, Any], state: StateModel, *, plan: dict[str, Any] | None = None
) -> None:
    """Show the lowest-scoring dimension as the focus area."""
    if _render_plan_focus(plan):
        return

    scorecard_subjective = _scorecard_subjective_entries(state, dim_scores)
    lowest_name = _find_lowest_dimension(dim_scores, scorecard_subjective)
    if not lowest_name:
        return

    lowest_kind, lowest_score, lowest_issues = _lowest_focus_context(
        lowest_name,
        dim_scores,
        scorecard_subjective,
    )
    if lowest_score >= 100:
        return
    if lowest_kind == "subjective":
        print(
            colorize(
                f"  Focus: {lowest_name} ({lowest_score:.1f}%) — re-review to improve",
                "cyan",
            )
        )
        print()
        return

    impact = _mechanical_focus_impact(
        lowest_name=lowest_name,
        lowest_issues=lowest_issues,
        dim_scores=dim_scores,
        state=state,
    )
    if impact is None:
        return
    impact_str = f" for +{impact:.1f} pts" if impact > 0 else ""
    print(
        colorize(
            f"  Focus: {lowest_name} ({lowest_score:.1f}%) — "
            f"fix {lowest_issues} items{impact_str}",
            "cyan",
        )
    )
    print()


def show_subjective_followup(
    state: StateModel,
    dim_scores: dict[str, Any],
    *,
    target_strict_score: float,
    objective_backlog: int = 0,
) -> None:
    """Show concrete subjective follow-up commands when applicable."""
    if not dim_scores:
        return

    subjective = _scorecard_subjective_entries(state, dim_scores)
    if not subjective:
        return

    followup = reporting_dimensions_mod.build_subjective_followup(
        state,
        subjective,
        threshold=target_strict_score,
        max_quality_items=3,
        max_integrity_items=5,
    )
    if print_subjective_followup(followup, objective_backlog=objective_backlog):
        print()


def show_agent_plan(
    narrative: dict[str, Any], *, plan: dict[str, Any] | None = None
) -> None:
    """Show concise action plan derived from narrative.actions.

    When a living *plan* is active, renders plan focus/progress instead.
    """
    if plan and (plan.get("queue_order") or plan.get("clusters")):
        print_agent_plan(
            [],
            plan=plan,
            header="  AGENT PLAN (use `desloppify next` to see your next task):",
        )
        return

    actions = narrative.get("actions", [])
    if not actions:
        return

    print(
        colorize(
            "  AGENT PLAN (use `desloppify next --count 20` to inspect more items):",
            "yellow",
        )
    )
    top = actions[0]
    print(colorize(f"  Agent focus: `{top['command']}` — {top['description']}", "cyan"))

    if print_ranked_actions(actions):
        print()


def show_structural_areas(state: StateModel) -> None:
    """Show structural debt grouped by area when T3/T4 debt is significant."""
    sorted_areas = _collect_structural_areas(state)
    if sorted_areas is None:
        return

    print(colorize("\n  ── Structural Debt by Area ──", "bold"))
    print(
        colorize(
            "  Create a task doc for each area → farm to sub-agents for decomposition",
            "dim",
        )
    )
    print()

    rows = _build_area_rows(sorted_areas)
    print_table(
        ["Area", "Items", "Tiers", "Open", "Debt", "Weight"], rows, [42, 6, 10, 5, 5, 7]
    )

    _render_area_workflow(sorted_areas)


def show_review_summary(state: StateModel) -> None:
    """Show review work items summary if any exist."""
    issues = (state.get("work_items") or state.get("issues", {}))
    review_open = [
        f
        for f in issues.values()
        if f.get("status") == "open" and f.get("detector") == "review"
    ]
    if not review_open:
        return
    uninvestigated = sum(
        1 for f in review_open if not f.get("detail", {}).get("investigation")
    )
    parts = [f"{len(review_open)} issue{'s' if len(review_open) != 1 else ''} open"]
    if uninvestigated:
        parts.append(f"{uninvestigated} uninvestigated")
    print(colorize(f"  Review: {', '.join(parts)} — `desloppify show review --status open`", "cyan"))
    dim_scores = state.get("dimension_scores", {})
    if "Test health" in dim_scores:
        print(
            colorize(
                "  Test health tracks coverage + review; review work items track issues found.",
                "dim",
            )
        )
    print()


__all__ = [
    "StatusQueryRequest",
    "print_open_scope_breakdown",
    "print_scan_completeness",
    "print_scan_metrics",
    "score_summary_lines",
    "show_agent_plan",
    "show_dimension_table",
    "show_focus_suggestion",
    "show_ignore_summary",
    "show_review_summary",
    "show_structural_areas",
    "show_subjective_followup",
    "show_tier_progress_table",
    "write_status_query",
]
