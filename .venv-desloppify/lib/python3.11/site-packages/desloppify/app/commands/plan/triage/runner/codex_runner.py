"""Thin wrapper around shared codex process runner for triage execution."""

from __future__ import annotations

import subprocess  # nosec B404
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from desloppify.app.commands.runner.codex_batch import (
    CodexBatchRunnerDeps,
    codex_batch_command,
    run_codex_batch,
)
from desloppify.base.discovery.file_paths import safe_write_text


def _output_file_has_text(output_file: Path) -> bool:
    """Return True when the output file exists and contains non-empty text."""
    if not output_file.exists():
        return False
    try:
        return len(output_file.read_text().strip()) > 0
    except OSError:
        return False


@dataclass(frozen=True)
class TriageStageRunResult:
    """Typed result contract for triage-stage execution."""

    exit_code: int
    reason: str | None = None
    merged_output: str | None = None
    dry_run: bool = False

    @property
    def ok(self) -> bool:
        return self.status == "ok"

    @property
    def status(self) -> str:
        if self.dry_run:
            return "dry_run"
        return "ok" if self.exit_code == 0 else "failed"


def run_triage_stage(
    *,
    prompt: str,
    repo_root: Path,
    output_file: Path,
    log_file: Path,
    timeout_seconds: int = 1800,
    validate_output_fn: Callable[[Path], bool] | None = None,
) -> TriageStageRunResult:
    """Execute a triage stage via codex subprocess and return a typed result."""
    normalized_prompt = str(prompt).strip()
    if not normalized_prompt:
        safe_write_text(log_file, "Empty triage prompt — skipping execution.\n")
        return TriageStageRunResult(exit_code=2, reason="empty_prompt")
    output_file.parent.mkdir(parents=True, exist_ok=True)
    log_file.parent.mkdir(parents=True, exist_ok=True)
    if validate_output_fn is None:
        validate_output_fn = _output_file_has_text
    timeout = timeout_seconds if timeout_seconds > 0 else 1800
    preview = " ".join(
        codex_batch_command(
            prompt=normalized_prompt,
            repo_root=repo_root,
            output_file=output_file,
        )
    )
    safe_write_text(log_file, f"RUNNER COMMAND PREVIEW:\n{preview}\n")
    deps = CodexBatchRunnerDeps(
        timeout_seconds=timeout,
        subprocess_run=subprocess.run,
        timeout_error=subprocess.TimeoutExpired,
        safe_write_text_fn=safe_write_text,
        use_popen_runner=True,
        subprocess_popen=subprocess.Popen,
        live_log_interval_seconds=10.0,
        stall_after_output_seconds=120,
        max_retries=1,
        retry_backoff_seconds=5.0,
        sleep_fn=time.sleep,
        validate_output_fn=validate_output_fn,
    )
    exit_code = run_codex_batch(
        prompt=normalized_prompt,
        repo_root=repo_root,
        output_file=output_file,
        log_file=log_file,
        deps=deps,
    )
    reason = None if exit_code == 0 else f"runner_exit_{exit_code}"
    return TriageStageRunResult(exit_code=exit_code, reason=reason)


__all__ = [
    "TriageStageRunResult",
    "run_triage_stage",
]
