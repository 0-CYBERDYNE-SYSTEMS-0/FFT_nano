"""Progress callback helpers for review batch execution."""

from __future__ import annotations

import logging
import subprocess  # nosec
import time
from typing import Any

from desloppify.base.output.fallbacks import log_best_effort_failure

from .types import BatchExecutionOptions, BatchProgressEvent

logger = logging.getLogger(__name__)

_RUNNER_CALLBACK_EXCEPTIONS = (
    OSError,
    RuntimeError,
    TypeError,
    ValueError,
    AssertionError,
    KeyError,
)
_RUNNER_TASK_EXCEPTIONS = (
    OSError,
    RuntimeError,
    TypeError,
    ValueError,
    AssertionError,
    subprocess.SubprocessError,
)


def _coerce_batch_execution_options(
    options: BatchExecutionOptions | None = None,
) -> BatchExecutionOptions:
    """Resolve execution options from the typed dataclass contract."""
    base = options or BatchExecutionOptions(run_parallel=False)
    max_parallel_workers = (
        int(base.max_parallel_workers)
        if isinstance(base.max_parallel_workers, int)
        and not isinstance(base.max_parallel_workers, bool)
        else None
    )
    heartbeat_seconds = (
        float(base.heartbeat_seconds)
        if isinstance(base.heartbeat_seconds, int | float)
        and not isinstance(base.heartbeat_seconds, bool)
        else None
    )
    clock_fn = base.clock_fn if callable(base.clock_fn) else time.monotonic

    return BatchExecutionOptions(
        run_parallel=bool(base.run_parallel),
        max_parallel_workers=max_parallel_workers,
        heartbeat_seconds=heartbeat_seconds,
        clock_fn=clock_fn,
    )


def _progress_contract(
    progress_fn,
    *,
    contract_cache: dict[int, str] | None = None,
) -> str:
    """Resolve callback contract once: event callback or none."""
    if not callable(progress_fn):
        return "none"
    fn_id = id(progress_fn)
    cache = contract_cache if contract_cache is not None else {}
    cached = cache.get(fn_id)
    if cached:
        return cached
    contract = "event"
    cache[fn_id] = contract
    return contract


def _emit_progress(
    progress_fn,
    batch_index: int,
    event: str,
    code: int | None = None,
    *,
    details: dict[str, Any] | None = None,
    contract_cache: dict[int, str] | None = None,
) -> Exception | None:
    """Forward a progress event and return callback exceptions to caller."""
    contract = _progress_contract(progress_fn, contract_cache=contract_cache)
    if contract == "none":
        return None
    payload = dict(details or {})
    progress_event = BatchProgressEvent(
        batch_index=batch_index,
        event=event,
        code=code,
        details=payload,
    )
    try:
        progress_fn(progress_event)
        return None
    except _RUNNER_CALLBACK_EXCEPTIONS as exc:
        return RuntimeError(
            f"progress callback failed for event={event} batch={batch_index}: {exc}"
        )


def _record_execution_error(
    *,
    error_log_fn,
    failures: set[int],
    idx: int,
    exc: Exception,
) -> None:
    """Record an execution/progress error through shared failure plumbing."""
    if callable(error_log_fn):
        try:
            error_log_fn(idx, exc)
        except (OSError, TypeError, ValueError) as err:
            log_best_effort_failure(
                logger,
                "record batch execution error via callback",
                err,
            )
    failures.add(idx)


def _record_progress_error(
    *,
    idx: int,
    err: Exception,
    progress_failures: set[int],
    lock,
    error_log_fn,
) -> None:
    with lock:
        progress_failures.add(idx)
    if not callable(error_log_fn):
        return
    try:
        error_log_fn(idx, err)
    except (OSError, TypeError, ValueError) as exc:
        log_best_effort_failure(
            logger,
            "record batch progress failure via callback",
            exc,
        )


__all__ = [
    "_RUNNER_CALLBACK_EXCEPTIONS",
    "_RUNNER_TASK_EXCEPTIONS",
    "_coerce_batch_execution_options",
    "_emit_progress",
    "_progress_contract",
    "_record_execution_error",
    "_record_progress_error",
]
