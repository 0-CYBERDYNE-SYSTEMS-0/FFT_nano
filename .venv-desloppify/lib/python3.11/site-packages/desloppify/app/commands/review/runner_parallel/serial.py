"""Serial task-loop helpers for review batch execution."""

from __future__ import annotations

from typing import Callable

from .types import BatchTask


def execute_serial_tasks(
    *,
    tasks: dict[int, BatchTask],
    indexes: list[int],
    progress_fn,
    error_log_fn,
    clock_fn,
    contract_cache: dict[int, str],
    emit_progress_fn: Callable[..., BaseException | None],
    record_execution_error_fn: Callable[..., None],
    runner_task_exceptions: tuple[type[BaseException], ...],
) -> list[int]:
    """Run tasks one at a time and collect failed indexes."""
    failures: set[int] = set()
    for idx in indexes:
        t0 = float(clock_fn())
        start_error = emit_progress_fn(
            progress_fn,
            idx,
            "start",
            None,
            details={"max_workers": 1},
            contract_cache=contract_cache,
        )
        if start_error is not None:
            record_execution_error_fn(
                error_log_fn=error_log_fn,
                failures=failures,
                idx=idx,
                exc=start_error,
            )
            failures.discard(idx)
        try:
            code = tasks[idx]()
        except runner_task_exceptions as exc:
            record_execution_error_fn(
                error_log_fn=error_log_fn,
                failures=failures,
                idx=idx,
                exc=exc,
            )
            code = 1
        if code != 0:
            failures.add(idx)
        done_error = emit_progress_fn(
            progress_fn,
            idx,
            "done",
            code,
            details={"elapsed_seconds": int(max(0.0, clock_fn() - t0))},
            contract_cache=contract_cache,
        )
        if done_error is not None:
            record_execution_error_fn(
                error_log_fn=error_log_fn,
                failures=failures,
                idx=idx,
                exc=done_error,
            )
            failures.discard(idx)
    return sorted(failures)


__all__ = ["execute_serial_tasks"]
