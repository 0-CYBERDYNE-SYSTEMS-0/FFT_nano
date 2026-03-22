"""Dimension-table helpers for status rendering."""

from __future__ import annotations

from desloppify.app.commands.scan.reporting.presentation import dimension_bar
from desloppify.base.config import DEFAULT_TARGET_STRICT_SCORE
from desloppify.base.output.terminal import colorize
from desloppify.base.registry import dimension_action_type
from desloppify.engine.scoring import DIMENSIONS
from desloppify.engine.planning.scorecard_projection import (
    scorecard_subjective_entries,
)


def scorecard_subjective_entries_for_status(state: dict, dim_scores: dict) -> list[dict]:
    """Return subjective entries aligned to scorecard labels and ordering."""
    return scorecard_subjective_entries(
        state,
        dim_scores=dim_scores,
    )


def find_lowest_dimension(
    dim_scores: dict,
    scorecard_subjective: list[dict],
) -> str | None:
    """Return the dimension name with the lowest strict score."""
    lowest_name = None
    lowest_score = 101.0
    for dim in DIMENSIONS:
        ds = dim_scores.get(dim.name)
        if not ds:
            continue
        strict_val = ds.get("strict", ds["score"])
        if strict_val < lowest_score:
            lowest_score = strict_val
            lowest_name = dim.name
    for entry in scorecard_subjective:
        strict_val = float(entry.get("strict", entry.get("score", 100.0)))
        if strict_val < lowest_score:
            lowest_score = strict_val
            lowest_name = entry.get("name")
    return lowest_name


def open_review_issue_counts(state: dict) -> dict[str, int]:
    """Count open review issues grouped by subjective dimension key."""
    issues = (state.get("work_items") or state.get("issues", {}))
    if not isinstance(issues, dict):
        return {}

    counts: dict[str, int] = {}
    for issue in issues.values():
        if not isinstance(issue, dict):
            continue
        if issue.get("status") != "open" or issue.get("detector") != "review":
            continue
        detail = issue.get("detail", {})
        dimension = ""
        if isinstance(detail, dict):
            dimension = str(detail.get("dimension", "")).strip()
        if not dimension:
            dimension = str(issue.get("dimension", "")).strip()
        if not dimension:
            continue
        counts[dimension] = counts.get(dimension, 0) + 1
    return counts


def render_objective_dimensions(
    dim_scores: dict,
    *,
    lowest_name: str | None,
    bar_len: int,
) -> None:
    """Print rows for objective (detector-based) dimensions."""
    for dim in DIMENSIONS:
        ds = dim_scores.get(dim.name)
        if not ds:
            continue
        score_val = ds["score"]
        strict_val = ds.get("strict", score_val)
        checks = ds["checks"]

        bar = dimension_bar(score_val, colorize_fn=colorize, bar_len=bar_len)
        focus = colorize(" ←", "yellow") if dim.name == lowest_name else "  "
        checks_str = f"{checks:>7,}"
        action = dimension_action_type(dim.name)
        print(
            f"  {dim.name:<22} {checks_str}  {score_val:5.1f}%  {strict_val:5.1f}%  {bar}  T{dim.tier}  {action}{focus}"
        )


def render_subjective_dimensions(
    scorecard_subjective: list[dict],
    *,
    lowest_name: str | None,
    bar_len: int,
    review_issue_counts: dict[str, int],
) -> None:
    """Print rows for subjective (review-based) dimensions."""
    if not scorecard_subjective:
        return
    print(
        colorize(
            "  ── Subjective Measures (matches scorecard.png) ──────────────────────",
            "dim",
        )
    )
    for entry in scorecard_subjective:
        name = str(entry.get("name", "Unknown"))
        score_val = float(entry.get("score", 0.0))
        strict_val = float(entry.get("strict", score_val))
        tier = 4

        bar = dimension_bar(score_val, colorize_fn=colorize, bar_len=bar_len)
        focus = colorize(" ←", "yellow") if name == lowest_name else "  "
        checks_str = f"{'—':>7}"
        stale_tag = colorize(" [stale]", "yellow") if entry.get("stale") else ""
        placeholder_tag = (
            colorize(" [unassessed]", "yellow") if entry.get("placeholder") else ""
        )
        dim_key = str(entry.get("dimension_key", "")).strip()
        cli_keys = [
            str(key).strip()
            for key in entry.get("cli_keys", [])
            if isinstance(key, str) and str(key).strip()
        ]
        if dim_key:
            issue_count = int(review_issue_counts.get(dim_key, 0))
        elif cli_keys:
            issue_count = int(sum(review_issue_counts.get(key, 0) for key in cli_keys))
        else:
            issue_count = 0
        issue_style = "yellow" if strict_val < DEFAULT_TARGET_STRICT_SCORE and issue_count == 0 else "dim"
        issue_tag = colorize(f" [open issues: {issue_count}]", issue_style)
        print(
            f"  {name:<22} {checks_str}  {score_val:5.1f}%  {strict_val:5.1f}%  {bar}  T{tier}  {'review'}{focus}{stale_tag}"
            f"{placeholder_tag}{issue_tag}"
        )


__all__ = [
    "find_lowest_dimension",
    "open_review_issue_counts",
    "render_objective_dimensions",
    "render_subjective_dimensions",
    "scorecard_subjective_entries_for_status",
]
