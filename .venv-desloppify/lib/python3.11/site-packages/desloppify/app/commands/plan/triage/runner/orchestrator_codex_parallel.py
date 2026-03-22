"""Shared parallel-batch execution helper for codex triage stages."""

from __future__ import annotations

from collections.abc import Callable

from desloppify.app.commands.review.runner_parallel import (
    BatchExecutionOptions,
    BatchProgressEvent,
    execute_batches,
)
from desloppify.base.output.terminal import colorize

from .codex_runner import TriageStageRunResult


def run_parallel_batches(
    *,
    tasks: dict[int, Callable[[], TriageStageRunResult]],
    stage_label: str,
    batch_label_fn: Callable[[int], str],
    append_run_log: Callable[[str], None],
    heartbeat_seconds: float = 15.0,
    heartbeat_printer: Callable[[BatchProgressEvent], None] | None = None,
) -> list[int]:
    """Execute typed triage-stage batches with shared progress/error logging."""

    stage_slug = stage_label.lower().replace(" ", "-")

    def _progress(event: BatchProgressEvent) -> None:
        idx = event.batch_index
        label = batch_label_fn(idx)
        if event.event == "start":
            print(colorize(f"    {stage_label} {label} started", "dim"))
            append_run_log(f"{stage_slug}-batch-start {label}")
        elif event.event == "done":
            elapsed = event.details.get("elapsed_seconds", 0) if event.details else 0
            status = "done" if event.code == 0 else f"failed ({event.code})"
            tone = "dim" if event.code == 0 else "yellow"
            print(colorize(f"    {stage_label} {label} {status} in {int(elapsed)}s", tone))
            append_run_log(
                f"{stage_slug}-batch-done {label} code={event.code} elapsed={int(elapsed)}s"
            )
        elif event.event == "heartbeat" and heartbeat_printer is not None:
            heartbeat_printer(event)

    def _error_log(batch_index: int, exc: Exception) -> None:
        append_run_log(f"{stage_slug}-batch-error batch={batch_index} error={exc}")

    wrapped_tasks: dict[int, Callable[[], int]] = {
        idx: (lambda idx=idx, task=task: task().exit_code) for idx, task in tasks.items()
    }

    return execute_batches(
        tasks=wrapped_tasks,
        options=BatchExecutionOptions(
            run_parallel=True,
            heartbeat_seconds=heartbeat_seconds,
        ),
        progress_fn=_progress,
        error_log_fn=_error_log,
    )


__all__ = ["run_parallel_batches"]
