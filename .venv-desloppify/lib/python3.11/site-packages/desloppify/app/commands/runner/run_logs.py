"""Shared run-log helpers for long-running command orchestration."""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path


def make_run_log_writer(run_log_path: Path) -> Callable[[str], None]:
    """Return an append-only timestamped run-log writer."""

    def _append_run_log(message: str) -> None:
        line = f"{datetime.now(UTC).isoformat(timespec='seconds')} {message}\n"
        try:
            with run_log_path.open("a", encoding="utf-8") as handle:
                handle.write(line)
        except OSError:
            return

    return _append_run_log


__all__ = ["make_run_log_writer"]
