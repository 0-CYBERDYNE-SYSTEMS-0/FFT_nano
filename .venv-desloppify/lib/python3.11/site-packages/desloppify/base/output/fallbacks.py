"""Shared helpers for consistent best-effort fallback behavior."""

from __future__ import annotations

import logging
import sys
from collections.abc import Callable, Mapping
from pathlib import Path

from desloppify.base.output.terminal import colorize


def log_best_effort_failure(
    logger: logging.Logger, action: str, exc: Exception
) -> None:
    """Record non-fatal fallback failures in a consistent debug format."""
    logger.debug("Best-effort fallback failed while trying to %s: %s", action, exc)


def print_error(message: str) -> None:
    """Print a user-facing error message to stderr in a consistent format."""
    print(colorize(f"  Error: {message}", "red"), file=sys.stderr)


def warn_best_effort(message: str) -> None:
    """Emit a consistent user-facing warning for non-fatal fallback failures."""
    print(colorize(f"  WARNING: {message}", "yellow"), file=sys.stderr)


def print_write_error(
    path: str | Path,
    exc: Exception,
    *,
    label: str = "output",
) -> None:
    """Print a standardized write-failure error for command output files."""
    print_error(f"Could not write {label} to {path}: {exc}")


def restore_files_best_effort(
    snapshots: Mapping[str, str],
    write_fn: Callable[[str, str], None],
) -> list[str]:
    """Attempt restoring a set of files and return paths that failed to restore."""
    failed: list[str] = []
    for filepath, original in snapshots.items():
        try:
            write_fn(filepath, original)
        except OSError:
            failed.append(filepath)
    return failed


__all__ = [
    "log_best_effort_failure",
    "print_error",
    "print_write_error",
    "restore_files_best_effort",
    "warn_best_effort",
]
