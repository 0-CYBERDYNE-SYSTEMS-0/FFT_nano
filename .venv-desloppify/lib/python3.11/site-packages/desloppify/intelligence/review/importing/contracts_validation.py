"""Validation and normalization helpers for review issue import entries."""

from __future__ import annotations

from .contracts_types import (
    REVIEW_ISSUE_REQUIRED_FIELDS,
    VALID_REVIEW_CONFIDENCE,
    ReviewIssuePayload,
)


def _normalized_non_empty_text(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    text = value.strip()
    return text if text else None


def _normalized_non_empty_text_list(value: object) -> list[str] | None:
    if not isinstance(value, list):
        return None
    cleaned = [str(item).strip() for item in value if isinstance(item, str) and item.strip()]
    return cleaned if cleaned else None


def validate_review_issue_payload(
    issue: object,
    *,
    label: str,
    allowed_dimensions: set[str] | None = None,
    allow_dismissed: bool = True,
) -> tuple[ReviewIssuePayload | None, list[str]]:
    """Validate and normalize one review issue payload entry."""
    if not isinstance(issue, dict):
        return None, [f"{label} must be an object"]

    dismissed = issue.get("concern_verdict") == "dismissed"
    if dismissed and not allow_dismissed:
        return None, [f"{label}.concern_verdict='dismissed' is not allowed here"]

    if dismissed:
        fingerprint = _normalized_non_empty_text(issue.get("concern_fingerprint"))
        if fingerprint is None:
            return (
                None,
                [
                    f"{label}.concern_fingerprint is required when concern_verdict='dismissed'"
                ],
            )
        normalized: ReviewIssuePayload = {
            "concern_verdict": "dismissed",
            "concern_fingerprint": fingerprint,
        }
        concern_type = _normalized_non_empty_text(issue.get("concern_type"))
        if concern_type is not None:
            normalized["concern_type"] = concern_type
        concern_file = _normalized_non_empty_text(issue.get("concern_file"))
        if concern_file is not None:
            normalized["concern_file"] = concern_file
        reasoning = _normalized_non_empty_text(issue.get("reasoning"))
        if reasoning is not None:
            normalized["reasoning"] = reasoning
        return normalized, []

    errors: list[str] = []
    missing = [field for field in REVIEW_ISSUE_REQUIRED_FIELDS if field not in issue]
    if missing:
        errors.append(f"{label} missing required fields: {', '.join(missing)}")
        return None, errors

    dimension = _normalized_non_empty_text(issue.get("dimension"))
    if dimension is None:
        errors.append(f"{label}.dimension must be a non-empty string")
    elif allowed_dimensions is not None and dimension not in allowed_dimensions:
        errors.append(f"{label}.dimension '{dimension}' is not allowed")

    identifier = _normalized_non_empty_text(issue.get("identifier"))
    if identifier is None:
        errors.append(f"{label}.identifier must be a non-empty string")

    summary = _normalized_non_empty_text(issue.get("summary"))
    if summary is None:
        errors.append(f"{label}.summary must be a non-empty string")

    suggestion = _normalized_non_empty_text(issue.get("suggestion"))
    if suggestion is None:
        errors.append(f"{label}.suggestion must be a non-empty string")

    confidence = _normalized_non_empty_text(issue.get("confidence"))
    confidence_text = confidence.lower() if confidence is not None else ""
    if confidence_text not in VALID_REVIEW_CONFIDENCE:
        errors.append(f"{label}.confidence must be one of: high, medium, low")

    related_files = _normalized_non_empty_text_list(issue.get("related_files"))
    if related_files is None:
        errors.append(f"{label}.related_files must contain at least one file path string")

    evidence = _normalized_non_empty_text_list(issue.get("evidence"))
    if evidence is None:
        errors.append(f"{label}.evidence must contain at least one concrete evidence string")

    if errors:
        return None, errors

    normalized_payload: ReviewIssuePayload = {
        "dimension": dimension or "",
        "identifier": identifier or "",
        "summary": summary or "",
        "confidence": confidence_text,
        "suggestion": suggestion or "",
        "related_files": related_files or [],
        "evidence": evidence or [],
    }
    reasoning = _normalized_non_empty_text(issue.get("reasoning"))
    if reasoning is not None:
        normalized_payload["reasoning"] = reasoning
    concern_type = _normalized_non_empty_text(issue.get("concern_type"))
    if concern_type is not None:
        normalized_payload["concern_type"] = concern_type
    concern_file = _normalized_non_empty_text(issue.get("concern_file"))
    if concern_file is not None:
        normalized_payload["concern_file"] = concern_file
    file_path = _normalized_non_empty_text(issue.get("file"))
    if file_path is not None:
        normalized_payload["file"] = file_path
    evidence_lines = issue.get("evidence_lines")
    if isinstance(evidence_lines, list):
        normalized_lines = [line for line in evidence_lines if isinstance(line, int)]
        if normalized_lines:
            normalized_payload["evidence_lines"] = normalized_lines
    return normalized_payload, []


__all__ = ["validate_review_issue_payload"]
