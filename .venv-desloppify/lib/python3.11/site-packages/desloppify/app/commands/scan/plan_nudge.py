"""Post-scan plan workflow nudge.

Dependency-light module that only imports plan/queue helpers — avoids
the import cycle that previously forced function-level imports in scan.py.
"""

from __future__ import annotations

import logging

from desloppify.app.commands.helpers.queue_progress import (
    ScoreDisplayMode,
    get_plan_start_strict,
    plan_aware_queue_breakdown,
    score_display_mode,
)
from desloppify.base.exception_sets import PLAN_LOAD_EXCEPTIONS
from desloppify.base.output.terminal import colorize
from desloppify.engine.plan_state import load_plan

_logger = logging.getLogger(__name__)


def print_plan_workflow_nudge(state: dict) -> None:
    """Print a queue-count reminder when plan-start scores exist."""
    try:
        plan = load_plan()
        plan_start_strict = get_plan_start_strict(plan)
        if plan_start_strict is None:
            return
        breakdown = plan_aware_queue_breakdown(state, plan)
        mode = score_display_mode(breakdown, plan_start_strict)
    except PLAN_LOAD_EXCEPTIONS:
        _logger.debug("plan workflow nudge skipped", exc_info=True)
        return

    if mode is not ScoreDisplayMode.FROZEN:
        return
    queue_total = breakdown.objective_actionable
    print(
        colorize(
            f"  Workflow: {queue_total} queue item{'s' if queue_total != 1 else ''}."
            " Score is frozen until the queue is clear — use `desloppify next` to begin.",
            "dim",
        )
    )
