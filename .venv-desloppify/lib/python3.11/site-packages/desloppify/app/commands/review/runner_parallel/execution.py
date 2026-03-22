"""Serial/parallel execution loops for review batch tasks."""

from __future__ import annotations

import logging
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from concurrent.futures import TimeoutError as FuturesTimeoutError

from desloppify.base.output.fallbacks import log_best_effort_failure

from .progress import (
    _RUNNER_CALLBACK_EXCEPTIONS,
    _RUNNER_TASK_EXCEPTIONS,
    _emit_progress,
    _record_execution_error,
    _record_progress_error,
)
from .serial import execute_serial_tasks
from .types import BatchTask

logger = logging.getLogger(__name__)


def _execute_serial(
    *,
    tasks: dict[int, BatchTask],
    indexes: list[int],
    progress_fn,
    error_log_fn,
    clock_fn,
    contract_cache: dict[int, str],
) -> list[int]:
    normalized_indexes: list[int] = []
    seen: set[int] = set()
    for idx in indexes:
        if idx in seen:
            continue
        seen.add(idx)
        if idx not in tasks:
            continue
        normalized_indexes.append(idx)
    if not normalized_indexes:
        return []
    return execute_serial_tasks(
        tasks=tasks,
        indexes=normalized_indexes,
        progress_fn=progress_fn,
        error_log_fn=error_log_fn,
        clock_fn=clock_fn,
        contract_cache=contract_cache,
        emit_progress_fn=_emit_progress,
        record_execution_error_fn=_record_execution_error,
        runner_task_exceptions=_RUNNER_TASK_EXCEPTIONS,
    )


def _resolve_parallel_runtime(
    *,
    indexes: list[int],
    max_parallel_workers,
    heartbeat_seconds,
) -> tuple[int, float | None]:
    requested = (
        int(max_parallel_workers)
        if isinstance(max_parallel_workers, int) and max_parallel_workers > 0
        else 8
    )
    max_workers = max(1, min(len(indexes), requested))
    heartbeat = (
        float(heartbeat_seconds)
        if isinstance(heartbeat_seconds, int | float) and heartbeat_seconds > 0
        else None
    )
    return max_workers, heartbeat


def _run_parallel_task(
    *,
    idx: int,
    tasks: dict[int, BatchTask],
    progress_fn,
    error_log_fn,
    contract_cache: dict[int, str],
    max_workers: int,
    progress_failures: set[int],
    started_at: dict[int, float],
    lock: threading.Lock,
    clock_fn,
) -> int:
    with lock:
        started_at[idx] = float(clock_fn())
    progress_error = _emit_progress(
        progress_fn,
        idx,
        "start",
        None,
        details={"max_workers": max_workers},
        contract_cache=contract_cache,
    )
    if progress_error is not None:
        _record_progress_error(
            idx=idx,
            err=progress_error,
            progress_failures=progress_failures,
            lock=lock,
            error_log_fn=error_log_fn,
        )
    return tasks[idx]()


def _queue_parallel_tasks(
    *,
    executor: ThreadPoolExecutor,
    indexes: list[int],
    tasks: dict[int, BatchTask],
    progress_fn,
    error_log_fn,
    contract_cache: dict[int, str],
    max_workers: int,
    failures: set[int],
    progress_failures: set[int],
    started_at: dict[int, float],
    lock: threading.Lock,
    clock_fn,
) -> dict:
    futures: dict = {}
    for idx in indexes:
        queue_error = _emit_progress(
            progress_fn,
            idx,
            "queued",
            None,
            details={"max_workers": max_workers},
            contract_cache=contract_cache,
        )
        if queue_error is not None:
            _record_progress_error(
                idx=idx,
                err=queue_error,
                progress_failures=progress_failures,
                lock=lock,
                error_log_fn=error_log_fn,
            )
        futures[
            executor.submit(
                _run_parallel_task,
                idx=idx,
                tasks=tasks,
                progress_fn=progress_fn,
                error_log_fn=error_log_fn,
                contract_cache=contract_cache,
                max_workers=max_workers,
                progress_failures=progress_failures,
                started_at=started_at,
                lock=lock,
                clock_fn=clock_fn,
            )
        ] = idx
    return futures


def _complete_parallel_future(
    *,
    future,
    futures: dict,
    progress_fn,
    error_log_fn,
    contract_cache: dict[int, str],
    failures: set[int],
    progress_failures: set[int],
    started_at: dict[int, float],
    lock: threading.Lock,
    clock_fn,
) -> None:
    idx = futures[future]
    with lock:
        t0 = started_at.get(idx, float(clock_fn()))
    elapsed = int(max(0.0, clock_fn() - t0))
    try:
        code = future.result()
    except _RUNNER_TASK_EXCEPTIONS as exc:
        _record_execution_error(
            error_log_fn=error_log_fn,
            failures=failures,
            idx=idx,
            exc=exc,
        )
        done_error = _emit_progress(
            progress_fn,
            idx,
            "done",
            1,
            details={"elapsed_seconds": elapsed},
            contract_cache=contract_cache,
        )
        if done_error is not None:
            _record_progress_error(
                idx=idx,
                err=done_error,
                progress_failures=progress_failures,
                lock=lock,
                error_log_fn=error_log_fn,
            )
        return

    done_error = _emit_progress(
        progress_fn,
        idx,
        "done",
        code,
        details={"elapsed_seconds": elapsed},
        contract_cache=contract_cache,
    )
    if done_error is not None:
        _record_progress_error(
            idx=idx,
            err=done_error,
            progress_failures=progress_failures,
            lock=lock,
            error_log_fn=error_log_fn,
        )

    if code != 0:
        failures.add(idx)


def _drain_parallel_completions(
    *,
    pending: set,
    futures: dict,
    heartbeat: float | None,
    indexes: list[int],
    progress_fn,
    error_log_fn,
    contract_cache: dict[int, str],
    failures: set[int],
    progress_failures: set[int],
    started_at: dict[int, float],
    lock: threading.Lock,
    clock_fn,
) -> None:
    if heartbeat is None:
        for future in as_completed(pending):
            _complete_parallel_future(
                future=future,
                futures=futures,
                progress_fn=progress_fn,
                error_log_fn=error_log_fn,
                contract_cache=contract_cache,
                failures=failures,
                progress_failures=progress_failures,
                started_at=started_at,
                lock=lock,
                clock_fn=clock_fn,
            )
        return

    while pending:
        try:
            future = next(as_completed(pending, timeout=heartbeat))
        except FuturesTimeoutError:
            _heartbeat(
                pending,
                futures,
                started_at,
                lock,
                indexes,
                progress_fn,
                clock_fn,
                error_log_fn=error_log_fn,
                contract_cache=contract_cache,
            )
            continue
        pending.discard(future)
        _complete_parallel_future(
            future=future,
            futures=futures,
            progress_fn=progress_fn,
            error_log_fn=error_log_fn,
            contract_cache=contract_cache,
            failures=failures,
            progress_failures=progress_failures,
            started_at=started_at,
            lock=lock,
            clock_fn=clock_fn,
        )


def _heartbeat(
    pending,
    futures,
    started_at,
    lock,
    indexes,
    progress_fn,
    clock_fn,
    *,
    error_log_fn=None,
    contract_cache: dict[int, str] | None = None,
):
    """Build and emit a heartbeat with active/queued batch status."""
    with lock:
        active = sorted(futures[f] for f in pending if futures[f] in started_at)
    active_set = set(active)
    queued = sorted(futures[f] for f in pending if futures[f] not in active_set)
    elapsed = {
        idx: int(max(0.0, clock_fn() - started_at.get(idx, clock_fn())))
        for idx in active
    }
    heartbeat_error = _emit_progress(
        progress_fn,
        -1,
        "heartbeat",
        None,
        details={
            "active_batches": active,
            "queued_batches": queued,
            "elapsed_seconds": elapsed,
            "active_count": len(active),
            "queued_count": len(queued),
            "total_count": len(indexes),
        },
        contract_cache=contract_cache,
    )
    if heartbeat_error is not None and callable(error_log_fn):
        try:
            error_log_fn(-1, heartbeat_error)
        except _RUNNER_CALLBACK_EXCEPTIONS as exc:
            log_best_effort_failure(
                logger,
                "record batch heartbeat failure via callback",
                exc,
            )


__all__ = [
    "_complete_parallel_future",
    "_drain_parallel_completions",
    "_execute_serial",
    "_heartbeat",
    "_queue_parallel_tasks",
    "_resolve_parallel_runtime",
    "_run_parallel_task",
]
