"""Terminal output helpers shared across commands."""

from __future__ import annotations

import json
import os
import sys
from collections.abc import Callable, Sequence
from typing import Any

LOC_COMPACT_THRESHOLD = 10000  # Switch from "1,234" to "1K" format

COLORS = {
    "reset": "\033[0m",
    "bold": "\033[1m",
    "dim": "\033[2m",
    "red": "\033[31m",
    "green": "\033[32m",
    "yellow": "\033[33m",
    "blue": "\033[34m",
    "cyan": "\033[36m",
}


class _NoColorFlag:
    """Compatibility export that reads the current environment on demand."""

    def __bool__(self) -> bool:
        return no_color_enabled()


def no_color_enabled() -> bool:
    return os.environ.get("NO_COLOR") is not None


NO_COLOR = _NoColorFlag()


def colorize(text: str, color: str) -> str:
    if no_color_enabled() or not sys.stdout.isatty():
        return str(text)
    return f"{COLORS.get(color, '')}{text}{COLORS['reset']}"


def log(msg: str) -> None:
    """Print a dim status message to stderr."""
    print(colorize(msg, "dim"), file=sys.stderr)


def print_table(
    headers: list[str], rows: list[list[str]], widths: list[int] | None = None
) -> None:
    if not rows:
        return
    if not widths:
        widths = [
            max(len(str(h)), *(len(str(r[i])) for r in rows))
            for i, h in enumerate(headers)
        ]
    header_line = "  ".join(h.ljust(w) for h, w in zip(headers, widths, strict=False))
    print(colorize(header_line, "bold"))
    print(colorize("─" * (sum(widths) + 2 * (len(widths) - 1)), "dim"))
    for row in rows:
        print("  ".join(str(v).ljust(w) for v, w in zip(row, widths, strict=False)))


def display_entries(
    args: object,
    entries: Sequence[Any],
    *,
    label: str,
    empty_msg: str,
    columns: Sequence[str],
    widths: list[int] | None,
    row_fn: Callable[[Any], list[str]],
    json_payload: dict | None = None,
    overflow: bool = True,
) -> bool:
    """Standard JSON/empty/table display for detect commands."""
    if getattr(args, "json", False):
        payload = json_payload or {"count": len(entries), "entries": entries}
        print(json.dumps(payload, indent=2))
        return True
    if not entries:
        print(colorize(empty_msg, "green"))
        return False
    print(colorize(f"\n{label}: {len(entries)}\n", "bold"))
    top = getattr(args, "top", 20)
    rows = [row_fn(e) for e in entries[:top]]
    print_table(list(columns), rows, widths)
    if overflow and len(entries) > top:
        print(f"\n  ... and {len(entries) - top} more")
    return True


__all__ = [
    "LOC_COMPACT_THRESHOLD",
    "COLORS",
    "NO_COLOR",
    "colorize",
    "display_entries",
    "log",
    "no_color_enabled",
    "print_table",
]
