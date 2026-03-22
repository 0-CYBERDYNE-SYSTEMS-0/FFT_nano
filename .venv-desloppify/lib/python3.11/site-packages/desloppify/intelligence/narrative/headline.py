"""Headline computation for terminal display."""

from __future__ import annotations

from ._constants import _history_strict


def compute_headline(
    phase: str,
    dimensions: dict,
    debt: dict,
    milestone: str | None,
    diff: dict | None,
    obj_strict: float | None,
    obj_score: float | None,
    stats: dict,
    history: list[dict],
    open_by_detector: dict | None = None,
    scan_source: str | None = None,
) -> str | None:
    """Compute one computed sentence for terminal display."""
    # Security callout prefix — prepended to any headline when security issues exist
    security_count = (open_by_detector or {}).get("security", 0)
    security_prefix = ""
    if security_count > 0:
        s = "s" if security_count != 1 else ""
        security_prefix = f"\u26a0 {security_count} security issue{s} — review before other cleanup. "

    # Review issues callout — all phases
    review_count = (open_by_detector or {}).get("review", 0)
    review_suffix = ""
    if review_count > 0:
        s = "s" if review_count != 1 else ""
        uninvestigated = (open_by_detector or {}).get("review_uninvestigated", 0)
        if uninvestigated > 0:
            review_suffix = (
                f" ({review_count} review work item{s} \u2014 run `desloppify show review --status open`)"
            )
        else:
            review_suffix = f" ({review_count} review work item{s} pending)"

    headline = _compute_headline_inner(
        phase,
        dimensions,
        debt,
        milestone,
        diff,
        obj_strict,
        obj_score,
        stats,
        history,
        scan_source=scan_source,
    )

    if headline is None and not security_prefix and not review_suffix:
        return None
    parts = security_prefix + (headline or "") + review_suffix
    return parts or None

def _compute_headline_inner(
    phase: str,
    dimensions: dict,
    debt: dict,
    milestone: str | None,
    diff: dict | None,
    strict_score: float | None,
    overall_score: float | None,
    stats: dict,
    history: list[dict],
    *,
    scan_source: str | None = None,
) -> str | None:
    """Compute the base headline (without security prefix)."""
    if scan_source == "plan_reconstruction":
        return "Scan metrics unavailable. Issue inventory reconstructed from saved plan."

    # Milestone takes priority
    if milestone:
        return milestone

    # First scan framing
    if phase == "first_scan":
        dims = len(dimensions.get("lowest_dimensions", [])) if dimensions else 0
        open_count = stats.get("open", 0)
        if dims:
            return f"First scan complete. {open_count} open issues across {dims} dimensions."
        return f"First scan complete. {open_count} issues detected."

    # Regression — acknowledge that drops after fixes are normal
    if phase == "regression":
        prev = _history_strict(history[-2])
        curr = _history_strict(history[-1])
        if prev is not None and curr is not None:
            drop = round(prev - curr, 1)
            return (
                f"Score shifted {drop} pts — this is normal after structural changes. "
                f"Rescan after your next fix to see the real trend."
            )

    # Stagnation — suggest which dimension to focus on
    if phase == "stagnation":
        if strict_score is not None:
            stuck_scans = min(len(history), 5)
            wontfix = debt.get("wontfix_count", 0)
            # Point to the specific dimension dragging things down
            lowest_dims = dimensions.get("lowest_dimensions", [])
            if lowest_dims:
                dim = lowest_dims[0]
                if wontfix > 0:
                    return (
                        f"Score plateaued at {strict_score:.1f} for {stuck_scans} scans. "
                        f"{dim['name']} ({dim['strict']}%) is where the breakthrough is. "
                        f"{wontfix} wontfix items may also be worth revisiting."
                    )
                return (
                    f"Score plateaued at {strict_score:.1f} for {stuck_scans} scans. "
                    f"{dim['name']} ({dim['strict']}%) is where the breakthrough is."
                )
            if wontfix > 0:
                return (
                    f"Score plateaued at {strict_score:.1f} for {stuck_scans} scans. "
                    f"{wontfix} wontfix items — revisit?"
                )
            return (
                f"Score plateaued at {strict_score:.1f} for {stuck_scans} scans. "
                f"Try tackling a different dimension."
            )

    # Leverage point (lowest dimension with biggest impact)
    lowest = dimensions.get("lowest_dimensions", [])
    if lowest and lowest[0].get("impact", 0) > 0:
        top = lowest[0]
        return (
            f"{top['name']} is your biggest lever: "
            f"{top['failing']} items → +{top['impact']} pts"
        )

    # Gap callout
    if debt.get("overall_gap", 0) > 5.0:
        gap = debt["overall_gap"]
        worst = debt.get("worst_dimension", "")
        if strict_score is not None and overall_score is not None:
            return (
                f"Strict {strict_score:.1f} vs overall {overall_score:.1f} — "
                f"{gap} pts of wontfix debt, mostly in {worst}"
            )

    # Maintenance phase
    if phase == "maintenance":
        return (
            f"Strict {strict_score:.1f}/100 — maintenance mode. Watch for regressions."
        )

    # Middle grind fallback — point toward next item
    if phase == "middle_grind":
        open_count = stats.get("open", 0)
        if lowest:
            top = lowest[0]
            return (
                f"{open_count} issues open. {top['name']} ({top['strict']}%) "
                f"needs attention — run `desloppify next` to start."
            )
        if open_count > 0:
            return f"{open_count} issues open. Run `desloppify next` for the highest-priority item."

    # Early momentum fallback — celebrate trajectory
    if phase == "early_momentum" and strict_score is not None:
        open_count = stats.get("open", 0)
        return f"Score {strict_score:.1f}/100 with {open_count} issues open. Keep the momentum going."

    return None
