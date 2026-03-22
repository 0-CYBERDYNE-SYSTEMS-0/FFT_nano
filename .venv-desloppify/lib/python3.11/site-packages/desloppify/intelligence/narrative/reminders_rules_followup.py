"""Follow-up reminder helpers for review lifecycle and reminder decay."""

from __future__ import annotations

import logging
from datetime import UTC
from datetime import datetime as _dt

from desloppify.base.output.fallbacks import log_best_effort_failure
from desloppify.intelligence.narrative._constants import _REMINDER_DECAY_THRESHOLD
from desloppify.intelligence.narrative.reminders_rules_primary import _feedback_base_url
from desloppify.state_io import StateModel

logger = logging.getLogger(__name__)


def _review_queue_reminders(
    state: StateModel,
    scoped_issues: dict,
    command: str | None,
    strict_score: float | None,
) -> list[dict]:
    reminders: list[dict] = []
    open_review = [
        issue
        for issue in scoped_issues.values()
        if issue.get("status") == "open" and issue.get("detector") == "review"
    ]
    if open_review:
        uninvestigated = [
            issue
            for issue in open_review
            if not issue.get("detail", {}).get("investigation")
        ]
        if uninvestigated:
            reminders.append(
                {
                    "type": "review_issues_pending",
                    "message": (
                        f"{len(uninvestigated)} review work item(s) need investigation. "
                        "Run `desloppify show review --status open` to see the work queue."
                    ),
                    "command": "desloppify show review --status open",
                }
            )

    if command == "resolve" and state.get("subjective_assessments"):
        reminders.append(
            {
                "type": "rereview_needed",
                "message": (
                    "Subjective results may be stale after resolve. Re-run "
                    "`desloppify review --prepare` to refresh, or reset with "
                    "`desloppify scan --reset-subjective` before a clean rerun."
                ),
                "command": "desloppify review --prepare",
            }
        )

    review_cache = state.get("review_cache", {})
    if not review_cache.get("files"):
        current_strict = strict_score or 0
        if current_strict >= 80:
            reminders.append(
                {
                    "type": "review_not_run",
                    "message": (
                        "Mechanical checks look good! Run a subjective design review "
                        "to catch issues linters miss: desloppify review --prepare"
                    ),
                    "command": "desloppify review --prepare",
                }
            )

    return reminders


def _has_open_issues(state: StateModel) -> bool:
    """True when any non-suppressed open issues remain in the queue."""
    issues = state.get("work_items") or state.get("issues", {})
    return any(
        issue.get("status") == "open" and not issue.get("suppressed")
        for issue in issues.values()
    )


def _stale_assessment_reminder(state: StateModel) -> list[dict]:
    """Nudge when mechanical changes have staled subjective assessments."""
    if _has_open_issues(state):
        return []
    assessments = state.get("subjective_assessments") or {}
    stale_dims = [
        dim_key
        for dim_key, assessment in assessments.items()
        if isinstance(assessment, dict) and assessment.get("needs_review_refresh")
    ]
    if not stale_dims:
        return []
    dims_arg = ",".join(stale_dims[:10])
    return [
        {
            "type": "stale_assessments",
            "message": (
                f"{len(stale_dims)} subjective dimension"
                f"{'s' if len(stale_dims) != 1 else ''} stale after mechanical changes "
                f"— re-review with: `desloppify review --prepare --dimensions {dims_arg}`"
            ),
            "command": f"desloppify review --prepare --dimensions {dims_arg}",
        }
    ]


def _review_staleness_reminder(state: StateModel, config: dict | None) -> list[dict]:
    review_max_age = (config or {}).get("review_max_age_days", 30)
    review_cache = state.get("review_cache", {})
    if review_max_age <= 0 or not review_cache.get("files"):
        return []
    try:
        oldest_str = min(
            review["reviewed_at"]
            for review in review_cache["files"].values()
            if review.get("reviewed_at")
        )
        oldest = _dt.fromisoformat(oldest_str)
        age_days = (_dt.now(UTC) - oldest).days
    except (ValueError, TypeError) as exc:
        log_best_effort_failure(logger, "parse oldest review timestamp", exc)
        return []
    if age_days <= review_max_age:
        return []
    return [
        {
            "type": "review_stale",
            "message": f"Design review is {age_days} days old — run: desloppify review --prepare",
            "command": "desloppify review --prepare",
        }
    ]


def _feedback_reminder(
    state: StateModel,
    phase: str,
    command: str | None,
    fp_rates: dict[tuple[str, str], float],
) -> list[dict]:
    scan_count = len(state.get("scan_history", []))
    if scan_count < 2 or command != "scan":
        return []
    high_fp_dets = [
        detector for (detector, _zone), rate in fp_rates.items() if rate > 0.3
    ]
    feedback_url = _feedback_base_url()
    if high_fp_dets:
        nudge_msg = (
            f"Some detectors have high false-positive rates ({', '.join(high_fp_dets)}). "
            f"If patterns are being misclassified, file an issue at {feedback_url} "
            "with the file and expected behavior — it helps calibrate detection for everyone."
        )
    elif phase == "stagnation":
        nudge_msg = (
            "Score has plateaued — if you suspect desloppify is missing patterns "
            f"or not capturing something it should, file an issue at {feedback_url} "
            "describing what you expected. Gaps in detection are a common cause of stagnation."
        )
    else:
        nudge_msg = (
            "If you notice patterns desloppify doesn't detect, false positives, "
            f"or issues that seem off, file an issue at {feedback_url} — include the file "
            "and what you expected. It helps improve the tool."
        )
    return [
        {
            "type": "feedback_nudge",
            "message": nudge_msg,
            "command": None,
        }
    ]


_REMINDER_METADATA: dict[str, tuple[int, str]] = {
    "rescan_needed": (1, "high"),
    "ignore_suppression_high": (1, "high"),
    "review_issues_pending": (1, "high"),
    "rereview_needed": (1, "high"),
    "wontfix_growing": (2, "medium"),
    "wontfix_stale": (2, "medium"),
    "stagnant_nudge": (2, "medium"),
    "review_stale": (2, "medium"),
    "stale_assessments": (2, "medium"),
    "auto_fixers_available": (2, "medium"),
    "zone_classification": (2, "medium"),
    "fp_calibration": (2, "medium"),
    "badge_recommendation": (3, "low"),
    "dry_run_first": (3, "low"),
    "feedback_nudge": (3, "low"),
    "review_not_run": (3, "low"),
    "report_scores": (3, "low"),
}


def _decorate_reminder_metadata(reminders: list[dict]) -> list[dict]:
    """Attach stable priority/severity metadata and sort by priority."""
    decorated: list[dict] = []
    for reminder in reminders:
        reminder_type = str(reminder.get("type", ""))
        key = reminder_type
        if reminder_type.startswith("fp_calibration_"):
            key = "fp_calibration"
        priority, severity = _REMINDER_METADATA.get(key, (3, "low"))
        clone = dict(reminder)
        clone.setdefault("priority", priority)
        clone.setdefault("severity", severity)
        decorated.append(clone)
    decorated.sort(key=lambda item: (int(item.get("priority", 3)), str(item.get("type", ""))))
    return decorated


def _report_scores_reminder(command: str | None) -> list[dict]:
    if command != "scan":
        return []
    return [
        {
            "type": "report_scores",
            "message": (
                "ALWAYS share ALL scores with the user: overall, objective, and strict, "
                "plus every dimension score (lenient + strict), including subjective dimensions. "
                "The goal is to maximize strict scores."
            ),
            "command": None,
            "no_decay": True,
        }
    ]


def _apply_decay(reminders: list[dict], reminder_history: dict) -> tuple[list[dict], dict]:
    filtered: list[dict] = []
    for reminder in reminders:
        if reminder.get("no_decay"):
            filtered.append(reminder)
            continue
        count = reminder_history.get(reminder["type"], 0)
        if count < _REMINDER_DECAY_THRESHOLD:
            filtered.append(reminder)

    updated_history = dict(reminder_history)
    for reminder in filtered:
        updated_history[reminder["type"]] = updated_history.get(reminder["type"], 0) + 1
    return filtered, updated_history


__all__ = [
    "_apply_decay",
    "_decorate_reminder_metadata",
    "_feedback_reminder",
    "_report_scores_reminder",
    "_review_queue_reminders",
    "_review_staleness_reminder",
    "_stale_assessment_reminder",
]
