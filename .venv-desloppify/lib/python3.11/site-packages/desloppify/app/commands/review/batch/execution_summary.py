"""Run-summary writer construction helpers for batch execution."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Protocol

from ..batches_runtime import BatchRunSummaryConfig
from ..batches_runtime import write_run_summary as _write_run_summary_impl


class RunSummaryWriter(Protocol):
    def __call__(
        self,
        *,
        successful_batches: list[int],
        failed_batches: list[int],
        interrupted: bool = False,
        interruption_reason: str | None = None,
    ) -> None: ...


def build_run_summary_writer(
    *,
    run_dir: Path,
    summary_config: BatchRunSummaryConfig,
    batch_status: dict[str, dict[str, object]],
    safe_write_text_fn: Callable[[Path, str], None],
    colorize_fn: Callable[[str, str], str],
    append_run_log: Callable[[str], None],
) -> RunSummaryWriter:
    """Create a run-summary writer closure bound to stable run metadata."""
    run_summary_path = run_dir / "run_summary.json"

    def _writer(
        *,
        successful_batches: list[int],
        failed_batches: list[int],
        interrupted: bool = False,
        interruption_reason: str | None = None,
    ) -> None:
        _write_run_summary_impl(
            summary_path=run_summary_path,
            summary_config=summary_config,
            batch_status=batch_status,
            safe_write_text_fn=safe_write_text_fn,
            colorize_fn=colorize_fn,
            append_run_log_fn=append_run_log,
            successful_batches=successful_batches,
            failed_batches=failed_batches,
            interrupted=interrupted,
            interruption_reason=interruption_reason,
        )

    return _writer


__all__ = ["RunSummaryWriter", "build_run_summary_writer"]
