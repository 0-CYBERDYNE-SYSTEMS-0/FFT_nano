"""Plan command package organized by capability surfaces.

Capabilities:
- ``cluster``: cluster subcommand entrypoint + helpers
- ``override``: resolve/skip/describe/note/focus/reopen/scan-gate handlers
- ``triage``: staged planning workflow entrypoint + stage modules
- ``commit_log``: commit tracking status/history/record helpers
"""

from __future__ import annotations

import argparse


def cmd_plan(args: argparse.Namespace) -> None:
    """Dispatch to the plan command implementation."""
    from .cmd import cmd_plan as _cmd_plan

    _cmd_plan(args)

__all__ = ["cmd_plan"]
