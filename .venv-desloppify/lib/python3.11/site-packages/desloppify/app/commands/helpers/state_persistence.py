"""State/config persistence boundaries for command handlers."""

from __future__ import annotations

from pathlib import Path

from desloppify.base import config as config_mod
from desloppify.base.exception_sets import CommandError
from desloppify.engine._state.persistence import save_state


def save_state_or_exit(state: dict, state_file: Path | None) -> None:
    """Persist state with a consistent CLI error boundary."""
    try:
        save_state(state, state_file)
    except OSError as exc:
        raise CommandError(f"could not save state: {exc}") from exc


def save_config_or_exit(config: dict) -> None:
    """Persist config with a consistent CLI error boundary."""
    try:
        config_mod.save_config(config)
    except OSError as exc:
        raise CommandError(f"could not save config: {exc}") from exc


__all__ = ["save_config_or_exit", "save_state_or_exit"]
