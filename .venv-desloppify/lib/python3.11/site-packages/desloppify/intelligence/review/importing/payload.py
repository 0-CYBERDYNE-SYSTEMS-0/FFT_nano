"""Payload parsing helpers for review import workflows."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from desloppify.intelligence.review.importing.contracts_types import (
    ReviewImportPayload,
    ReviewIssuePayload,
)

LEGACY_FINDINGS_ALIAS_SUNSET_DATE = "2026-12-31"
ALLOW_LEGACY_FINDINGS_ALIAS = True


@dataclass(frozen=True)
class ReviewImportEnvelope:
    """Validated shared payload shape for review imports."""

    issues: list[ReviewIssuePayload]
    assessments: dict[str, Any] | None
    reviewed_files: list[str]
    dimension_judgment: dict[str, dict[str, Any]] | None = None
    context_updates: dict[str, dict[str, Any]] | None = None


def normalize_legacy_findings_alias(
    payload: dict[str, Any],
    *,
    missing_issues_error: str,
    allow_legacy_findings: bool = ALLOW_LEGACY_FINDINGS_ALIAS,
) -> str | None:
    """Normalize legacy ``findings`` into canonical ``issues`` in one place.

    ``allow_legacy_findings`` is the compatibility cutoff flag; once flipped to
    ``False`` only canonical ``issues`` payloads are accepted.
    """
    if "issues" in payload:
        return None
    if "findings" not in payload:
        return missing_issues_error
    if not allow_legacy_findings:
        return (
            "legacy key 'findings' is no longer accepted; use 'issues' "
            f"(support sunset: {LEGACY_FINDINGS_ALIAS_SUNSET_DATE})"
        )
    payload["issues"] = payload.pop("findings")
    return None


def extract_reviewed_files(data: list[dict] | dict) -> list[str]:
    """Parse optional reviewed-file list from import payload."""
    if not isinstance(data, dict):
        return []
    raw = data.get("reviewed_files")
    if not isinstance(raw, list):
        return []

    reviewed: list[str] = []
    seen: set[str] = set()
    for item in raw:
        if not isinstance(item, str):
            continue
        path = item.strip()
        if not path or path in seen:
            continue
        seen.add(path)
        reviewed.append(path)
    return reviewed


def parse_review_import_payload(
    data: ReviewImportPayload | dict[str, Any],
    *,
    mode_name: str,
) -> ReviewImportEnvelope:
    """Parse shared review import payload shape for per-file/holistic flows."""
    if not isinstance(data, dict):
        raise ValueError(f"{mode_name} review import payload must be a JSON object")

    issues_list = data.get("issues")
    if issues_list is None:
        raise ValueError(f"{mode_name} review import payload must contain 'issues'")
    if not isinstance(issues_list, list):
        raise ValueError(f"{mode_name} review import payload 'issues' must be a list")
    for idx, entry in enumerate(issues_list):
        if not isinstance(entry, dict):
            raise ValueError(
                f"{mode_name} review import payload 'issues[{idx}]' must be an object"
            )

    assessments = data.get("assessments")
    if assessments is not None and not isinstance(assessments, dict):
        raise ValueError(
            f"{mode_name} review import payload 'assessments' must be an object"
        )
    raw_judgment = data.get("dimension_judgment")
    dimension_judgment = (
        raw_judgment if isinstance(raw_judgment, dict) else None
    )

    raw_context_updates = data.get("context_updates")
    context_updates = (
        raw_context_updates if isinstance(raw_context_updates, dict) else None
    )

    return ReviewImportEnvelope(
        issues=issues_list,
        assessments=assessments,
        reviewed_files=extract_reviewed_files(data),
        dimension_judgment=dimension_judgment,
        context_updates=context_updates,
    )


def normalize_review_confidence(value: object) -> str:
    """Normalize review confidence labels to high/medium/low."""
    confidence = str(value).strip().lower()
    return confidence if confidence in {"high", "medium", "low"} else "low"


def review_tier(confidence: str, *, holistic: bool) -> int:
    """Derive natural tier from review confidence and scope."""
    if confidence == "high":
        return 1 if holistic else 3
    if confidence == "medium":
        return 2 if holistic else 3
    return 3
