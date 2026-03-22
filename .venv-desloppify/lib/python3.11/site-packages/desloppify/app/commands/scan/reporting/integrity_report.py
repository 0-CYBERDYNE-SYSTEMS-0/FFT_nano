"""Post-scan narrative and integrity reporting."""

from __future__ import annotations

from typing import Any

from desloppify import state as state_mod
from desloppify.base.config import DEFAULT_TARGET_STRICT_SCORE
from desloppify.base.output.terminal import colorize
from desloppify.engine._state.schema import StateModel
from desloppify.engine.plan_state import has_living_plan, load_plan
import desloppify.intelligence.narrative.core as narrative_mod


def _coerce_coverage_confidence(value: object, *, default: float = 1.0) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return default
    return max(0.0, min(1.0, parsed))


def _current_scan_coverage(state: StateModel, lang) -> dict[str, Any]:
    scan_coverage = state.get("scan_coverage", {})
    if not isinstance(scan_coverage, dict):
        return {}
    lang_name = getattr(lang, "name", None) if lang is not None else None
    if isinstance(lang_name, str) and lang_name:
        entry = scan_coverage.get(lang_name, {})
        return entry if isinstance(entry, dict) else {}
    return {}


def _coverage_reduction_warnings(state: StateModel, lang) -> list[str]:
    coverage = _current_scan_coverage(state, lang)
    detectors = coverage.get("detectors", {})
    if not isinstance(detectors, dict):
        return []

    warnings: list[str] = []
    for detector, payload in detectors.items():
        if not isinstance(payload, dict):
            continue
        status = str(payload.get("status", "full")).strip().lower()
        confidence = _coerce_coverage_confidence(payload.get("confidence"), default=1.0)
        if status != "reduced" and confidence >= 1.0:
            continue

        summary = str(payload.get("summary", "")).strip()
        impact = str(payload.get("impact", "")).strip()
        remediation = str(payload.get("remediation", "")).strip()
        detector_label = str(detector).strip() or "detector"

        line = f"Coverage reduced ({detector_label}): {summary or 'reduced detector confidence.'}"
        if impact:
            line += f" Repercussion: {impact}"
        if remediation:
            line += f" Fix: {remediation}"
        warnings.append(line)
    return warnings


def _post_scan_warnings(diff: dict[str, Any], state: StateModel, lang) -> list[str]:
    """Build post-scan warning list shown above narrative output."""
    warnings: list[str] = []
    if diff["reopened"] > 5:
        warnings.append(
            f"{diff['reopened']} issues reopened — was a previous fix reverted?"
        )
    if diff["new"] > 10 and diff["auto_resolved"] < 3:
        warnings.append(
            f"{diff['new']} new issues with few resolutions — likely cascading."
        )
    chronic = diff.get("chronic_reopeners", [])
    chronic_count = len(chronic) if isinstance(chronic, list) else chronic
    if chronic_count > 0:
        warnings.append(
            f"⟳ {chronic_count} chronic reopener{'s' if chronic_count != 1 else ''} — "
            "run `desloppify show --chronic` to see them."
        )
    warnings.extend(_coverage_reduction_warnings(state, lang))
    return warnings


def _plan_data_for_narrative() -> dict[str, Any] | None:
    """Return plan payload for narrative context when plan data is present."""
    plan = load_plan()
    if plan.get("queue_order") or plan.get("clusters"):
        return plan
    return None


def show_post_scan_analysis(
    diff: dict[str, Any],
    state: StateModel,
    lang,
    *,
    target_strict_score: float = DEFAULT_TARGET_STRICT_SCORE,
) -> tuple[list[str], dict[str, Any]]:
    """Print critical warnings + headline + pointers. Returns (warnings, narrative)."""
    warnings = _post_scan_warnings(diff, state, lang)

    for warning in warnings:
        print(colorize(f"  {warning}", "yellow"))
    if warnings:
        print()

    plan_data = _plan_data_for_narrative()

    # Single narrative headline
    lang_name = lang.name if lang else None
    narrative = narrative_mod.compute_narrative(
        state,
        context=narrative_mod.NarrativeContext(
            diff=diff,
            lang=lang_name,
            command="scan",
            plan=plan_data,
        ),
    )
    if narrative.get("headline"):
        print(colorize(f"  → {narrative['headline']}", "cyan"))

    has_plan = plan_data is not None or has_living_plan()
    print(colorize("  Run `desloppify next` for the highest-priority item.", "dim"))
    if has_plan:
        print(colorize("  Run `desloppify plan` to see the updated living plan.", "dim"))
    print(colorize("  Run `desloppify status` for the full dashboard.", "dim"))
    print()

    return warnings, narrative


def _should_show_score_integrity(
    *,
    wontfix: int,
    ignored: int,
    ignore_patterns: int,
    confidence_reduced: bool,
) -> bool:
    return not (wontfix <= 5 and ignored <= 0 and ignore_patterns <= 0 and not confidence_reduced)


def _print_dimension_gap_summary(state: StateModel) -> None:
    """Print top dimension strict-vs-lenient gaps."""
    dim_scores = state.get("dimension_scores", {})
    if not isinstance(dim_scores, dict):
        return
    gaps: list[tuple[str, float]] = []
    for name, data in dim_scores.items():
        if not isinstance(data, dict):
            continue
        score = data.get("score", 100)
        strict_value = data.get("strict", score)
        gap = round(score - strict_value, 1)
        if gap > 0:
            gaps.append((name, gap))
    gaps.sort(key=lambda item: -item[1])
    if not gaps:
        return
    top = gaps[:2]
    gap_str = ", ".join(f"{name} (−{gap} pts)" for name, gap in top)
    print(colorize(f"    Biggest gaps: {gap_str}", "dim"))


def _print_wontfix_integrity(
    *,
    wontfix: int,
    wontfix_pct: int,
    strict_gap: float,
    state: StateModel,
) -> None:
    """Print wontfix-focused integrity warning block."""
    if wontfix <= 5:
        return
    if wontfix_pct > 50:
        style = "red"
        msg = (
            f"  ❌ {wontfix} wontfix ({wontfix_pct}%) — over half of issues swept under rug. "
            f"Strict gap: {strict_gap} pts"
        )
    elif wontfix_pct > 25:
        style = "yellow"
        msg = (
            f"  ⚠ {wontfix} wontfix ({wontfix_pct}%) — review whether past "
            "wontfix decisions still hold"
        )
    elif wontfix_pct > 10:
        style = "yellow"
        msg = (
            f"  ⚠ {wontfix} wontfix issues ({wontfix_pct}%) — strict {strict_gap} "
            "pts below lenient"
        )
    else:
        style = "dim"
        msg = f"  {wontfix} wontfix — strict gap: {strict_gap} pts"
    print(colorize(msg, style))
    _print_dimension_gap_summary(state)


def _print_ignore_integrity(*, ignored: int, ignore_patterns: int) -> None:
    """Print ignore-pattern suppression integrity details."""
    if ignored > 0:
        style = "red" if ignore_patterns > 5 or ignored > 100 else "yellow"
        print(
            colorize(
                f"  ⚠ {ignore_patterns} ignore pattern{'s' if ignore_patterns != 1 else ''} "
                f"suppressed {ignored} issue{'s' if ignored != 1 else ''} this scan",
                style,
            )
        )
        print(
            colorize(
                "    Suppressed issues still count against strict and verified scores",
                "dim",
            )
        )
        return
    if ignore_patterns > 0:
        print(
            colorize(
                f"  {ignore_patterns} ignore pattern{'s' if ignore_patterns != 1 else ''} "
                "active (0 issues suppressed this scan)",
                "dim",
            )
        )


def _print_confidence_integrity(score_confidence: dict[str, Any]) -> None:
    """Print reduced score-confidence integrity details."""
    impacted_dimensions = score_confidence.get("dimensions", [])
    detectors = score_confidence.get("detectors", [])
    confidence = _coerce_coverage_confidence(
        score_confidence.get("confidence"),
        default=1.0,
    )
    dim_text = ""
    if isinstance(impacted_dimensions, list) and impacted_dimensions:
        preview = ", ".join(str(item) for item in impacted_dimensions[:3])
        if len(impacted_dimensions) > 3:
            preview += f", +{len(impacted_dimensions) - 3} more"
        dim_text = f" (dimensions: {preview})"
    print(
        colorize(
            f"  ⚠ Score confidence reduced to {confidence * 100:.0f}%{dim_text}",
            "yellow",
        )
    )
    if not isinstance(detectors, list):
        return
    for detector in detectors[:3]:
        if not isinstance(detector, dict):
            continue
        summary = str(detector.get("summary", "")).strip()
        remediation = str(detector.get("remediation", "")).strip()
        if summary:
            print(colorize(f"    - {summary}", "dim"))
        if remediation:
            print(colorize(f"      Fix: {remediation}", "dim"))


def show_score_integrity(state: StateModel, diff: dict[str, Any]) -> None:
    """Show Score Integrity section — surfaces wontfix debt and ignored issues."""
    stats = state.get("stats", {})
    wontfix = stats.get("wontfix", 0)
    ignored = diff.get("ignored", 0)
    ignore_patterns = diff.get("ignore_patterns", 0)
    score_confidence = state.get("score_confidence", {})
    confidence_reduced = (
        isinstance(score_confidence, dict)
        and str(score_confidence.get("status", "full")).lower() == "reduced"
    )
    if not _should_show_score_integrity(
        wontfix=wontfix,
        ignored=ignored,
        ignore_patterns=ignore_patterns,
        confidence_reduced=confidence_reduced,
    ):
        return

    scores = state_mod.score_snapshot(state)
    overall = scores.overall
    strict = scores.strict
    strict_gap = (
        round(overall - strict, 1) if overall is not None and strict is not None else 0
    )

    # Wontfix % of actionable issues (open + wontfix + fixed + auto_resolved + false_positive)
    actionable = (
        stats.get("open", 0)
        + wontfix
        + stats.get("fixed", 0)
        + stats.get("auto_resolved", 0)
        + stats.get("false_positive", 0)
    )
    wontfix_pct = round(wontfix / actionable * 100) if actionable else 0

    print(colorize("  " + "┄" * 2 + " Score Integrity " + "┄" * 37, "dim"))
    _print_wontfix_integrity(
        wontfix=wontfix,
        wontfix_pct=wontfix_pct,
        strict_gap=strict_gap,
        state=state,
    )
    _print_ignore_integrity(ignored=ignored, ignore_patterns=ignore_patterns)
    if confidence_reduced and isinstance(score_confidence, dict):
        _print_confidence_integrity(score_confidence)

    print(colorize("  " + "┄" * 55, "dim"))
    print()


__all__ = ["show_post_scan_analysis", "show_score_integrity"]  # show_score_integrity used by status
