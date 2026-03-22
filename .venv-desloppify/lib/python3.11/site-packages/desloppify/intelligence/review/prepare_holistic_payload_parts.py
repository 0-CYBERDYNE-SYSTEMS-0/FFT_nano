"""Payload assembly helpers for holistic review orchestration."""

from __future__ import annotations

from typing import Any

from desloppify.intelligence.review._prepare.issue_history import (
    ReviewHistoryOptions,
    build_batch_issue_focus,
    build_issue_history_context,
)

from .prepare_holistic_scope import filter_batches_to_file_scope


def _build_selected_prompts(
    dims: list[str],
    holistic_prompts: dict[str, Any],
    per_file_prompts: dict[str, Any],
) -> dict[str, dict[str, object]]:
    """Build the dimension-to-prompt mapping, preferring holistic prompts."""
    selected: dict[str, dict[str, object]] = {}
    for dim in dims:
        prompt = holistic_prompts.get(dim)
        if prompt is None:
            prompt = per_file_prompts.get(dim)
        if prompt is None:
            continue
        selected[dim] = prompt
    return selected


def _attach_issue_history_context(
    payload: dict[str, Any],
    batches: list[dict[str, Any]],
    state: dict,
    options: object,
    allowed_review_files: set[str],
) -> list[dict[str, Any]]:
    """Attach issue history to payload and per-batch focus; re-scope batches."""
    if not options.include_issue_history:
        return batches
    history_payload = build_issue_history_context(
        state,
        options=ReviewHistoryOptions(
            max_issues=options.issue_history_max_issues,
        ),
    )
    payload["historical_review_issues"] = history_payload
    for batch in batches:
        if not isinstance(batch, dict):
            continue
        batch_dims = batch.get("dimensions", [])
        batch["historical_issue_focus"] = build_batch_issue_focus(
            history_payload,
            dimensions=batch_dims,
            max_items=options.issue_history_max_batch_items,
        )
    return filter_batches_to_file_scope(
        batches,
        allowed_files=allowed_review_files,
    )


__all__ = ["_attach_issue_history_context", "_build_selected_prompts"]
