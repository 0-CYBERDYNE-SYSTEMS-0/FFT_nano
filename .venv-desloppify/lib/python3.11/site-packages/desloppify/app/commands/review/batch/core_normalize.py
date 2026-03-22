"""Batch payload validation and normalization helpers."""

from __future__ import annotations

from desloppify.intelligence.review.feedback_contract import (
    DIMENSION_NOTE_ISSUES_KEY,
    HIGH_SCORE_ISSUES_NOTE_THRESHOLD,
    LEGACY_DIMENSION_NOTE_ISSUES_KEY,
    LOW_SCORE_ISSUE_THRESHOLD,
)
from desloppify.intelligence.review.importing.contracts_types import (
    ReviewIssuePayload,
)
from desloppify.intelligence.review.importing.contracts_validation import (
    validate_review_issue_payload,
)
from desloppify.intelligence.review.importing.payload import (
    normalize_legacy_findings_alias,
)

from .core_models import (
    BatchDimensionJudgmentPayload,
    BatchDimensionNotePayload,
    BatchIssuePayload,
    BatchQualityPayload,
    DismissedConcernPayload,
    NormalizedBatchIssue,
)


def _validate_dimension_note(
    key: str,
    note_raw: object,
) -> tuple[list[object], str, str, str, str]:
    """Validate a single dimension_notes entry and return parsed fields.

    Returns (evidence, impact_scope, fix_scope, confidence, issues_preventing_higher_score).
    Raises ValueError on invalid structure.
    """
    if not isinstance(note_raw, dict):
        raise ValueError(
            f"dimension_notes missing object for assessed dimension: {key}"
        )
    evidence = note_raw.get("evidence")
    impact_scope = note_raw.get("impact_scope")
    fix_scope = note_raw.get("fix_scope")
    if not isinstance(evidence, list) or not evidence:
        raise ValueError(
            f"dimension_notes.{key}.evidence must be a non-empty array"
        )
    if not isinstance(impact_scope, str) or not impact_scope.strip():
        raise ValueError(
            f"dimension_notes.{key}.impact_scope must be a non-empty string"
        )
    if not isinstance(fix_scope, str) or not fix_scope.strip():
        raise ValueError(
            f"dimension_notes.{key}.fix_scope must be a non-empty string"
        )

    confidence_raw = str(note_raw.get("confidence", "medium")).strip().lower()
    confidence = (
        confidence_raw if confidence_raw in {"high", "medium", "low"} else "medium"
    )
    issues_note = str(note_raw.get(DIMENSION_NOTE_ISSUES_KEY, "")).strip()
    if not issues_note:
        issues_note = str(note_raw.get(LEGACY_DIMENSION_NOTE_ISSUES_KEY, "")).strip()
    return evidence, impact_scope, fix_scope, confidence, issues_note


def _normalize_abstraction_sub_axes(
    note_raw: dict[str, object],
    abstraction_sub_axes: tuple[str, ...],
) -> dict[str, float]:
    """Extract and clamp abstraction_fitness sub-axis scores from a note."""
    sub_axes_raw = note_raw.get("sub_axes")
    if sub_axes_raw is not None and not isinstance(sub_axes_raw, dict):
        raise ValueError(
            "dimension_notes.abstraction_fitness.sub_axes must be an object"
        )
    if not isinstance(sub_axes_raw, dict):
        return {}

    normalized: dict[str, float] = {}
    for axis in abstraction_sub_axes:
        axis_value = sub_axes_raw.get(axis)
        if axis_value is None:
            continue
        if isinstance(axis_value, bool) or not isinstance(axis_value, int | float):
            raise ValueError(
                f"dimension_notes.abstraction_fitness.sub_axes.{axis} "
                "must be numeric"
            )
        normalized[axis] = round(
            max(0.0, min(100.0, float(axis_value))),
            1,
        )
    return normalized


def _validate_dimension_judgment(
    key: str,
    raw: object,
    *,
    require_complete: bool = False,
    log_fn,
) -> BatchDimensionJudgmentPayload | None:
    """Validate a single dimension_judgment entry. Returns cleaned payload or None."""
    if not isinstance(raw, dict):
        if require_complete:
            raise ValueError(f"dimension_judgment.{key} must be an object")
        log_fn(f"  dimension_judgment.{key}: expected object, skipping")
        return None

    strengths = _normalize_dimension_judgment_strengths(
        key,
        raw.get("strengths"),
        require_complete=require_complete,
    )

    dimension_character = _normalize_dimension_judgment_text(
        key,
        raw.get("dimension_character"),
        field_name="dimension_character",
        require_complete=False,
        log_fn=log_fn,
    )
    if require_complete and not dimension_character:
        raise ValueError(
            f"dimension_judgment.{key} must include dimension_character"
        )

    score_rationale = _normalize_dimension_judgment_text(
        key,
        raw.get("score_rationale"),
        field_name="score_rationale",
        require_complete=require_complete,
        log_fn=log_fn,
        min_length=50,
    )

    if not dimension_character and not score_rationale and not strengths:
        return None

    result: BatchDimensionJudgmentPayload = {}
    if strengths:
        result["strengths"] = strengths
    if dimension_character:
        result["dimension_character"] = dimension_character
    if score_rationale:
        result["score_rationale"] = score_rationale
    return result


def _normalize_dimension_judgment_strengths(
    key: str,
    strengths_raw: object,
    *,
    require_complete: bool,
) -> list[str]:
    """Normalize the optional strengths list for one dimension judgment."""
    if isinstance(strengths_raw, list):
        return [
            str(item).strip()
            for item in strengths_raw[:5]
            if isinstance(item, str) and str(item).strip()
        ]
    # Strengths are now optional — backfilled from positive context insights
    return []


def _normalize_dimension_judgment_text(
    key: str,
    raw_value: object,
    *,
    field_name: str,
    require_complete: bool,
    log_fn,
    min_length: int | None = None,
) -> str:
    """Normalize one textual dimension-judgment field."""
    value = raw_value.strip() if isinstance(raw_value, str) else ""
    if not value:
        if require_complete:
            raise ValueError(
                f"dimension_judgment.{key}.{field_name} must be a non-empty string"
            )
        log_fn(f"  dimension_judgment.{key}.{field_name}: missing or empty")
        return ""
    if min_length is not None and len(value) < min_length:
        raise ValueError(
            f"dimension_judgment.{key}.{field_name}: "
            f"too short ({len(value)} chars, want ≥{min_length})"
        )
    return value


def _resolve_issue_scope(
    item: object,
    note: BatchDimensionNotePayload,
    *,
    field_name: str,
) -> str:
    """Resolve issue scope fields from the issue payload or dimension defaults."""
    raw_item = item if isinstance(item, dict) else {}
    return str(raw_item.get(field_name, note.get(field_name, ""))).strip()


def _build_normalized_issue(
    *,
    issue: ReviewIssuePayload,
    item: object,
    note: BatchDimensionNotePayload,
    idx: int,
) -> NormalizedBatchIssue:
    """Build one normalized issue payload or raise on missing scope defaults."""
    impact_scope = _resolve_issue_scope(item, note, field_name="impact_scope")
    fix_scope = _resolve_issue_scope(item, note, field_name="fix_scope")
    if not impact_scope or not fix_scope:
        raise ValueError(
            f"issues[{idx}] requires impact_scope and fix_scope "
            "(or dimension_notes defaults)"
        )
    return NormalizedBatchIssue(
        dimension=issue["dimension"],
        identifier=issue["identifier"],
        summary=issue["summary"],
        confidence=issue["confidence"],
        suggestion=issue["suggestion"],
        related_files=list(issue.get("related_files", [])),
        evidence=list(issue.get("evidence", [])),
        impact_scope=impact_scope,
        fix_scope=fix_scope,
        reasoning=str(issue.get("reasoning", "")),
        evidence_lines=list(issue.get("evidence_lines", []))
        if isinstance(issue.get("evidence_lines"), list)
        else None,
    )


def _build_dismissed_concern_payload(issue: ReviewIssuePayload) -> DismissedConcernPayload:
    """Return a minimal dismissed-concern payload preserved for later import."""
    payload: DismissedConcernPayload = {
        "concern_verdict": "dismissed",
        "concern_fingerprint": str(issue.get("concern_fingerprint", "")).strip(),
    }
    concern_type = str(issue.get("concern_type", "")).strip()
    concern_file = str(issue.get("concern_file", "")).strip()
    reasoning = str(issue.get("reasoning", "")).strip()
    if concern_type:
        payload["concern_type"] = concern_type
    if concern_file:
        payload["concern_file"] = concern_file
    if reasoning:
        payload["reasoning"] = reasoning
    return payload


def _raise_issue_schema_errors(errors: list[str]) -> None:
    """Raise a capped issue-schema validation error list."""
    if not errors:
        return
    visible = errors[:10]
    remaining = len(errors) - len(visible)
    if remaining > 0:
        visible.append(f"... {remaining} additional issue schema error(s) omitted")
    raise ValueError("; ".join(visible))


def _normalize_issues(
    raw_issues: object,
    dimension_notes: dict[str, BatchDimensionNotePayload],
    *,
    max_batch_issues: int,
    allowed_dims: set[str],
    low_score_dimensions: set[str] | None = None,
) -> tuple[list[NormalizedBatchIssue], list[BatchIssuePayload]]:
    """Validate and normalize the issues array from a batch payload."""
    if not isinstance(raw_issues, list):
        raise ValueError("issues must be an array")

    issues: list[NormalizedBatchIssue] = []
    dismissed_concerns: list[BatchIssuePayload] = []
    errors: list[str] = []
    for idx, item in enumerate(raw_issues):
        issue, issue_errors = _validated_batch_issue(
            item,
            idx=idx,
            allowed_dims=allowed_dims,
        )
        if issue_errors:
            errors.extend(issue_errors)
            continue
        if issue is None:
            raise ValueError(
                "batch issue payload missing after validation succeeded"
            )
        if issue.get("concern_verdict") == "dismissed":
            dismissed_concerns.append(_build_dismissed_concern_payload(issue))
            continue

        dim = issue["dimension"]
        note = dimension_notes.get(dim, {})
        try:
            issues.append(
                _build_normalized_issue(
                    issue=issue,
                    item=item,
                    note=note,
                    idx=idx,
                )
            )
        except ValueError as exc:
            errors.append(str(exc))
    _raise_issue_schema_errors(errors)
    if len(issues) <= max_batch_issues:
        return issues, dismissed_concerns

    return (
        _trim_normalized_issues(
            issues,
            max_batch_issues=max_batch_issues,
            low_score_dimensions=low_score_dimensions,
        ),
        dismissed_concerns,
    )


def _validated_batch_issue(
    item: object,
    *,
    idx: int,
    allowed_dims: set[str],
) -> tuple[ReviewIssuePayload | None, list[str]]:
    return validate_review_issue_payload(
        item,
        label=f"issues[{idx}]",
        allowed_dimensions=allowed_dims,
        allow_dismissed=True,
    )


def _trim_normalized_issues(
    issues: list[NormalizedBatchIssue],
    *,
    max_batch_issues: int,
    low_score_dimensions: set[str] | None,
) -> list[NormalizedBatchIssue]:
    required_dims = set(low_score_dimensions or set())
    if not required_dims:
        return issues[:max_batch_issues]

    selected, selected_indexes = _select_required_dimension_issues(
        issues,
        max_batch_issues=max_batch_issues,
        required_dims=required_dims,
    )
    return _fill_trimmed_issue_budget(
        issues,
        selected,
        selected_indexes=selected_indexes,
        max_batch_issues=max_batch_issues,
    )


def _select_required_dimension_issues(
    issues: list[NormalizedBatchIssue],
    *,
    max_batch_issues: int,
    required_dims: set[str],
) -> tuple[list[NormalizedBatchIssue], set[int]]:
    selected: list[NormalizedBatchIssue] = []
    selected_indexes: set[int] = set()
    covered: set[str] = set()
    for idx, issue in enumerate(issues):
        if len(selected) >= max_batch_issues:
            break
        dim = issue.dimension.strip()
        if dim not in required_dims or dim in covered:
            continue
        selected.append(issue)
        selected_indexes.add(idx)
        covered.add(dim)
    return selected, selected_indexes


def _fill_trimmed_issue_budget(
    issues: list[NormalizedBatchIssue],
    selected: list[NormalizedBatchIssue],
    *,
    selected_indexes: set[int],
    max_batch_issues: int,
) -> list[NormalizedBatchIssue]:
    for idx, issue in enumerate(issues):
        if len(selected) >= max_batch_issues:
            break
        if idx in selected_indexes:
            continue
        selected.append(issue)
    return selected


def _low_score_dimensions(assessments: dict[str, float]) -> set[str]:
    """Return assessed dimensions requiring explicit defect issues."""
    return {
        dim
        for dim, score in assessments.items()
        if score < LOW_SCORE_ISSUE_THRESHOLD
    }


def _enforce_low_score_issues(
    *,
    assessments: dict[str, float],
    issues: list[NormalizedBatchIssue],
) -> None:
    """Fail closed when low scores do not report explicit issues."""
    required_dims = _low_score_dimensions(assessments)
    if not required_dims:
        return
    issue_dims = {
        issue.dimension.strip() for issue in issues
    }
    missing = sorted(dim for dim in required_dims if dim not in issue_dims)
    if not missing:
        return
    joined = ", ".join(missing)
    raise ValueError(
        "low-score dimensions must include at least one explicit issue: "
        f"{joined} (threshold {LOW_SCORE_ISSUE_THRESHOLD:.1f})"
    )


def _compute_batch_quality(
    assessments: dict[str, float],
    issues: list[NormalizedBatchIssue],
    dimension_notes: dict[str, BatchDimensionNotePayload],
    high_score_missing_issue_note: float,
    expected_dimensions: int,
) -> BatchQualityPayload:
    """Compute quality metrics for a single batch result."""
    return {
        "dimension_coverage": round(
            len(assessments) / max(expected_dimensions, 1),
            3,
        ),
        "evidence_density": round(
            sum(len(note.get("evidence", [])) for note in dimension_notes.values())
            / max(len(issues), 1),
            3,
        ),
        "high_score_missing_issue_note": high_score_missing_issue_note,
    }


def _normalize_assessments_and_notes(
    *,
    raw_assessments: dict[object, object],
    raw_dimension_notes: dict[object, object],
    allowed_dims: set[str],
    abstraction_sub_axes: tuple[str, ...],
) -> tuple[dict[str, float], dict[str, BatchDimensionNotePayload], float]:
    """Normalize assessment scores and their required dimension notes."""
    assessments: dict[str, float] = {}
    dimension_notes: dict[str, BatchDimensionNotePayload] = {}
    high_score_missing_issue_note = 0.0
    for key, value in raw_assessments.items():
        if not isinstance(key, str) or not key or key not in allowed_dims:
            continue
        if isinstance(value, bool) or not isinstance(value, int | float):
            continue
        score = round(max(0.0, min(100.0, float(value))), 1)
        note_raw = raw_dimension_notes.get(key)
        evidence, impact_scope, fix_scope, confidence, issues_note = (
            _validate_dimension_note(key, note_raw)
        )
        if not isinstance(note_raw, dict):
            raise ValueError(
                f"dimension_notes missing object for assessed dimension: {key}"
            )
        if score > HIGH_SCORE_ISSUES_NOTE_THRESHOLD and not issues_note:
            high_score_missing_issue_note += 1

        note_payload: BatchDimensionNotePayload = {
            "evidence": [str(item).strip() for item in evidence if str(item).strip()],
            "impact_scope": impact_scope.strip(),
            "fix_scope": fix_scope.strip(),
            "confidence": confidence,
            "issues_preventing_higher_score": issues_note,
        }
        if key == "abstraction_fitness":
            normalized_sub_axes = _normalize_abstraction_sub_axes(
                note_raw, abstraction_sub_axes
            )
            if normalized_sub_axes:
                note_payload["sub_axes"] = normalized_sub_axes

        assessments[key] = score
        dimension_notes[key] = note_payload
    return assessments, dimension_notes, high_score_missing_issue_note


def _normalize_dimension_judgments(
    *,
    assessments: dict[str, float],
    raw_judgment: dict[object, object],
    log_fn,
) -> dict[str, BatchDimensionJudgmentPayload]:
    """Normalize required dimension_judgment entries for assessed dimensions."""
    dimension_judgment: dict[str, BatchDimensionJudgmentPayload] = {}
    for key in assessments:
        if key not in raw_judgment:
            raise ValueError(
                f"dimension_judgment missing entry for assessed dimension: {key}"
            )
        validated = _validate_dimension_judgment(
            key,
            raw_judgment.get(key),
            require_complete=True,
            log_fn=log_fn,
        )
        if validated is None:
            raise ValueError(
                f"dimension_judgment.{key} must include dimension_character and score_rationale"
            )
        dimension_judgment[key] = validated
    return dimension_judgment


_CONTEXT_HEADER_MAX_LENGTH = 80
_CONTEXT_DESCRIPTION_MAX_LENGTH = 500


def _normalize_context_additions(
    updates: dict[str, object],
) -> list[dict[str, object]]:
    """Normalize one dimension's ``add`` list for ``context_updates``."""
    add_raw = updates.get("add")
    if not isinstance(add_raw, list):
        return []

    validated: list[dict[str, object]] = []
    for item in add_raw:
        if not isinstance(item, dict):
            continue
        header = item.get("header")
        description = item.get("description")
        if not isinstance(header, str) or not header.strip():
            continue
        if not isinstance(description, str) or not description.strip():
            continue
        entry: dict[str, object] = {
            "header": header.strip()[:_CONTEXT_HEADER_MAX_LENGTH],
            "description": description.strip()[:_CONTEXT_DESCRIPTION_MAX_LENGTH],
            "settled": bool(item.get("settled", False)),
        }
        if item.get("positive") is not None:
            entry["positive"] = bool(item["positive"])
        validated.append(entry)
    return validated


def _normalize_context_header_list(
    updates: dict[str, object],
    *,
    key: str,
) -> list[str]:
    """Normalize one header-list operation from ``context_updates``."""
    raw_list = updates.get(key)
    if not isinstance(raw_list, list):
        return []
    return [header.strip() for header in raw_list if isinstance(header, str) and header.strip()]


def _normalize_dimension_context_updates(
    updates: dict[str, object],
) -> dict[str, object]:
    """Normalize one dimension's context update payload."""
    result: dict[str, object] = {}

    additions = _normalize_context_additions(updates)
    if additions:
        result["add"] = additions

    for key in ("remove", "settle", "unsettle"):
        headers = _normalize_context_header_list(updates, key=key)
        if headers:
            result[key] = headers

    return result


def _normalize_context_updates(
    payload: dict[str, object],
    allowed_dims: set[str],
) -> dict[str, dict[str, object]]:
    """Extract and validate context_updates from a batch payload.

    Silently drops malformed entries rather than failing the whole batch.
    """
    raw = payload.get("context_updates")
    if not isinstance(raw, dict):
        return {}

    result: dict[str, dict[str, object]] = {}
    for dim, updates in raw.items():
        if not isinstance(dim, str) or dim not in allowed_dims:
            continue
        if not isinstance(updates, dict):
            continue
        dim_result = _normalize_dimension_context_updates(updates)
        if dim_result:
            result[dim] = dim_result

    return result


def normalize_batch_result(
    payload: dict[str, object],
    allowed_dims: set[str],
    *,
    max_batch_issues: int,
    abstraction_sub_axes: tuple[str, ...],
    log_fn=lambda _msg: None,
) -> tuple[
    dict[str, float],
    list[BatchIssuePayload],
    dict[str, BatchDimensionNotePayload],
    dict[str, BatchDimensionJudgmentPayload],
    BatchQualityPayload,
    dict[str, dict[str, object]],
]:
    """Validate and normalize one batch payload."""
    if "assessments" not in payload:
        raise ValueError("payload missing required key: assessments")
    key_error = normalize_legacy_findings_alias(
        payload,
        missing_issues_error="payload missing required key: issues",
    )
    if key_error is not None:
        raise ValueError(key_error)

    raw_assessments = payload.get("assessments")
    if not isinstance(raw_assessments, dict):
        raise ValueError("assessments must be an object")

    raw_dimension_notes = payload.get("dimension_notes", {})
    if not isinstance(raw_dimension_notes, dict):
        raise ValueError("dimension_notes must be an object")

    assessments, dimension_notes, high_score_missing_issue_note = (
        _normalize_assessments_and_notes(
            raw_assessments=raw_assessments,
            raw_dimension_notes=raw_dimension_notes,
            allowed_dims=allowed_dims,
            abstraction_sub_axes=abstraction_sub_axes,
        )
    )

    raw_judgment = payload.get("dimension_judgment", {})
    if not isinstance(raw_judgment, dict):
        raise ValueError("dimension_judgment must be an object")
    dimension_judgment = _normalize_dimension_judgments(
        assessments=assessments,
        raw_judgment=raw_judgment,
        log_fn=log_fn,
    )

    issues, dismissed_concerns = _normalize_issues(
        payload.get("issues"),
        dimension_notes,
        max_batch_issues=max_batch_issues,
        allowed_dims=allowed_dims,
        low_score_dimensions=_low_score_dimensions(assessments),
    )
    _enforce_low_score_issues(assessments=assessments, issues=issues)

    quality = _compute_batch_quality(
        assessments,
        issues,
        dimension_notes,
        high_score_missing_issue_note,
        expected_dimensions=len(allowed_dims),
    )
    context_updates = _normalize_context_updates(payload, allowed_dims)
    all_issues: list[BatchIssuePayload] = [
        *[issue.to_payload() for issue in issues],
        *dismissed_concerns,
    ]
    return (
        assessments,
        all_issues,
        dimension_notes,
        dimension_judgment,
        quality,
        context_updates,
    )


__all__ = ["normalize_batch_result"]
