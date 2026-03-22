"""next command: show next highest-priority queue items."""

from __future__ import annotations

import argparse

from desloppify.app.commands.helpers.guardrails import print_triage_guardrail_info
from desloppify.app.commands.helpers.lang import resolve_lang
from desloppify.app.commands.helpers.query import write_query
from desloppify.app.commands.helpers.command_runtime import command_runtime
from desloppify.app.commands.helpers.state import require_issue_inventory
from desloppify.app.skill_docs import check_skill_version
from desloppify.base.output.terminal import colorize
from desloppify.base.tooling import check_config_staleness
from desloppify.engine.plan_state import load_plan
from desloppify.engine.planning.queue_policy import build_execution_queue

from .options import NextOptions
from .queue_flow import EXECUTION_QUEUE_VIEW, QueueRenderDeps, build_and_render_queue
from .subjective import _low_subjective_dimensions

# Backward-compatible test seam: `next` now uses the execution queue wrapper.
build_work_queue = build_execution_queue


def cmd_next(args: argparse.Namespace) -> None:
    """Show next highest-priority queue items."""
    runtime = command_runtime(args)
    state = runtime.state
    config = runtime.config
    if not require_issue_inventory(state):
        return

    skill_warning = check_skill_version()
    if skill_warning:
        print(colorize(f"  {skill_warning}", "yellow"))
    config_warning = check_config_staleness(config)
    if config_warning:
        print(colorize(f"  {config_warning}", "yellow"))

    if getattr(args, "format", "terminal") == "terminal":
        print_triage_guardrail_info(state=state)
    build_and_render_queue(
        args,
        state,
        config,
        view=EXECUTION_QUEUE_VIEW,
        deps=QueueRenderDeps(
            resolve_lang_fn=resolve_lang,
            load_plan_fn=load_plan,
            build_work_queue_fn=build_work_queue,
            write_query_fn=write_query,
        ),
    )


__all__ = [
    "NextOptions",
    "_low_subjective_dimensions",
    "build_work_queue",
    "build_execution_queue",
    "build_and_render_queue",
    "cmd_next",
    "load_plan",
    "resolve_lang",
    "write_query",
]
