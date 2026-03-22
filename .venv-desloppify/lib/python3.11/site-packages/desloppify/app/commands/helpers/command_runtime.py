"""Command runtime context helpers for command handlers."""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from desloppify.app.commands.helpers.state import state_path
from desloppify.base.config import load_config
from desloppify.state_io import StateModel, load_state


@dataclass(frozen=True)
class CommandRuntime:
    """Explicit runtime dependencies shared by command handlers."""

    config: dict[str, Any]
    state: StateModel
    state_path: Path | None


def command_runtime(args: argparse.Namespace) -> CommandRuntime:
    """Return runtime context from explicit args.runtime or construct one."""
    runtime = getattr(args, "runtime", None)
    if isinstance(runtime, CommandRuntime):
        return runtime

    config = load_config()
    state_file = state_path(args)
    if isinstance(state_file, str):
        state_file = Path(state_file)

    state = load_state(state_file)

    return CommandRuntime(config=config, state=state, state_path=state_file)


__all__ = ["CommandRuntime", "command_runtime"]
