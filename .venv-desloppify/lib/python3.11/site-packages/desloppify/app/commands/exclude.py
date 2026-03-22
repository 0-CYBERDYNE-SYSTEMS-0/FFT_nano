"""exclude command: add path patterns and clean stale queue/state entries."""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

from desloppify import state as state_mod
from desloppify.app.commands.helpers.command_runtime import command_runtime
from desloppify.base import config as config_mod
from desloppify.base.discovery.file_paths import matches_exclusion
from desloppify.base.exception_sets import PLAN_LOAD_EXCEPTIONS, CommandError
from desloppify.base.output.terminal import colorize
from desloppify.base.tooling import check_config_staleness
from desloppify.engine.plan_ops import purge_ids
from desloppify.engine.plan_state import load_plan, plan_path_for_state, save_plan

logger = logging.getLogger(__name__)


def _state_file_for_runtime(runtime) -> Path:
    """Resolve the effective state file path for a command runtime."""
    state_file = runtime.state_path
    if isinstance(state_file, Path):
        return state_file
    return state_mod.get_state_file()


def _prune_excluded_issues(state: dict, pattern: str) -> list[str]:
    """Drop issues whose file path matches a new exclusion pattern."""
    issues = state.get("work_items") or state.get("issues")
    if not isinstance(issues, dict):
        return []
    state["work_items"] = issues
    state["issues"] = issues

    removed_ids = [
        issue_id
        for issue_id, issue in issues.items()
        if isinstance(issue, dict)
        and matches_exclusion(str(issue.get("file", "")), pattern)
    ]
    for issue_id in removed_ids:
        issues.pop(issue_id, None)
    return removed_ids


def _purge_removed_ids_from_plan(state_file: Path, removed_ids: list[str]) -> int:
    """Remove pruned issue IDs from queue/skips/clusters in plan.json."""
    if not removed_ids:
        return 0
    plan_file = plan_path_for_state(state_file)
    plan = load_plan(plan_file)
    purged = purge_ids(plan, removed_ids)
    if purged:
        save_plan(plan, plan_file)
    return purged


def cmd_exclude(args: argparse.Namespace) -> None:
    """Add a path pattern to the exclude list and clean cached queue/state."""
    runtime = command_runtime(args)
    config = runtime.config
    state = runtime.state
    if isinstance(state, dict):
        issues = state.get("work_items") or state.get("issues")
        if isinstance(issues, dict):
            state["work_items"] = issues
            state["issues"] = issues
    state_file = _state_file_for_runtime(runtime)

    config_mod.add_exclude_pattern(config, args.pattern)
    config["needs_rescan"] = True
    try:
        config_mod.save_config(config)
    except OSError as exc:
        raise CommandError(f"could not save config: {exc}") from exc

    removed_ids: list[str] = []
    plan_purged = 0
    if state_file.exists():
        removed_ids = _prune_excluded_issues(state, args.pattern)
        if removed_ids:
            try:
                state_mod.save_state(state, state_file)
            except OSError as exc:
                raise CommandError(f"could not save state: {exc}") from exc

            try:
                plan_purged = _purge_removed_ids_from_plan(state_file, removed_ids)
            except PLAN_LOAD_EXCEPTIONS as exc:
                logger.debug("Exclude command could not update living plan.", exc_info=exc)
                print(
                    colorize("  Warning: could not update living plan.", "yellow"),
                    file=sys.stderr,
                )

    print(colorize(f"Added exclude pattern: {args.pattern}", "green"))
    if removed_ids:
        print(f"  Removed {len(removed_ids)} matching issues from state.")
        if plan_purged:
            print(
                colorize(
                    f"  Plan updated: {plan_purged} item(s) removed from queue.",
                    "dim",
                )
            )
    config_warning = check_config_staleness(config)
    if config_warning:
        print(colorize(f"  {config_warning}", "yellow"))


__all__ = ["cmd_exclude"]
