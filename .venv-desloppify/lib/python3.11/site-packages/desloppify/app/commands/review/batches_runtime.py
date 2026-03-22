"""Runtime helpers for review batch execution."""

from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass, field
from functools import partial
from pathlib import Path
from typing import TYPE_CHECKING

from desloppify.app.commands.runner.run_logs import make_run_log_writer

if TYPE_CHECKING:
    from .runner_parallel import BatchProgressEvent

from .batch.execution_progress import (
    build_initial_batch_status,
    build_progress_reporter,
    mark_interrupted_batches,
    record_execution_issue,
)


@dataclass(frozen=True)
class BatchRunSummaryConfig:
    """Inputs required to write the run_summary.json payload."""

    created_at: str
    run_stamp: str
    runner: str
    run_parallel: bool
    selected_indexes: list[int]
    allow_partial: bool
    max_parallel_batches: int
    batch_timeout_seconds: int
    batch_max_retries: int
    batch_retry_backoff_seconds: float
    heartbeat_seconds: float
    stall_warning_seconds: int
    stall_kill_seconds: int
    immutable_packet_path: Path
    prompt_packet_path: Path
    run_dir: Path
    logs_dir: Path
    run_log_path: Path
    backlog_gate: dict[str, object] | None = None


@dataclass
class BatchProgressTracker:
    """Tracks per-batch lifecycle state and emits progress/log events."""

    selected_indexes: list[int]
    prompt_files: dict[int, Path]
    output_files: dict[int, Path]
    log_files: dict[int, Path]
    total_batches: int
    colorize_fn: Callable[[str, str], str]
    append_run_log_fn: Callable[[str], None]
    stall_warning_seconds: int
    batch_positions: dict[int, int] = field(init=False)
    batch_status: dict[str, dict[str, object]] = field(init=False)
    stall_warned_batches: set[int] = field(default_factory=set, init=False)
    _progress_reporter: Callable[[BatchProgressEvent], None] = field(
        init=False, repr=False
    )

    def __post_init__(self) -> None:
        self.batch_positions = {
            batch_idx: pos + 1 for pos, batch_idx in enumerate(self.selected_indexes)
        }
        self.batch_status = build_initial_batch_status(
            selected_indexes=self.selected_indexes,
            batch_positions=self.batch_positions,
            prompt_files=self.prompt_files,
            output_files=self.output_files,
            log_files=self.log_files,
        )
        self._progress_reporter = build_progress_reporter(
            batch_positions=self.batch_positions,
            batch_status=self.batch_status,
            stall_warned_batches=self.stall_warned_batches,
            total_batches=self.total_batches,
            stall_warning_seconds=float(self.stall_warning_seconds),
            prompt_files=self.prompt_files,
            output_files=self.output_files,
            log_files=self.log_files,
            append_run_log=self.append_run_log_fn,
            colorize_fn=self.colorize_fn,
        )

    def report(self, batch_index: int, event: str, code: int | None = None, **details) -> None:
        self._progress_reporter(
            BatchProgressEvent(
                batch_index=batch_index,
                event=event,
                code=code,
                details=dict(details),
            )
        )

    def report_event(self, progress_event: BatchProgressEvent) -> None:
        """Typed event entrypoint shared with runner_parallel callbacks."""
        self._progress_reporter(progress_event)

    def record_execution_issue(self, batch_index: int, exc: Exception) -> None:
        record_execution_issue(self.append_run_log_fn, batch_index, exc)

    def mark_interrupted(self) -> None:
        mark_interrupted_batches(
            selected_indexes=self.selected_indexes,
            batch_status=self.batch_status,
            batch_positions=self.batch_positions,
        )

    def mark_final_statuses(
        self,
        *,
        selected_indexes: list[int],
        failure_set: set[int],
        execution_failure_set: set[int],
    ) -> None:
        for idx in selected_indexes:
            key = str(idx + 1)
            state = self.batch_status.setdefault(
                key,
                {"position": self.batch_positions.get(idx, 0), "status": "pending"},
            )
            if idx not in failure_set:
                state["status"] = "recovered" if idx in execution_failure_set else "succeeded"
                continue
            if idx in execution_failure_set:
                state["status"] = "failed"
                continue
            if not self.output_files[idx].exists():
                state["status"] = "missing_output"
                continue
            state["status"] = "parse_failed"

def resolve_run_log_path(
    raw_run_log_file: object,
    *,
    project_root: Path,
    run_dir: Path,
) -> Path:
    if isinstance(raw_run_log_file, str) and raw_run_log_file.strip():
        candidate = Path(raw_run_log_file.strip()).expanduser()
        run_log_path = candidate if candidate.is_absolute() else project_root / candidate
    else:
        run_log_path = run_dir / "run.log"
    run_log_path.parent.mkdir(parents=True, exist_ok=True)
    return run_log_path


def build_batch_tasks(
    *,
    selected_indexes: list[int],
    prompt_files: dict[int, Path],
    output_files: dict[int, Path],
    log_files: dict[int, Path],
    project_root: Path,
    run_codex_batch_fn: Callable[..., int],
) -> dict[int, Callable[[], int]]:
    return {
        idx: partial(
            _run_batch_task,
            batch_index=idx,
            prompt_path=prompt_files[idx],
            output_path=output_files[idx],
            log_path=log_files[idx],
            project_root=project_root,
            run_codex_batch_fn=run_codex_batch_fn,
        )
        for idx in selected_indexes
    }


def write_run_summary(
    *,
    summary_path: Path,
    summary_config: BatchRunSummaryConfig,
    batch_status: dict[str, dict[str, object]],
    successful_batches: list[int],
    failed_batches: list[int],
    safe_write_text_fn: Callable[[Path, str], None],
    colorize_fn: Callable[[str, str], str],
    append_run_log_fn: Callable[[str], None],
    interrupted: bool = False,
    interruption_reason: str | None = None,
) -> None:
    run_summary: dict[str, object] = {
        "created_at": summary_config.created_at,
        "run_stamp": summary_config.run_stamp,
        "runner": summary_config.runner,
        "parallel": summary_config.run_parallel,
        "selected_batches": [idx + 1 for idx in summary_config.selected_indexes],
        "successful_batches": successful_batches,
        "failed_batches": failed_batches,
        "allow_partial": summary_config.allow_partial,
        "max_parallel_batches": (
            summary_config.max_parallel_batches if summary_config.run_parallel else 1
        ),
        "batch_timeout_seconds": summary_config.batch_timeout_seconds,
        "batch_max_retries": summary_config.batch_max_retries,
        "batch_retry_backoff_seconds": summary_config.batch_retry_backoff_seconds,
        "batch_heartbeat_seconds": (
            summary_config.heartbeat_seconds if summary_config.run_parallel else None
        ),
        "batch_stall_warning_seconds": (
            summary_config.stall_warning_seconds if summary_config.run_parallel else None
        ),
        "batch_stall_kill_seconds": summary_config.stall_kill_seconds,
        "immutable_packet": str(summary_config.immutable_packet_path),
        "blind_packet": str(summary_config.prompt_packet_path),
        "run_dir": str(summary_config.run_dir),
        "logs_dir": str(summary_config.logs_dir),
        "run_log": str(summary_config.run_log_path),
        "batches": batch_status,
    }
    if isinstance(summary_config.backlog_gate, dict):
        run_summary["backlog_gate"] = summary_config.backlog_gate
    if interrupted:
        run_summary["interrupted"] = True
        if interruption_reason:
            run_summary["interruption_reason"] = interruption_reason
    safe_write_text_fn(summary_path, json.dumps(run_summary, indent=2) + "\n")
    print(colorize_fn(f"  Run summary: {summary_path}", "dim"))
    append_run_log_fn(f"run-summary {summary_path}")


def _run_batch_task(
    *,
    batch_index: int,
    prompt_path: Path,
    output_path: Path,
    log_path: Path,
    project_root: Path,
    run_codex_batch_fn: Callable[..., int],
) -> int:
    try:
        prompt = prompt_path.read_text()
    except OSError as exc:
        raise RuntimeError(
            f"unable to read prompt for batch #{batch_index + 1}: {prompt_path}"
        ) from exc
    return run_codex_batch_fn(
        prompt=prompt,
        repo_root=project_root,
        output_file=output_path,
        log_file=log_path,
    )


__all__ = [
    "BatchProgressTracker",
    "BatchRunSummaryConfig",
    "build_batch_tasks",
    "make_run_log_writer",
    "resolve_run_log_path",
    "write_run_summary",
]
