"""Review command package with a stable package-root entrypoint."""

from __future__ import annotations

import argparse


def cmd_review(args: argparse.Namespace) -> None:
    """Dispatch to the review command implementation."""
    from .cmd import cmd_review as _cmd_review

    _cmd_review(args)

__all__ = ["cmd_review"]
