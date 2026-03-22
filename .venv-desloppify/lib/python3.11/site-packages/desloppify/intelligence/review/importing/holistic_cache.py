"""Cache and coverage maintenance helpers for holistic review imports."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from desloppify.engine._state.schema import StateModel, utc_now
from desloppify.intelligence.review.dimensions.data import load_dimensions_for_lang
from desloppify.intelligence.review.importing.cache import refresh_review_file_cache
from desloppify.intelligence.review.selection import hash_file


def update_reviewed_file_cache(
    state: StateModel,
    reviewed_files: list[str],
    *,
    project_root: Path | str | None = None,
    utc_now_fn=utc_now,
) -> None:
    """Refresh per-file review cache entries from holistic payload metadata."""
    refresh_review_file_cache(
        state,
        reviewed_files=reviewed_files,
        issues_by_file=None,
        project_root=project_root,
        hash_file_fn=hash_file,
        utc_now_fn=utc_now_fn,
    )


def _resolve_total_files(state: StateModel, lang_name: str | None) -> int:
    """Best-effort total file count from codebase_metrics or review cache."""
    review_cache = state.get("review_cache", {})
    fallback = len(review_cache.get("files", {}))

    codebase_metrics: object = state.get("codebase_metrics", {})
    if not isinstance(codebase_metrics, dict):
        return fallback

    sources = []
    if lang_name:
        lang_metrics = codebase_metrics.get(lang_name)
        if isinstance(lang_metrics, dict):
            sources.append(lang_metrics)
    sources.append(codebase_metrics)

    for source in sources:
        metric_total = source.get("total_files")
        if isinstance(metric_total, int) and metric_total > 0:
            return metric_total

    return fallback


def update_holistic_review_cache(
    state: StateModel,
    issues_data: list[dict],
    *,
    lang_name: str | None = None,
    review_scope: dict[str, Any] | None = None,
    utc_now_fn=utc_now,
) -> None:
    """Store holistic review metadata in review_cache."""
    review_cache = state.setdefault("review_cache", {})
    now = utc_now_fn()
    _, holistic_prompts, _ = load_dimensions_for_lang(lang_name or "")

    valid = [
        issue
        for issue in issues_data
        if all(key in issue for key in ("dimension", "identifier", "summary", "confidence"))
        and issue["dimension"] in holistic_prompts
    ]

    total_override = review_scope.get("total_files") if isinstance(review_scope, dict) else None
    if (
        isinstance(total_override, int)
        and not isinstance(total_override, bool)
        and total_override > 0
    ):
        resolved_total_files = total_override
    else:
        resolved_total_files = _resolve_total_files(state, lang_name)

    holistic_entry: dict[str, Any] = {
        "reviewed_at": now,
        "file_count_at_review": resolved_total_files,
        "issue_count": len(valid),
    }
    if isinstance(review_scope, dict):
        reviewed_files_count = review_scope.get("reviewed_files_count")
        if (
            isinstance(reviewed_files_count, int)
            and not isinstance(reviewed_files_count, bool)
            and reviewed_files_count >= 0
        ):
            holistic_entry["reviewed_files_count"] = reviewed_files_count
        full_sweep_included = review_scope.get("full_sweep_included")
        if isinstance(full_sweep_included, bool):
            holistic_entry["full_sweep_included"] = full_sweep_included

    review_cache["holistic"] = holistic_entry


def _assessed_dimension_keys(state: StateModel) -> set[str]:
    """Return dimension keys that have real (non-placeholder) assessments."""
    assessments = state.get("subjective_assessments", {})
    if not isinstance(assessments, dict):
        return set()
    keys: set[str] = set()
    for dim_key, payload in assessments.items():
        if not isinstance(payload, dict):
            continue
        if payload.get("placeholder") is True:
            continue
        if payload.get("source") == "scan_reset_subjective":
            continue
        if payload.get("reset_by") == "scan_reset_subjective":
            continue
        keys.add(str(dim_key))
    return keys


def resolve_holistic_coverage_issues(
    state: StateModel,
    diff: dict[str, Any],
    *,
    utc_now_fn=utc_now,
) -> None:
    """Mark dimension-level subjective_review issues fixed when import covers them."""
    assessed = _assessed_dimension_keys(state)
    if not assessed:
        return
    work_items = state.get("work_items") or state.get("issues", {})
    state["work_items"] = work_items
    state["issues"] = work_items
    now = utc_now_fn()
    for issue in work_items.values():
        if issue.get("status") != "open":
            continue
        if issue.get("detector") != "subjective_review":
            continue
        dim_key = (issue.get("detail") or {}).get("dimension", "")
        if dim_key not in assessed:
            continue
        issue["status"] = "fixed"
        issue["resolved_at"] = now
        issue["note"] = "completed by review import"
        issue["resolution_attestation"] = {
            "kind": "agent_import",
            "text": "Dimension assessment imported; coverage marker superseded",
            "attested_at": now,
            "scan_verified": False,
        }
        diff["auto_resolved"] += 1


def resolve_reviewed_file_coverage_issues(
    state: StateModel,
    diff: dict[str, Any],
    reviewed_files: list[str],
    *,
    utc_now_fn=utc_now,
) -> None:
    """No-op — per-file coverage issues no longer exist.

    Kept for backward compatibility with callers that still invoke this.
    """


__all__ = [
    "resolve_holistic_coverage_issues",
    "resolve_reviewed_file_coverage_issues",
    "update_holistic_review_cache",
    "update_reviewed_file_cache",
]
