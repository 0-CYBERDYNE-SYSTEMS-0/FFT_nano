"""Narrative orchestrator — compute_narrative() entry point."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from desloppify.intelligence.narrative.action_engine import compute_actions
from desloppify.intelligence.narrative.action_models import (
    ActionContext,
)
from desloppify.intelligence.narrative.action_tools import compute_tools
from desloppify.intelligence.narrative.dimensions import (
    _analyze_debt,
    _analyze_dimensions,
)
from desloppify.intelligence.narrative.headline import compute_headline
from desloppify.intelligence.narrative.phase import detect_milestone, detect_phase
from desloppify.intelligence.narrative.reminders import compute_reminders
from desloppify.intelligence.narrative.signals import (
    compute_badge_status as _compute_badge_status,
)
from desloppify.intelligence.narrative.signals import (
    compute_primary_action as _compute_primary_action,
)
from desloppify.intelligence.narrative.signals import (
    compute_risk_flags as _compute_risk_flags,
)
from desloppify.intelligence.narrative.signals import (
    compute_strict_target as _compute_strict_target,
)
from desloppify.intelligence.narrative.signals import (
    compute_verification_step as _compute_verification_step,
)
from desloppify.intelligence.narrative.signals import (
    compute_why_now as _compute_why_now,
)
from desloppify.intelligence.narrative.signals import (
    count_open_by_detector as _count_open_by_detector,
)
from desloppify.intelligence.narrative.signals import (
    history_for_lang as _history_for_lang,
)
from desloppify.intelligence.narrative.signals import (
    scoped_issues as _scoped_issues,
)
from desloppify.intelligence.narrative.signals import (
    score_snapshot as _score_snapshot,
)
from desloppify.intelligence.narrative.strategy_engine import compute_strategy
from desloppify.intelligence.narrative.types import (
    NarrativeResult,
)
from desloppify.state_io import StateModel, scan_source


@dataclass(frozen=True)
class NarrativeContext:
    """Context inputs for narrative computation."""

    command: str
    diff: dict[str, Any] | None = None
    lang: str | None = None
    config: dict[str, Any] | None = None
    plan: dict[str, Any] | None = None


def compute_narrative(
    state: StateModel,
    context: NarrativeContext | None = None,
) -> NarrativeResult:
    """Compute structured narrative context from state data."""
    resolved_context = context or NarrativeContext(command="")

    diff = resolved_context.diff
    lang = resolved_context.lang
    command = resolved_context.command
    config = resolved_context.config
    plan = resolved_context.plan

    raw_history = state.get("scan_history", [])
    history = _history_for_lang(raw_history, lang)
    dim_scores = state.get("dimension_scores", {})
    stats = state.get("stats", {})
    strict_score, overall_score = _score_snapshot(state)
    issues = _scoped_issues(state)

    by_detector = _count_open_by_detector(issues)
    badge = _compute_badge_status()

    phase = detect_phase(history, strict_score)
    dimensions = _analyze_dimensions(dim_scores, history, state)
    debt = _analyze_debt(dim_scores, issues, history)
    milestone = detect_milestone(state, None, history)
    clusters = plan.get("clusters") if isinstance(plan, dict) else None
    action_context = ActionContext(
        by_detector=by_detector,
        dimension_scores=dim_scores,
        state=state,
        debt=debt,
        lang=lang,
        clusters=clusters,
    )
    actions = [dict(action) for action in compute_actions(action_context)]
    strategy = compute_strategy(issues, by_detector, actions, phase, lang)
    tools = dict(compute_tools(by_detector, state, lang, badge))
    primary_action = _compute_primary_action(actions)
    why_now = _compute_why_now(phase, strategy, primary_action)
    verification_step = _compute_verification_step(command)
    risk_flags = _compute_risk_flags(state, debt)
    strict_target = _compute_strict_target(strict_score, config)
    headline = compute_headline(
        phase,
        dimensions,
        debt,
        milestone,
        diff,
        strict_score,
        overall_score,
        stats,
        history,
        open_by_detector=by_detector,
        scan_source=scan_source(state) or None,
    )
    reminders, updated_reminder_history = compute_reminders(
        state, lang, phase, debt, actions, dimensions, badge, command, config=config
    )

    return {
        "phase": phase,
        "headline": headline,
        "dimensions": dimensions,
        "actions": actions,
        "strategy": strategy,
        "tools": tools,
        "debt": debt,
        "milestone": milestone,
        "primary_action": primary_action,
        "why_now": why_now,
        "verification_step": verification_step,
        "risk_flags": risk_flags,
        "strict_target": strict_target,
        "reminders": reminders,
        "reminder_history": updated_reminder_history,
    }
