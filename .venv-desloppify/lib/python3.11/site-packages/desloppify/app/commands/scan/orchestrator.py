"""Scan lifecycle orchestration service.

Keeps scan command flow explicit while delegating stage implementations to
scan_workflow helpers.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from desloppify.app.commands.scan.workflow import (
    ScanMergeResult,
    ScanNoiseSnapshot,
    ScanRuntime,
    merge_scan_results,
    persist_reminder_history,
    resolve_noise_snapshot,
    run_scan_generation,
)


@dataclass
class ScanOrchestrator:
    """Compose scan lifecycle stages around a resolved ScanRuntime."""

    runtime: ScanRuntime
    run_scan_generation_fn: Callable[
        [ScanRuntime],
        tuple[list[dict[str, Any]], dict[str, object], dict[str, object] | None],
    ] = run_scan_generation
    merge_scan_results_fn: Callable[
        [ScanRuntime, list[dict[str, Any]], dict[str, object], dict[str, object] | None],
        ScanMergeResult,
    ] = merge_scan_results
    resolve_noise_snapshot_fn: Callable[
        [dict[str, Any], dict[str, object]],
        ScanNoiseSnapshot,
    ] = resolve_noise_snapshot
    persist_reminder_history_fn: Callable[
        [ScanRuntime, dict[str, object]],
        None,
    ] = persist_reminder_history

    def generate(
        self,
    ) -> tuple[list[dict[str, object]], dict[str, object], dict[str, object] | None]:
        """Run detector generation and lifecycle augmenters."""
        return self.run_scan_generation_fn(self.runtime)

    def merge(
        self,
        issues: list[dict[str, object]],
        potentials: dict[str, object],
        codebase_metrics: dict[str, object] | None,
    ) -> ScanMergeResult:
        """Merge generated issues and persist scan state updates."""
        return self.merge_scan_results_fn(
            self.runtime,
            issues,
            potentials,
            codebase_metrics,
        )

    def noise_snapshot(self) -> ScanNoiseSnapshot:
        """Resolve effective noise budgets for display/query payloads."""
        return self.resolve_noise_snapshot_fn(self.runtime.state, self.runtime.config)

    def persist_reminders(self, narrative: dict[str, object]) -> None:
        """Persist reminder history emitted by post-scan narrative analysis."""
        self.persist_reminder_history_fn(self.runtime, narrative)


__all__ = ["ScanOrchestrator"]
