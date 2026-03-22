"""Small helper functions for next command flow."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from desloppify.app.commands.helpers.queue_progress import (
    get_plan_start_strict,
    plan_aware_queue_breakdown,
)
from desloppify.base.exception_sets import PLAN_LOAD_EXCEPTIONS
from desloppify.engine._scoring.detection import merge_potentials

if TYPE_CHECKING:
    from desloppify.app.commands.helpers.queue_progress import QueueBreakdown
    from desloppify.engine._work_queue.context import QueueContext

logger = logging.getLogger(__name__)


def resolve_cluster_focus(
    plan_data: dict[str, Any] | None,
    *,
    cluster_arg: str | None,
    scope: str | None,
) -> str | None:
    effective_cluster = cluster_arg
    if plan_data and not cluster_arg and not scope:
        active_cluster = plan_data.get("active_cluster")
        if active_cluster:
            effective_cluster = active_cluster
    return effective_cluster


def plan_queue_context(
    *,
    state: dict[str, Any],
    plan_data: dict[str, Any] | None,
    context: QueueContext | None = None,
) -> tuple[float | None, QueueBreakdown | None]:
    effective_plan = context.plan if context is not None else plan_data
    plan_start_strict = get_plan_start_strict(effective_plan)
    try:
        breakdown = plan_aware_queue_breakdown(state, plan_data, context=context)
    except PLAN_LOAD_EXCEPTIONS as exc:
        logger.debug("Unable to build plan-aware queue breakdown.", exc_info=exc)
        breakdown = None
    return plan_start_strict, breakdown


def merge_potentials_safe(
    raw_potentials: dict[str, Any] | None,
) -> dict[str, Any] | None:
    try:
        return merge_potentials(raw_potentials) or None
    except (ImportError, TypeError, ValueError):
        return raw_potentials or None


__all__ = ["merge_potentials_safe", "plan_queue_context", "resolve_cluster_focus"]
