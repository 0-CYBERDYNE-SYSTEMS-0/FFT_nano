"""Contextual reminders with decay."""

from __future__ import annotations

from desloppify.intelligence.narrative.reminders_rules_followup import (
    _apply_decay,
    _decorate_reminder_metadata,
    _feedback_reminder,
    _report_scores_reminder,
    _review_queue_reminders,
    _review_staleness_reminder,
    _stale_assessment_reminder,
)
from desloppify.intelligence.narrative.reminders_rules_primary import (
    _auto_fixer_reminder,
    _badge_reminder,
    _compute_fp_rates,
    _dry_run_reminder,
    _fp_calibration_reminders,
    _ignore_suppression_reminder,
    _rescan_needed_reminder,
    _stagnation_reminders,
    _wontfix_debt_reminders,
    _zone_classification_reminder,
)
from desloppify.engine._state.filtering import path_scoped_issues
from desloppify.state_io import StateModel
from desloppify.state_scoring import score_snapshot


def compute_reminders(
    state: StateModel,
    lang: str | None,
    phase: str,
    debt: dict,
    actions: list[dict],
    dimensions: dict,
    badge: dict,
    command: str | None,
    config: dict | None = None,
) -> tuple[list[dict], dict]:
    """Compute context-specific reminders, suppressing those shown too many times."""
    del lang  # Reserved for future language-specific rules.

    strict_score = score_snapshot(state).strict
    reminder_history = state.get("reminder_history", {})
    scoped_issues = path_scoped_issues(
        (state.get("work_items") or state.get("issues", {})), state.get("scan_path")
    )
    fp_rates = _compute_fp_rates(scoped_issues)

    reminders: list[dict] = []
    reminders.extend(_report_scores_reminder(command))
    reminders.extend(_auto_fixer_reminder(actions))
    reminders.extend(_rescan_needed_reminder(command))
    reminders.extend(_badge_reminder(strict_score, badge))
    reminders.extend(_wontfix_debt_reminders(state, debt, command))
    reminders.extend(_ignore_suppression_reminder(state))
    reminders.extend(_stagnation_reminders(dimensions))
    reminders.extend(_dry_run_reminder(actions))
    reminders.extend(_zone_classification_reminder(state))
    reminders.extend(_fp_calibration_reminders(fp_rates))
    reminders.extend(
        _review_queue_reminders(state, scoped_issues, command, strict_score)
    )
    reminders.extend(_stale_assessment_reminder(state))
    reminders.extend(_review_staleness_reminder(state, config))
    reminders.extend(_feedback_reminder(state, phase, command, fp_rates))

    reminders = _decorate_reminder_metadata(reminders)
    return _apply_decay(reminders, reminder_history)


__all__ = ["compute_reminders"]
