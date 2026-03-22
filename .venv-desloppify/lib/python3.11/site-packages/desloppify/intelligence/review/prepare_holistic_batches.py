"""Internal batch assembly boundary for holistic review preparation."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .prepare_holistic_scope import (
    file_in_allowed_scope,
    filter_batches_to_file_scope,
)

_CONCERN_BATCH_DIMENSION = "design_coherence"


@dataclass(frozen=True)
class HolisticBatchAssemblyDependencies:
    """Injected collaborators for holistic batch assembly."""

    build_investigation_batches_fn: object
    batch_concerns_fn: object
    filter_batches_to_dimensions_fn: object
    append_full_sweep_batch_fn: object
    log_best_effort_failure_fn: object
    logger: object


def _merge_batch_payload(
    batches: list[dict[str, Any]],
    incoming_batch: dict[str, Any],
) -> None:
    """Merge concern payload into an existing dimension batch when available."""
    incoming_dimensions = incoming_batch.get("dimensions")
    for existing in batches:
        if existing.get("dimensions") != incoming_dimensions:
            continue
        existing["concern_signals"] = incoming_batch.get("concern_signals", [])
        existing["concern_signal_count"] = incoming_batch.get("concern_signal_count", 0)
        judgment_counts = incoming_batch.get("judgment_finding_counts")
        if judgment_counts:
            existing["judgment_finding_counts"] = judgment_counts
        return
    batches.append(incoming_batch)


def _append_concerns_batch(
    batches: list[dict[str, Any]],
    state: dict,
    dims: list[str],
    allowed_review_files: set[str],
    max_files_per_batch: int | None,
    *,
    batch_concerns_fn,
    log_best_effort_failure_fn,
    log: object,
) -> None:
    """Append concern-signal evidence when the active dimensions can consume it."""
    if _CONCERN_BATCH_DIMENSION not in dims:
        return
    try:
        from desloppify.engine._concerns.generators import generate_concerns

        concerns = generate_concerns(state)
        concerns = [
            concern
            for concern in concerns
            if file_in_allowed_scope(getattr(concern, "file", ""), allowed_review_files)
        ]
        concerns_batch = batch_concerns_fn(
            concerns,
            max_files=max_files_per_batch,
            active_dimensions=dims,
        )
        if concerns_batch:
            _merge_batch_payload(batches, concerns_batch)
    except (ImportError, AttributeError, TypeError, ValueError) as exc:
        log_best_effort_failure_fn(log, "generate review concern batch", exc)


def assemble_holistic_batches(
    holistic_ctx,
    *,
    lang: object,
    repo_root: Path,
    state: dict,
    dims: list[str],
    all_files: list[str],
    allowed_review_files: set[str],
    include_full_sweep: bool,
    max_files_per_batch: int | None,
    deps: HolisticBatchAssemblyDependencies,
) -> list[dict[str, Any]]:
    """Build, enrich, and scope holistic investigation batches in one place."""
    batches = deps.build_investigation_batches_fn(
        holistic_ctx,
        lang,
        repo_root=repo_root,
        max_files_per_batch=max_files_per_batch,
        state=state,
    )

    _append_concerns_batch(
        batches,
        state,
        dims,
        allowed_review_files,
        max_files_per_batch,
        batch_concerns_fn=deps.batch_concerns_fn,
        log_best_effort_failure_fn=deps.log_best_effort_failure_fn,
        log=deps.logger,
    )

    batches = deps.filter_batches_to_dimensions_fn(
        batches,
        dims,
        fallback_max_files=max_files_per_batch,
    )
    if include_full_sweep:
        deps.append_full_sweep_batch_fn(
            batches=batches,
            dims=dims,
            all_files=all_files,
            lang=lang,
            max_files=max_files_per_batch,
        )
    return filter_batches_to_file_scope(
        batches,
        allowed_files=allowed_review_files,
    )


__all__ = [
    "HolisticBatchAssemblyDependencies",
    "assemble_holistic_batches",
]
