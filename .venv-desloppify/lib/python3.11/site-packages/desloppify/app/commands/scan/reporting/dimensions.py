"""Dimension and detector table reporting for scan command."""

from __future__ import annotations

import desloppify.engine._scoring.results.core as scoring_mod
from desloppify import state as state_mod
from desloppify.app.commands.scan.reporting.subjective import (
    SubjectiveFollowup,
    build_subjective_followup,
    flatten_cli_keys,
    show_subjective_paths,
    subjective_entries_for_dimension_keys,
    subjective_integrity_followup,
    subjective_integrity_notice_lines,
    subjective_rerun_command,
)
from desloppify.base.config import DEFAULT_TARGET_STRICT_SCORE
from desloppify.base import registry as registry_mod
from desloppify.base.output.terminal import colorize
from desloppify.engine.planning.scorecard_projection import (
    dimension_cli_key,
    scorecard_dimension_cli_keys,
    scorecard_dimension_rows,
    scorecard_subjective_entries,
)
import desloppify.intelligence.narrative._constants as narrative_constants_mod

from . import presentation as presentation_mod


def show_detector_progress(state: dict):
    """Show per-detector progress bars — the heartbeat of a scan."""
    return presentation_mod.show_detector_progress(
        state,
        state_mod=state_mod,
        narrative_mod=narrative_constants_mod,
        registry_mod=registry_mod,
        colorize_fn=colorize,
    )


def _dimension_bar(score: float, *, bar_len: int = 15) -> str:
    """Render a score bar consistent with scan detector bars."""
    return presentation_mod.dimension_bar(score, colorize_fn=colorize, bar_len=bar_len)


def scorecard_dimension_entries(
    state: dict,
    *,
    dim_scores: dict | None = None,
) -> list[dict]:
    """Return scorecard rows with presentation-friendly metadata."""
    rows = scorecard_dimension_rows(state, dim_scores=dim_scores)
    subjective_by_name = {
        entry["name"]: entry
        for entry in scorecard_subjective_entries(
            state,
            dim_scores=dim_scores,
        )
    }
    entries: list[dict] = []
    for name, data in rows:
        detectors = data.get("detectors", {})
        subjective_meta = subjective_by_name.get(name)
        is_subjective = subjective_meta is not None
        score = float(data.get("score", 0.0))
        strict = float(data.get("strict", score))
        issues = int(data.get("failing", 0))
        checks = int(data.get("checks", 0))
        placeholder = bool(subjective_meta.get("placeholder")) if subjective_meta else False
        not_scanned = bool(
            not is_subjective and not detectors and checks == 0
        )
        carried_forward = bool(
            not is_subjective and data.get("carried_forward")
        )
        dim_key = str(subjective_meta.get("dimension_key", "")) if subjective_meta else ""
        stale = bool(subjective_meta.get("stale")) if subjective_meta else False
        cli_keys = (
            list(subjective_meta.get("cli_keys", []))
            if subjective_meta
            else scorecard_dimension_cli_keys(name, data)
        )
        entries.append(
            {
                "name": name,
                "score": score,
                "strict": strict,
                "failing": issues,
                "checks": checks,
                "subjective": is_subjective,
                "placeholder": placeholder,
                "stale": stale,
                "dimension_key": dim_key,
                "not_scanned": not_scanned,
                "carried_forward": carried_forward,
                "cli_keys": cli_keys,
            }
        )
    return entries


def show_scorecard_subjective_measures(state: dict) -> None:
    """Show canonical scorecard dimensions only (mechanical + subjective)."""
    entries = scorecard_dimension_entries(state)
    if not entries:
        return

    print(colorize(_scorecard_heading(entries), _scorecard_heading_style(entries)))
    for entry in entries:
        if entry.get("not_scanned"):
            print(
                "  "
                + f"{entry['name']:<18} "
                + colorize("─── skipped ───────────────────  (run without --skip-slow)", "yellow")
            )
            continue
        bar = _dimension_bar(entry["score"])
        print(
            "  "
            + f"{entry['name']:<18} {bar} {entry['score']:5.1f}%  "
            + colorize(f"(strict {entry['strict']:5.1f}%)", "dim")
            + _scorecard_entry_suffix(entry)
        )
    stale_keys = [e["dimension_key"] for e in entries if e.get("stale")]
    has_open = any(
        f.get("status") == "open" and not f.get("suppressed")
        for f in (state.get("work_items") or {}).values()
    )
    stale_followup = _stale_subjective_followup(stale_keys, has_open=has_open)
    if stale_followup:
        print(colorize(stale_followup, "yellow"))
    print()


def _scorecard_heading(entries: list[dict]) -> str:
    unscored_subj = [e for e in entries if e.get("subjective") and e.get("placeholder")]
    total_subj = [e for e in entries if e.get("subjective")]
    if not unscored_subj:
        return "  Scorecard dimensions (matches scorecard.png):"
    if len(unscored_subj) == len(total_subj):
        return (
            f"  Scorecard dimensions — all {len(unscored_subj)} subjective dimensions "
            "are [unassessed]:"
        )
    return (
        f"  Scorecard dimensions — {len(unscored_subj)} of {len(total_subj)} "
        "subjective dimensions are [unassessed]:"
    )


def _scorecard_heading_style(entries: list[dict]) -> str:
    return "yellow" if any(e.get("subjective") and e.get("placeholder") for e in entries) else "dim"


def _scorecard_entry_suffix(entry: dict) -> str:
    if entry.get("carried_forward"):
        return colorize("  ⟲ prior scan", "dim")
    if entry.get("placeholder"):
        return colorize("  [unassessed]", "yellow")
    if entry.get("stale"):
        return colorize("  [stale — re-review]", "yellow")
    return ""


def _stale_subjective_followup(stale_keys: list[str], *, has_open: bool) -> str:
    if not stale_keys or has_open:
        return ""
    count = len(stale_keys)
    dims_arg = ",".join(stale_keys)
    return (
        f"  {count} stale subjective dimension{'s' if count != 1 else ''}"
        f" — run `desloppify review --prepare --dimensions {dims_arg}` then follow your runner's review workflow"
    )


def show_score_model_breakdown(state: dict, *, dim_scores: dict | None = None) -> None:
    """Show score recipe and weighted drags so users can see what drives the north star."""
    return presentation_mod.show_score_model_breakdown(
        state,
        scoring_mod=scoring_mod,
        colorize_fn=colorize,
        dim_scores=dim_scores,
    )


def show_dimension_deltas(prev: dict, current: dict):
    """Show which dimensions changed between scans (health and strict)."""
    return presentation_mod.show_dimension_deltas(
        prev,
        current,
        scoring_mod=scoring_mod,
        colorize_fn=colorize,
    )


def show_low_dimension_hints(dim_scores: dict):
    """Show actionable hints for dimensions below 50%."""
    return presentation_mod.show_low_dimension_hints(
        dim_scores,
        scoring_mod=scoring_mod,
        colorize_fn=colorize,
    )


def show_subjective_paths_section(
    state: dict,
    dim_scores: dict,
    *,
    threshold: float = DEFAULT_TARGET_STRICT_SCORE,
) -> None:
    """Show explicit subjective-score improvement paths (coverage vs quality)."""
    return show_subjective_paths(
        state,
        dim_scores,
        colorize_fn=colorize,
        scorecard_subjective_entries_fn=scorecard_subjective_entries,
        threshold=threshold,
    )


__all__ = [
    "SubjectiveFollowup",
    "build_subjective_followup",
    "dimension_cli_key",
    "flatten_cli_keys",
    "scorecard_dimension_entries",
    "subjective_entries_for_dimension_keys",
    "subjective_integrity_followup",
    "subjective_integrity_notice_lines",
    "subjective_rerun_command",
    "show_detector_progress",
    "show_score_model_breakdown",
    "show_scorecard_subjective_measures",
    "show_dimension_deltas",
    "show_low_dimension_hints",
    "show_subjective_paths_section",
]
