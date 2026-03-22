"""Batch execution orchestration for review command."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable


@dataclass(frozen=True)
class LoadOrPreparePacketRequest:
    """Stable inputs for resolving a reusable or fresh review packet."""

    args: Any
    state: dict[str, Any]
    lang: Any
    config: dict[str, Any]
    stamp: str


@dataclass(frozen=True)
class PrepareRunArtifactsRequest:
    """Stable inputs for creating a review batch run directory."""

    stamp: str
    selected_indexes: list[int]
    batches: list[dict[str, Any]]
    packet_path: Path
    run_root: Path
    repo_root: Path


@dataclass(frozen=True)
class CollectBatchResultsRequest:
    """Stable inputs for parsing and normalizing batch result payloads."""

    selected_indexes: list[int]
    failures: list[int]
    output_files: dict[int, Path]
    allowed_dims: set[str]


@dataclass(frozen=True)
class BatchRunDeps:
    """Explicit callable surface for batch-run orchestration."""

    run_stamp_fn: Callable[[], str]
    load_or_prepare_packet_fn: Callable[
        [LoadOrPreparePacketRequest], tuple[dict[str, Any], Path, Path]
    ]
    selected_batch_indexes_fn: Callable[..., list[int]]
    prepare_run_artifacts_fn: Callable[
        [PrepareRunArtifactsRequest],
        tuple[Path, Path, dict[int, Path], dict[int, Path], dict[int, Path]],
    ]
    run_codex_batch_fn: Callable[..., int]
    execute_batches_fn: Callable[..., list[int]]
    collect_batch_results_fn: Callable[
        [CollectBatchResultsRequest], tuple[list[dict[str, Any]], list[int]]
    ]
    print_failures_fn: Callable[..., None]
    print_failures_and_raise_fn: Callable[..., None]
    merge_batch_results_fn: Callable[[list[dict[str, Any]]], dict[str, object]]
    build_import_provenance_fn: Callable[..., dict[str, Any]]
    do_import_fn: Callable[..., None]
    run_followup_scan_fn: Callable[..., int]
    safe_write_text_fn: Callable[[Path, str], None]
    colorize_fn: Callable[[str, str | None], str]

__all__ = [
    "BatchRunDeps",
    "CollectBatchResultsRequest",
    "LoadOrPreparePacketRequest",
    "PrepareRunArtifactsRequest",
]
