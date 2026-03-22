"""I/O-oriented status render helpers."""

from __future__ import annotations

from dataclasses import dataclass

from desloppify.app.commands.helpers.query import write_query
from desloppify.base.output.terminal import colorize, print_table
from desloppify.engine._state.filtering import open_scope_breakdown
from desloppify.engine._scoring.results.core import compute_health_breakdown


def _status_plan_payload(plan: dict | None) -> dict:
    if not plan:
        return {}
    if not (plan.get("queue_order") or plan.get("clusters") or plan.get("skipped")):
        return {}
    return {
        "plan": {
            "active": True,
            "focus": plan.get("active_cluster"),
            "total_ordered": len(plan.get("queue_order", [])),
            "total_skipped": len(plan.get("skipped", {})),
            "plan_overrides_narrative": True,
        }
    }


def _suppression_style(last_pct: float) -> str:
    if last_pct >= 30:
        return "red"
    if last_pct >= 10:
        return "yellow"
    return "dim"


def show_tier_progress_table(by_tier: dict) -> None:
    """Fallback display when dimension scores are unavailable."""
    rows = []
    for tier_num in [1, 2, 3, 4]:
        ts = by_tier.get(str(tier_num), {})
        t_open = ts.get("open", 0)
        t_fixed = ts.get("fixed", 0) + ts.get("auto_resolved", 0)
        t_wontfix = ts.get("wontfix", 0)
        t_total = sum(ts.values())
        strict_pct = round((t_fixed + ts.get("false_positive", 0)) / t_total * 100) if t_total else 100
        bar_len = 20
        filled = round(strict_pct / 100 * bar_len)
        bar = colorize("█" * filled, "green") + colorize("░" * (bar_len - filled), "dim")
        rows.append(
            [
                f"Tier {tier_num}",
                bar,
                f"{strict_pct}%",
                str(t_open),
                str(t_fixed),
                str(t_wontfix),
            ]
        )
    print_table(
        ["Tier", "Strict Progress", "%", "Open", "Fixed", "Debt"],
        rows,
        [40, 22, 5, 6, 6, 6],
    )


def status_next_command(narrative: dict) -> str:
    actions = narrative.get("actions", [])
    return actions[0]["command"] if actions else "desloppify next --count 20"


@dataclass(frozen=True)
class StatusQueryRequest:
    state: dict
    stats: dict
    by_tier: dict
    dim_scores: dict
    scorecard_dims: list[dict]
    subjective_measures: list[dict]
    suppression: dict
    narrative: dict
    ignores: list[str]
    overall_score: float | None
    objective_score: float | None
    strict_score: float | None
    verified_strict_score: float | None
    plan: dict | None = None


def write_status_query(request: StatusQueryRequest) -> None:
    state = request.state
    stats = request.stats
    by_tier = request.by_tier
    dim_scores = request.dim_scores
    scorecard_dims = request.scorecard_dims
    subjective_measures = request.subjective_measures
    suppression = request.suppression
    narrative = request.narrative
    ignores = request.ignores
    overall_score = request.overall_score
    objective_score = request.objective_score
    strict_score = request.strict_score
    verified_strict_score = request.verified_strict_score
    plan = request.plan

    issues = (state.get("work_items") or state.get("issues", {}))
    open_scope = (
        open_scope_breakdown(issues, state.get("scan_path"))
        if isinstance(issues, dict)
        else None
    )
    write_query(
        {
            "command": "status",
            "overall_score": overall_score,
            "objective_score": objective_score,
            "strict_score": strict_score,
            "verified_strict_score": verified_strict_score,
            "dimension_scores": dim_scores,
            "scorecard_dimensions": scorecard_dims,
            "subjective_measures": subjective_measures,
            "stats": stats,
            "scan_count": state.get("scan_count", 0),
            "last_scan": state.get("last_scan"),
            "scan_metadata": state.get("scan_metadata", {}),
            "by_tier": by_tier,
            "ignores": ignores,
            "suppression": suppression,
            "potentials": state.get("potentials"),
            "codebase_metrics": state.get("codebase_metrics"),
            "open_scope": open_scope,
            "score_breakdown": compute_health_breakdown(dim_scores) if dim_scores else None,
            "next_command": status_next_command(narrative),
            "narrative": narrative,
            **_status_plan_payload(plan),
        }
    )


def _last_scan_suppression_line(suppression: dict) -> tuple[str, str] | None:
    last_ignored = int(suppression.get("last_ignored", 0) or 0)
    last_raw = int(suppression.get("last_raw_issues", 0) or 0)
    last_pct = float(suppression.get("last_suppressed_pct", 0.0) or 0.0)
    if last_raw > 0:
        return (
            f"  Ignore suppression (last scan): {last_ignored}/{last_raw} issues hidden ({last_pct:.1f}%)",
            _suppression_style(last_pct),
        )
    if suppression.get("recent_scans", 0):
        return ("  Ignore suppression (last scan): 0 issues hidden", "dim")
    return None


def _recent_suppression_line(suppression: dict) -> str | None:
    recent_scans = int(suppression.get("recent_scans", 0) or 0)
    recent_raw = int(suppression.get("recent_raw_issues", 0) or 0)
    if recent_scans <= 1 or recent_raw <= 0:
        return None
    recent_ignored = int(suppression.get("recent_ignored", 0) or 0)
    recent_pct = float(suppression.get("recent_suppressed_pct", 0.0) or 0.0)
    return (
        f"    Recent ({recent_scans} scans): {recent_ignored}/{recent_raw} issues hidden "
        f"({recent_pct:.1f}%)"
    )


def show_ignore_summary(ignores: list[str], suppression: dict) -> None:
    """Show ignore list plus suppression accountability from recent scans."""
    print(colorize(f"\n  Ignore list ({len(ignores)}):", "dim"))
    for pattern in ignores[:10]:
        print(colorize(f"    {pattern}", "dim"))

    last_scan_line = _last_scan_suppression_line(suppression)
    if last_scan_line is not None:
        text, style = last_scan_line
        print(colorize(text, style))

    recent_line = _recent_suppression_line(suppression)
    if recent_line is not None:
        print(colorize(recent_line, "dim"))


__all__ = [
    "StatusQueryRequest",
    "show_ignore_summary",
    "show_tier_progress_table",
    "status_next_command",
    "write_status_query",
]
