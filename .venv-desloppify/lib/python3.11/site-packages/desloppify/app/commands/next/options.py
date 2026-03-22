"""Option model for the `next` command."""

from __future__ import annotations

import argparse
from dataclasses import dataclass


@dataclass(frozen=True)
class NextOptions:
    """All user-facing options for the ``next`` command, extracted once."""

    count: int = 1
    scope: str | None = None
    status: str = "open"
    group: str = "item"
    explain: bool = False
    cluster: str | None = None
    include_skipped: bool = False
    output_file: str | None = None
    output_format: str = "terminal"

    @classmethod
    def from_args(cls, args: argparse.Namespace) -> NextOptions:
        """Build from argparse args, applying defaults for missing attrs."""
        return cls(
            count=getattr(args, "count", 1) or 1,
            scope=getattr(args, "scope", None),
            status=getattr(args, "status", "open"),
            group=getattr(args, "group", "item"),
            explain=bool(getattr(args, "explain", False)),
            cluster=getattr(args, "cluster", None),
            include_skipped=bool(getattr(args, "include_skipped", False)),
            output_file=getattr(args, "output", None),
            output_format=getattr(args, "format", "terminal"),
        )


__all__ = ["NextOptions"]
