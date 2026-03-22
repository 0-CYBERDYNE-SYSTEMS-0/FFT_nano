"""Backlog command package with a stable package-root entrypoint."""

from __future__ import annotations

import argparse


def cmd_backlog(args: argparse.Namespace) -> None:
    """Dispatch to the backlog command implementation."""
    from .cmd import cmd_backlog as _cmd_backlog

    _cmd_backlog(args)

__all__ = ["cmd_backlog"]
