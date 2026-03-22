"""Status command package with a stable package-root entrypoint."""

from __future__ import annotations

import argparse


def cmd_status(args: argparse.Namespace) -> None:
    """Dispatch to the status command implementation."""
    from .cmd import cmd_status as _cmd_status

    _cmd_status(args)

__all__ = ["cmd_status"]
