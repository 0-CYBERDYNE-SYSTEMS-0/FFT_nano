"""CLI rendering for React anti-pattern detector output."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from desloppify.base.discovery.file_paths import rel
from desloppify.base.output.terminal import colorize, print_table
from .state_sync import detect_state_sync


def cmd_react(args: argparse.Namespace) -> None:
    """Show React anti-patterns (state sync via useEffect)."""
    entries, _ = detect_state_sync(Path(args.path))

    if args.json:
        print(
            json.dumps(
                {
                    "count": len(entries),
                    "entries": [
                        {
                            "file": rel(e["file"]),
                            "line": e["line"],
                            "setters": e["setters"],
                        }
                        for e in entries
                    ],
                },
                indent=2,
            )
        )
        return

    if not entries:
        print(colorize("\nNo state sync anti-patterns found.", "green"))
        return

    print(
        colorize(
            "\nState sync anti-patterns (useEffect only calls setters): "
            f"{len(entries)}\n",
            "bold",
        )
    )

    rows = [[rel(e["file"]), str(e["line"]), ", ".join(e["setters"])] for e in entries[: args.top]]
    print_table(["File", "Line", "Setters"], rows, [60, 6, 40])
    print()


__all__ = ["cmd_react"]
