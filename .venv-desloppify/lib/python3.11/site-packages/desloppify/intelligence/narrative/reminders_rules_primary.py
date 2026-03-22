"""Primary reminder rule helpers used by narrative reminders."""

from __future__ import annotations

import logging
from datetime import UTC
from datetime import datetime as _dt

from desloppify.base.output.fallbacks import log_best_effort_failure
from desloppify.intelligence.narrative._constants import _FEEDBACK_URL, STRUCTURAL_MERGE
from desloppify.state_io import StateModel

logger = logging.getLogger(__name__)


def _compute_fp_rates(issues: dict) -> dict[tuple[str, str], float]:
    """Compute false_positive rate per (detector, zone) from historical issues."""
    counts: dict[tuple[str, str], dict[str, int]] = {}
    for issue in issues.values():
        detector = issue.get("detector", "unknown")
        if detector in STRUCTURAL_MERGE:
            detector = "structural"
        zone = issue.get("zone", "production")
        key = (detector, zone)
        if key not in counts:
            counts[key] = {"total": 0, "fp": 0}
        counts[key]["total"] += 1
        if issue.get("status") == "false_positive":
            counts[key]["fp"] += 1

    rates: dict[tuple[str, str], float] = {}
    for key, stat in counts.items():
        if stat["total"] >= 5 and stat["fp"] > 0:
            rates[key] = stat["fp"] / stat["total"]
    return rates


def _auto_fixer_reminder(actions: list[dict]) -> list[dict]:
    auto_fix_actions = [action for action in actions if action.get("type") == "auto_fix"]
    if not auto_fix_actions:
        return []
    total = sum(action.get("count", 0) for action in auto_fix_actions)
    if total <= 0:
        return []
    first_cmd = auto_fix_actions[0].get("command", "desloppify autofix <fixer> --dry-run")
    return [
        {
            "type": "auto_fixers_available",
            "message": f"{total} issues are auto-fixable. Run `{first_cmd}`.",
            "command": first_cmd,
        }
    ]


def _rescan_needed_reminder(command: str | None) -> list[dict]:
    if command not in {"autofix", "resolve", "suppress"}:
        return []
    return [
        {
            "type": "rescan_needed",
            "message": "Rescan to verify — cascading effects may create new issues.",
            "command": "desloppify scan",
        }
    ]


def _badge_reminder(strict_score: float | None, badge: dict) -> list[dict]:
    eligible_for_badge = (
        strict_score is not None
        and strict_score >= 90
        and badge.get("generated")
        and not badge.get("in_readme")
    )
    if not eligible_for_badge:
        return []
    badge_path = str(badge.get("path") or "scorecard.png")
    return [
        {
            "type": "badge_recommendation",
            "message": (
                "Score is above 90! Add the scorecard to your README: "
                f'<img src="{badge_path}" width="100%">'
            ),
            "command": None,
        }
    ]


def _wontfix_debt_reminders(
    state: StateModel,
    debt: dict,
    command: str | None,
) -> list[dict]:
    reminders: list[dict] = []
    if debt.get("trend") == "growing":
        reminders.append(
            {
                "type": "wontfix_growing",
                "message": (
                    "Wontfix debt is growing. Review stale decisions: "
                    "`desloppify show --status wontfix`."
                ),
                "command": "desloppify show --status wontfix",
            }
        )

    scan_count = len(state.get("scan_history", []))
    if scan_count < 20 or command != "scan":
        return reminders

    stale_wontfix = []
    for issue in (state.get("work_items") or state.get("issues", {})).values():
        if issue.get("status") != "wontfix":
            continue
        resolved_at = issue.get("resolved_at")
        if not resolved_at:
            continue
        try:
            age_days = (_dt.now(UTC) - _dt.fromisoformat(resolved_at)).days
        except (ValueError, TypeError) as exc:
            log_best_effort_failure(logger, f"parse wontfix timestamp {resolved_at!r}", exc)
            continue
        if age_days > 60:
            stale_wontfix.append(issue)

    if stale_wontfix:
        reminders.append(
            {
                "type": "wontfix_stale",
                "message": (
                    f"{len(stale_wontfix)} wontfix item(s) are >60 days old. "
                    "Has anything changed? Review with: "
                    '`desloppify show "*" --status wontfix`'
                ),
                "command": 'desloppify show "*" --status wontfix',
            }
        )
    return reminders


def _ignore_suppression_reminder(state: StateModel) -> list[dict]:
    """Nudge when ignores/suppression are high enough to mask signal quality."""
    integrity = state.get("ignore_integrity", {}) or {}
    ignored = int(integrity.get("ignored", 0) or 0)
    suppressed_pct = float(integrity.get("suppressed_pct", 0.0) or 0.0)
    if ignored < 10 and suppressed_pct < 30.0:
        return []
    return [
        {
            "type": "ignore_suppression_high",
            "message": (
                f"Ignore suppression is high ({ignored} ignored, {suppressed_pct:.1f}% "
                "suppressed). Revisit broad ignore patterns and resolve stale suppressions."
            ),
            "command": "desloppify show --status wontfix",
        }
    ]


def _stagnation_reminders(dimensions: dict) -> list[dict]:
    reminders: list[dict] = []
    for dim in dimensions.get("stagnant_dimensions", []):
        strict = dim.get("strict", 0)
        if strict >= 99:
            message = (
                f"{dim['name']} has been at {strict}% for {dim['stuck_scans']} scans. "
                "The remaining items may be worth marking as wontfix if they're intentional."
            )
        else:
            message = (
                f"{dim['name']} has been stuck at {strict}% for {dim['stuck_scans']} scans. "
                "Try tackling it from a different angle — run `desloppify next` "
                "to find the right entry point."
            )
        reminders.append(
            {
                "type": "stagnant_nudge",
                "message": message,
                "command": None,
            }
        )
    return reminders


def _dry_run_reminder(actions: list[dict]) -> list[dict]:
    if not actions or actions[0].get("type") != "auto_fix":
        return []
    return [
        {
            "type": "dry_run_first",
            "message": "Always --dry-run first, review changes, then apply.",
            "command": None,
        }
    ]


def _zone_classification_reminder(state: StateModel) -> list[dict]:
    zone_dist = state.get("zone_distribution")
    if not zone_dist:
        return []
    non_prod = sum(value for key, value in zone_dist.items() if key != "production")
    if non_prod <= 0:
        return []
    total = sum(zone_dist.values())
    parts = [
        f"{value} {key}"
        for key, value in sorted(zone_dist.items())
        if key != "production" and value > 0
    ]
    return [
        {
            "type": "zone_classification",
            "message": (
                f"{non_prod} of {total} files classified as non-production "
                f"({', '.join(parts)}). Override with `desloppify zone set <file> production` "
                "if any are misclassified."
            ),
            "command": "desloppify zone show",
        }
    ]


def _fp_calibration_reminders(fp_rates: dict[tuple[str, str], float]) -> list[dict]:
    reminders: list[dict] = []
    for (detector, zone), rate in fp_rates.items():
        if rate <= 0.3:
            continue
        pct = round(rate * 100)
        reminders.append(
            {
                "type": f"fp_calibration_{detector}_{zone}",
                "message": (
                    f"{pct}% of {detector} issues in {zone} zone are false positives. "
                    f"Consider reviewing detection rules for {zone} files."
                ),
                "command": None,
            }
        )
    return reminders


def _feedback_base_url() -> str:
    """Expose feedback URL for stable import/use across reminder helpers."""
    return _FEEDBACK_URL


__all__ = [
    "_auto_fixer_reminder",
    "_badge_reminder",
    "_compute_fp_rates",
    "_dry_run_reminder",
    "_feedback_base_url",
    "_fp_calibration_reminders",
    "_ignore_suppression_reminder",
    "_rescan_needed_reminder",
    "_stagnation_reminders",
    "_wontfix_debt_reminders",
    "_zone_classification_reminder",
]
