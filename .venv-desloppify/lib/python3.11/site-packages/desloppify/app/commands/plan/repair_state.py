"""Repair command for rebuilding state from surviving plan metadata."""

from __future__ import annotations

import argparse
from pathlib import Path
from typing import cast

from desloppify.app.commands.helpers.command_runtime import command_runtime
from desloppify.base.output.terminal import colorize
from desloppify.engine.plan_state import load_plan, plan_path_for_state
from desloppify.engine._state.recovery import (
    has_saved_plan_without_scan,
    reconstruct_state_from_saved_plan,
)
from desloppify.state_io import (
    StateModel,
    empty_state,
    get_state_file,
    save_state,
    scan_reconstructed_issue_count,
    scan_source,
)


def _resolved_state_file(runtime) -> Path:
    state_path = runtime.state_path
    if isinstance(state_path, Path):
        return state_path
    return get_state_file()


def cmd_plan_repair_state(args: argparse.Namespace) -> None:
    """Rebuild persisted state from live plan metadata when scan data is gone."""
    runtime = command_runtime(args)
    if scan_source(runtime.state) == "scan":
        print(colorize("  State already has scan-backed data. No repair needed.", "green"))
        return

    state_file = _resolved_state_file(runtime)
    plan_path = plan_path_for_state(state_file)
    plan = load_plan(plan_path)
    if not has_saved_plan_without_scan(empty_state(), plan):
        print(colorize("  No saved plan metadata available to rebuild state.", "yellow"))
        return

    repaired = reconstruct_state_from_saved_plan(empty_state(), plan)
    save_state(cast(StateModel, repaired), state_file)

    reconstructed_count = scan_reconstructed_issue_count(repaired)
    print(
        colorize(
            f"  Rebuilt {state_file.name} from {plan_path.name} "
            f"({reconstructed_count} open review item(s)).",
            "green",
        )
    )
    print(
        colorize(
            "  Scan-derived scores and metrics remain unavailable until you run `desloppify scan`.",
            "dim",
        )
    )


__all__ = ["cmd_plan_repair_state"]
