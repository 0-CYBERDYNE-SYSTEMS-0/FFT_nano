"""Move command package with a stable package-root entrypoint."""

from __future__ import annotations

import argparse


def cmd_move(args: argparse.Namespace) -> None:
    """Dispatch to the move command implementation."""
    from .cmd import cmd_move as _cmd_move

    _cmd_move(args)

__all__ = ["cmd_move"]
