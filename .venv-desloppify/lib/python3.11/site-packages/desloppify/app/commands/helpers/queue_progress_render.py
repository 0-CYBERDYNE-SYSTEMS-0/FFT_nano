"""Queue progress rendering helpers."""

from __future__ import annotations


def format_plan_delta(live: float, frozen: float) -> str:
    """Format plan-start vs live delta, or '' if below threshold."""
    if abs(live - frozen) < 0.05:
        return ""
    delta = round(live - frozen, 1)
    return f"{'+' if delta > 0 else ''}{delta:.1f}"


def format_queue_headline(breakdown) -> str:
    """The one-line Queue summary. Same format everywhere."""
    count = breakdown.queue_total
    label = f"Queue: {count} item{'s' if count != 1 else ''}"

    segments: list[str] = []
    if breakdown.workflow > 0:
        segments.append(
            f"{breakdown.workflow} planning step{'s' if breakdown.workflow != 1 else ''}"
        )
    if breakdown.plan_ordered > 0:
        segments.append(f"{breakdown.plan_ordered} planned")
    if getattr(breakdown, "stale_plan_ordered", 0) > 0:
        stale = breakdown.stale_plan_ordered
        segments.append(f"{stale} stale tracked")
    if breakdown.skipped > 0:
        segments.append(f"{breakdown.skipped} skipped")
    if breakdown.subjective > 0:
        segments.append(f"{breakdown.subjective} subjective")
    if segments:
        detail = " \u00b7 ".join(segments)
        return f"{label} ({detail})"
    return label


def format_queue_block(
    breakdown,
    *,
    frozen_score: float | None = None,
    live_score: float | None = None,
) -> list[tuple[str, str]]:
    """Full queue block: focus banner + queue line + contextual hints."""
    lines: list[tuple[str, str]] = []

    if breakdown.focus_cluster:
        focus_line = (
            f"  Focus: `{breakdown.focus_cluster}` "
            f"\u2014 {breakdown.focus_cluster_count}/{breakdown.focus_cluster_total}"
            f" items remaining"
        )
        lines.append((focus_line, "cyan"))

    if frozen_score is not None:
        delta_str = format_plan_delta(live_score, frozen_score) if live_score is not None else ""
        if delta_str:
            lines.append(
                (
                    f"  Score: strict {live_score:.1f}/100 (plan start: {frozen_score:.1f}, {delta_str})",
                    "cyan",
                )
            )
        else:
            lines.append(
                (f"  Score (frozen at plan start): strict {frozen_score:.1f}/100", "cyan")
            )

    lines.append((f"  {format_queue_headline(breakdown)}", "bold"))

    if getattr(breakdown, "stale_plan_ordered", 0) > 0:
        stale = breakdown.stale_plan_ordered
        noun = "item" if stale == 1 else "items"
        verb = "is" if stale == 1 else "are"
        lines.append(
            (
                f"  Note: {stale} plan-tracked {noun} "
                f"{verb} stale and not part of the live queue.",
                "yellow",
            )
        )

    if breakdown.focus_cluster:
        lines.append(
            (
                f"  Unfocus: `desloppify plan focus --clear`"
                f" \u00b7 Cluster details: `desloppify next --cluster {breakdown.focus_cluster} --count 10`",
                "dim",
            )
        )
    elif (
        breakdown.plan_ordered > 0
        or getattr(breakdown, "stale_plan_ordered", 0) > 0
        or breakdown.skipped > 0
    ):
        lines.append(
            (
                "  Details: `desloppify plan queue`"
                " \u00b7 Skip: `desloppify plan skip <id>`",
                "dim",
            )
        )
    else:
        lines.append(("  Start planning: `desloppify plan`", "dim"))

    return lines


__all__ = ["format_plan_delta", "format_queue_block", "format_queue_headline"]
