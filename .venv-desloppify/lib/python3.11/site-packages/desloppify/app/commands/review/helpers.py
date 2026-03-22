"""Shared helpers for review subcommands."""

from __future__ import annotations


def parse_dimensions(args: object) -> set[str] | None:
    """Parse ``--dimensions`` from *args* into a set, or ``None`` if absent."""
    raw = getattr(args, "dimensions", None)
    if not isinstance(raw, str) or not raw.strip():
        return None
    return {d.strip() for d in raw.split(",") if d.strip()}
