"""Shared run context models for the Codex triage pipeline."""

from __future__ import annotations

import argparse
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from ..services import TriageServices


@dataclass(frozen=True)
class PipelineRunContext:
    """Shared execution inputs for the full pipeline run."""

    args: argparse.Namespace
    services: TriageServices
    state: Any
    stages_to_run: list[str]
    timeout_seconds: int
    dry_run: bool
    repo_root: Path
    stamp: str
    run_dir: Path
    prompts_dir: Path
    output_dir: Path
    logs_dir: Path
    run_log_path: Path
    cli_command: str
    append_run_log: Callable[[str], None]


@dataclass(frozen=True)
class StageRunContext:
    """Shared execution inputs for one stage inside the pipeline."""

    stage: str
    stage_start: float
    args: argparse.Namespace
    services: TriageServices
    plan: Mapping[str, Any]
    triage_input: Any
    prior_reports: Mapping[str, str]
    repo_root: Path
    prompts_dir: Path
    output_dir: Path
    logs_dir: Path
    cli_command: str
    timeout_seconds: int
    dry_run: bool
    append_run_log: Callable[[str], None]
    state: Any = None


def load_prior_reports_from_plan(plan: Mapping[str, Any], stages: list[str]) -> dict[str, str]:
    """Seed prior stage reports from the current live triage state."""
    triage_stages = plan.get("epic_triage_meta", {}).get("triage_stages", {})
    prior_reports: dict[str, str] = {}
    for stage in stages:
        report = triage_stages.get(stage, {}).get("report", "")
        if report:
            prior_reports[stage] = report
    return prior_reports


__all__ = [
    "PipelineRunContext",
    "StageRunContext",
    "load_prior_reports_from_plan",
]
