"""Autofix command package with a stable package-root entrypoint."""

from __future__ import annotations

import argparse


def cmd_autofix(args: argparse.Namespace) -> None:
    """Dispatch to the autofix command implementation."""
    from .cmd import cmd_autofix as _cmd_autofix

    _cmd_autofix(args)

__all__ = ["cmd_autofix"]
