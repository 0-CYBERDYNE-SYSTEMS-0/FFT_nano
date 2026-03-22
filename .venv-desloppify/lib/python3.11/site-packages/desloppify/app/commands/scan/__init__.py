"""Scan command package with a stable package-root entrypoint."""

from __future__ import annotations

import argparse


def cmd_scan(args: argparse.Namespace) -> None:
    """Dispatch to the scan command implementation."""
    from .cmd import cmd_scan as _cmd_scan

    _cmd_scan(args)

__all__ = ["cmd_scan"]
