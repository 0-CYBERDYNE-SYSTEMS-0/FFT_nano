"""Suppress command handler — permanently silence issues matching a pattern."""

from __future__ import annotations

import argparse

from desloppify import state as state_mod
from desloppify.app.commands.helpers.attestation import (
    show_attestation_requirement,
    validate_attestation,
)
from desloppify.app.commands.helpers.lang import resolve_lang
from desloppify.app.commands.helpers.state_persistence import (
    save_config_or_exit,
    save_state_or_exit,
)
from desloppify.app.commands.helpers.query import write_query
from desloppify.app.commands.helpers.queue_progress import show_score_with_plan_context
from desloppify.app.commands.helpers.command_runtime import command_runtime
from desloppify.base import config as config_mod
from desloppify.base.exception_sets import CommandError
from desloppify.base.output.terminal import colorize
from desloppify.base.tooling import check_config_staleness
from desloppify.engine._work_queue.core import ATTEST_EXAMPLE
import desloppify.intelligence.narrative.core as narrative_mod


def cmd_suppress(args: argparse.Namespace) -> None:
    """Suppress issues matching a pattern."""
    attestation = getattr(args, "attest", None)
    if not validate_attestation(attestation):
        show_attestation_requirement("Suppress", attestation, ATTEST_EXAMPLE)
        raise CommandError("Suppress requires a valid attestation.")

    runtime = command_runtime(args)
    state_file = runtime.state_path
    state = runtime.state
    prev = state_mod.score_snapshot(state)

    config = runtime.config
    config_mod.add_ignore_pattern(config, args.pattern)
    config["needs_rescan"] = True
    save_config_or_exit(config)

    removed = state_mod.remove_ignored_issues(state, args.pattern)
    state.setdefault("attestation_log", []).append(
        {
            "timestamp": state.get("last_scan"),
            "command": "suppress",
            "pattern": args.pattern,
            "attestation": attestation,
            "affected": removed,
        }
    )
    save_state_or_exit(state, state_file)

    print(colorize(f"Added suppress pattern: {args.pattern}", "green"))
    if removed:
        print(f"  Removed {removed} matching issues from state.")
    config_warning = check_config_staleness(config)
    if config_warning:
        print(colorize(f"  {config_warning}", "yellow"))
    show_score_with_plan_context(state, prev)

    lang = resolve_lang(args)
    lang_name = lang.name if lang else None
    narrative = narrative_mod.compute_narrative(
        state,
        context=narrative_mod.NarrativeContext(lang=lang_name, command="suppress"),
    )
    scores = state_mod.score_snapshot(state)
    write_query(
        {
            "command": "suppress",
            "pattern": args.pattern,
            "removed": removed,
            "overall_score": scores.overall,
            "objective_score": scores.objective,
            "strict_score": scores.strict,
            "verified_strict_score": scores.verified,
            "attestation": attestation,
            "narrative": narrative,
        }
    )


__all__ = ["cmd_suppress"]
