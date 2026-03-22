"""Dimension and empty-result rendering helpers for show command."""

from __future__ import annotations

from desloppify.app.commands.helpers.query import write_query
from desloppify.base.config import target_strict_score_from_config
from desloppify.base.output.terminal import colorize
from desloppify.engine._state.issue_semantics import is_triage_finding

from .render import show_subjective_followup
from .scope import _detector_names_hint, _lookup_dimension_score, load_matches


def _print_dimension_score(dim_data: dict, display_name: str) -> None:
    """Print the health/strict score line for a dimension if available."""
    score_val = dim_data.get("score") if isinstance(dim_data, dict) else None
    strict_val = (
        dim_data.get("strict", score_val) if isinstance(dim_data, dict) else None
    )
    if score_val is not None:
        print(
            colorize(
                f"  {display_name}: {score_val:.1f}% health (strict: {strict_val:.1f}%)",
                "bold",
            )
        )


def _render_judgment(state: dict, dimension_key: str) -> None:
    """Print judgment narrative (strengths, dimension_character, score_rationale) if available."""
    assessments = state.get("subjective_assessments", {})
    assessment = assessments.get(dimension_key, {})
    if not isinstance(assessment, dict):
        return
    judgment = assessment.get("judgment")
    if not isinstance(judgment, dict):
        return

    score_rationale = judgment.get("score_rationale", "")
    if score_rationale:
        print(colorize(f"  Score rationale: {score_rationale}", "dim"))

    strengths = judgment.get("strengths", [])
    if isinstance(strengths, list) and strengths:
        print(colorize("  Strengths:", "dim"))
        for s in strengths:
            print(colorize(f"    - {s}", "dim"))

    dim_char = judgment.get("dimension_character", "")
    if dim_char:
        print(colorize(f"  Dimension character: {dim_char}", "dim"))


def _render_subjective_dimension(
    state: dict,
    config: dict,
    entity,
    pattern_raw: str,
) -> None:
    """Show score + subjective explanation for a subjective dimension."""
    lowered = pattern_raw.strip().lower().replace(" ", "_") if pattern_raw else ""
    dim_data, display_name = _lookup_dimension_score(state, entity.display_name)
    _print_dimension_score(dim_data, display_name)
    _render_judgment(state, lowered)
    print(
        colorize(
            f"  '{pattern_raw.strip()}' is a subjective dimension "
            "— its score comes from design reviews, not code issues.",
            "yellow",
        )
    )
    dim_reviews = [
        issue
        for issue in (state.get("work_items") or {}).values()
        if is_triage_finding(issue)
        and issue.get("status") == "open"
        and lowered
        in str(issue.get("detail", {}).get("dimension", "")).lower().replace(" ", "_")
    ]
    if dim_reviews:
        print(
            colorize(
                f"  {len(dim_reviews)} open review work item(s). "
                "Run `show review --status open`.",
                "dim",
            )
        )
    show_subjective_followup(
        state,
        target_strict_score_from_config(config),
    )


def _render_clean_mechanical_dimension(state: dict, entity) -> None:
    """Show score + 'no open issues' for a mechanical dimension with zero issues."""
    dim_data, display_name = _lookup_dimension_score(state, entity.display_name)
    _print_dimension_score(dim_data, display_name)
    det_list = ", ".join(entity.detectors) if entity.detectors else "none"
    print(
        colorize(
            f"  No open issues for {entity.display_name}. Detectors: {det_list}",
            "green",
        )
    )


def _load_dimension_issues(
    state: dict,
    entity,
    status_filter: str,
) -> list[dict]:
    """Load issues for all detectors in a mechanical dimension."""
    all_matches: list[dict] = []
    for detector in entity.detectors:
        matches = load_matches(
            state, scope=detector, status_filter=status_filter, chronic=False
        )
        all_matches.extend(matches)
    seen: set[str] = set()
    unique: list[dict] = []
    for item in all_matches:
        issue_id = item.get("id", "")
        if issue_id not in seen:
            seen.add(issue_id)
            unique.append(item)
    return unique


def _render_no_matches(entity, pattern, status_filter, narrative, state, config):
    """Handle no-issues case for normal and subjective views."""
    print(colorize(f"No {status_filter} issues matching: {pattern}", "yellow"))
    write_query(
        {
            "command": "show",
            "query": pattern,
            "status_filter": status_filter,
            "total": 0,
            "issues": [],
            "narrative": narrative,
        }
    )
    if entity.kind == "special_view":
        show_subjective_followup(
            state,
            target_strict_score_from_config(config),
        )
    else:
        hint = _detector_names_hint()
        print(
            colorize(
                f"  Try: show <detector>, show <file>, or show subjective. "
                f"Detectors: {hint}",
                "dim",
            )
        )


def _render_subjective_views_guide(entity) -> None:
    """Print related subjective views after subjective output."""
    if entity.kind == "special_view" and entity.pattern.strip().lower() in (
        "subjective",
        "subjective_review",
    ):
        print(colorize("  Related views:", "dim"))
        print(colorize("    `show review --status open`            Per-file design review work items", "dim"))
        print(colorize("    `show subjective_review --status open`  Files needing re-review", "dim"))


__all__ = [
    "_load_dimension_issues",
    "_print_dimension_score",
    "_render_clean_mechanical_dimension",
    "_render_no_matches",
    "_render_subjective_dimension",
    "_render_subjective_views_guide",
]
