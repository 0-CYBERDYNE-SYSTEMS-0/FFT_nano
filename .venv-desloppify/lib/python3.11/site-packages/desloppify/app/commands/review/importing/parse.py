"""Payload parsing and validation helpers for review imports."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, TypedDict

from desloppify.base.coercions import coerce_optional_str
from desloppify.intelligence.review.dimensions.data import load_dimensions_for_lang
from desloppify.intelligence.review.feedback_contract import (
    ASSESSMENT_FEEDBACK_THRESHOLD,
    LOW_SCORE_ISSUE_THRESHOLD,
    score_requires_dimension_issue,
    score_requires_explicit_feedback,
)
from desloppify.intelligence.review.importing.contracts_models import (
    AssessmentImportPolicyModel,
)
from desloppify.intelligence.review.importing.contracts_types import (
    NormalizedReviewImportPayload,
    ReviewIssuePayload,
)
from desloppify.intelligence.review.importing.contracts_validation import (
    validate_review_issue_payload,
)
from desloppify.intelligence.review.importing.payload import (
    normalize_legacy_findings_alias,
)
from desloppify.engine._state.resolution import coerce_assessment_score

from .policy import (
    ASSESSMENT_POLICY_KEY,
    apply_assessment_import_policy,
)


class ImportRootPayload(TypedDict, total=False):
    """Top-level import payload shape prior to strict normalization."""

    issues: list[object]
    findings: list[object]
    assessments: dict[str, Any]
    reviewed_files: list[object]
    review_scope: dict[str, Any]
    provenance: dict[str, Any]
    dimension_notes: dict[str, Any]
    _assessment_policy: dict[str, Any]


class ImportPayloadLoadError(ValueError):
    """Raised when review import payload parsing/validation fails."""

    def __init__(self, errors: list[str]) -> None:
        cleaned = [str(error).strip() for error in errors if str(error).strip()]
        self.errors = cleaned
        message = "; ".join(cleaned) if cleaned else "import payload validation failed"
        super().__init__(message)


@dataclass(frozen=True)
class ImportParseOptions:
    """Import parse policy/options bundle."""

    lang_name: str | None = None
    allow_partial: bool = False
    trusted_assessment_source: bool = False
    trusted_assessment_label: str | None = None
    attested_external: bool = False
    manual_override: bool = False
    manual_attest: str | None = None


def _coerce_import_parse_options(
    options: ImportParseOptions | None = None,
) -> ImportParseOptions:
    """Resolve import-parse options from the typed dataclass contract."""
    base = options or ImportParseOptions()
    return ImportParseOptions(
        lang_name=coerce_optional_str(base.lang_name),
        allow_partial=bool(base.allow_partial),
        trusted_assessment_source=bool(base.trusted_assessment_source),
        trusted_assessment_label=coerce_optional_str(base.trusted_assessment_label),
        attested_external=bool(base.attested_external),
        manual_override=bool(base.manual_override),
        manual_attest=coerce_optional_str(base.manual_attest),
    )


def _normalize_import_payload_shape(
    payload: ImportRootPayload,
) -> tuple[NormalizedReviewImportPayload | None, list[str]]:
    """Normalize payload into required-key contract with strict type checks."""
    errors: list[str] = []
    issues = payload.get("issues")
    if not isinstance(issues, list):
        errors.append("issues must be a JSON array")
        issues = []

    assessments = _coerce_optional_object(payload, key="assessments", errors=errors)
    normalized_reviewed_files = _coerce_reviewed_files(payload, errors=errors)
    review_scope = _coerce_optional_object(payload, key="review_scope", errors=errors)
    provenance = _coerce_optional_object(payload, key="provenance", errors=errors)
    dimension_notes = _coerce_optional_object(payload, key="dimension_notes", errors=errors)

    policy = payload.get(ASSESSMENT_POLICY_KEY)
    normalized_policy = (
        policy if isinstance(policy, dict) else AssessmentImportPolicyModel().to_dict()
    )
    if errors:
        return None, errors
    return (
        {
            "issues": issues,
            "assessments": assessments,
            "reviewed_files": normalized_reviewed_files,
            "review_scope": review_scope,
            "provenance": provenance,
            "dimension_notes": dimension_notes,
            ASSESSMENT_POLICY_KEY: normalized_policy,
        },
        [],
    )


def _coerce_optional_object(
    payload: ImportRootPayload,
    *,
    key: str,
    errors: list[str],
) -> dict[str, Any]:
    """Normalize optional object payload fields to dictionaries."""
    value = payload.get(key)
    if value is None:
        return {}
    if isinstance(value, dict):
        return value
    errors.append(f"{key} must be an object when provided")
    return {}


def _coerce_reviewed_files(
    payload: ImportRootPayload, *, errors: list[str]
) -> list[str]:
    """Normalize reviewed_files to trimmed string list."""
    reviewed_files = payload.get("reviewed_files")
    if reviewed_files is None:
        return []
    if isinstance(reviewed_files, list):
        return [
            str(item).strip()
            for item in reviewed_files
            if isinstance(item, str) and str(item).strip()
        ]
    errors.append("reviewed_files must be an array when provided")
    return []


def resolve_override_context(
    *,
    manual_override: bool,
    manual_attest: str | None,
) -> tuple[bool, str | None]:
    """Normalize manual override settings into one explicit decision."""
    override = bool(manual_override)
    attest = manual_attest
    if isinstance(attest, str):
        attest = attest.strip()
    return override, attest


def _has_non_empty_strings(items: object) -> bool:
    """Return True when ``items`` is a list with at least one non-empty string."""
    return isinstance(items, list) and any(
        isinstance(item, str) and item.strip() for item in items
    )


def _validate_holistic_issues_schema(
    issues_data: NormalizedReviewImportPayload,
    *,
    lang_name: str | None = None,
) -> list[str]:
    """Validate strict holistic issue schema expected by issue import."""
    issues = issues_data["issues"]

    allowed_dimensions: set[str] = set()
    if isinstance(lang_name, str) and lang_name.strip():
        _, dimension_prompts, _ = load_dimensions_for_lang(lang_name)
        allowed_dimensions = set(dimension_prompts)

    errors: list[str] = []
    for idx, entry in enumerate(issues):
        _normalized: ReviewIssuePayload | None
        _normalized, entry_errors = validate_review_issue_payload(
            entry,
            label=f"issues[{idx}]",
            allowed_dimensions=allowed_dimensions or None,
            allow_dismissed=True,
        )
        for message in entry_errors:
            if (
                "is not allowed" in message
                and lang_name
                and "dimension '" in message
            ):
                message = message.replace(
                    "is not allowed",
                    f"is not valid for language '{lang_name}'",
                )
            errors.append(message)
    return errors


def _feedback_dimensions_from_issues(issues: object) -> set[str]:
    """Return dimensions with explicit improvement guidance in issues payload."""
    if not isinstance(issues, list):
        return set()
    dims: set[str] = set()
    for entry in issues:
        if not isinstance(entry, dict):
            continue
        dim = entry.get("dimension")
        if not isinstance(dim, str) or not dim.strip():
            continue
        suggestion = entry.get("suggestion")
        if isinstance(suggestion, str) and suggestion.strip():
            dims.add(dim.strip())
    return dims


def _feedback_dimensions_from_dimension_notes(dimension_notes: object) -> set[str]:
    """Return dimensions with concrete review evidence in dimension_notes payload."""
    if not isinstance(dimension_notes, dict):
        return set()
    dims: set[str] = set()
    for dim, note in dimension_notes.items():
        if not isinstance(dim, str) or not dim.strip():
            continue
        if not isinstance(note, dict):
            continue
        if not _has_non_empty_strings(note.get("evidence")):
            continue
        dims.add(dim.strip())
    return dims


def _validate_assessment_feedback(
    issues_data: NormalizedReviewImportPayload,
) -> tuple[list[str], list[str]]:
    """Return dimensions missing required feedback and required low-score issues."""
    assessments = issues_data["assessments"]
    if not assessments:
        return [], []

    issue_dims = _feedback_dimensions_from_issues(issues_data["issues"])
    feedback_dims = set(issue_dims)
    feedback_dims.update(
        _feedback_dimensions_from_dimension_notes(issues_data["dimension_notes"])
    )
    missing_feedback: list[str] = []
    missing_low_score_issues: list[str] = []
    for dim_name, payload in assessments.items():
        if not isinstance(dim_name, str) or not dim_name.strip():
            continue
        score = coerce_assessment_score(payload)
        if score is None:
            continue
        if score_requires_dimension_issue(score) and dim_name not in issue_dims:
            missing_low_score_issues.append(f"{dim_name} ({score:.1f})")
        if score_requires_explicit_feedback(score) and dim_name not in feedback_dims:
            missing_feedback.append(f"{dim_name} ({score:.1f})")
    return sorted(missing_feedback), sorted(missing_low_score_issues)


def _load_import_json(import_file: str) -> tuple[object | None, list[str]]:
    """Read import file and parse JSON payload."""
    issues_path = Path(import_file)
    if not issues_path.exists():
        return None, [f"file not found: {import_file}"]
    try:
        return json.loads(issues_path.read_text()), []
    except (json.JSONDecodeError, OSError) as exc:
        return None, [f"error reading issues: {exc}"]


def _normalize_import_root_payload(
    raw_payload: object,
) -> tuple[ImportRootPayload | None, list[str]]:
    """Normalize top-level payload shape before strict field validation."""
    payload = {"issues": raw_payload} if isinstance(raw_payload, list) else raw_payload
    if not isinstance(payload, dict):
        return None, ["issues file must contain a JSON array or object"]

    key_error = normalize_legacy_findings_alias(
        payload,
        missing_issues_error="issues object must contain an 'issues' key",
    )
    if key_error is not None:
        return None, [key_error]
    return payload, []


def _validate_override_option_conflicts(
    options: ImportParseOptions,
    *,
    override_enabled: bool,
) -> list[str]:
    """Validate mutually exclusive override/attestation option combinations."""
    if options.attested_external and override_enabled:
        return ["--attested-external cannot be combined with --manual-override"]
    if options.attested_external and options.allow_partial:
        return [
            "--attested-external cannot be combined with --allow-partial; "
            "attested score imports require fully valid issues payloads"
        ]
    if override_enabled and options.allow_partial:
        return [
            "--manual-override cannot be combined with --allow-partial; "
            "manual score imports require fully valid issues payloads"
        ]
    return []


def _validate_feedback_requirements(
    issues_data: NormalizedReviewImportPayload,
    *,
    override_enabled: bool,
    override_attest: str | None,
) -> list[str]:
    """Validate feedback and low-score issue requirements."""
    missing_feedback, missing_low_score_issues = _validate_assessment_feedback(issues_data)
    if missing_low_score_issues:
        if override_enabled:
            if not isinstance(override_attest, str) or not override_attest.strip():
                return ["--manual-override requires --attest"]
            return []
        return [
            f"assessments below {LOW_SCORE_ISSUE_THRESHOLD:.1f} must include at "
            "least one issue for that same dimension with a concrete suggestion. "
            f"Missing: {', '.join(missing_low_score_issues)}"
        ]
    if not missing_feedback:
        return []
    if override_enabled:
        if not isinstance(override_attest, str) or not override_attest.strip():
            return ["--manual-override requires --attest"]
        return []
    return [
        f"assessments below {ASSESSMENT_FEEDBACK_THRESHOLD:.1f} must include explicit feedback "
        "(issue with same dimension and non-empty suggestion, or "
        "dimension_notes evidence for that dimension). "
        f"Missing: {', '.join(missing_feedback)}"
    ]


def _validate_schema_requirements(
    issues_data: NormalizedReviewImportPayload,
    *,
    lang_name: str | None,
    allow_partial: bool,
) -> list[str]:
    """Validate holistic issue schema unless partial imports are enabled."""
    schema_errors = _validate_holistic_issues_schema(issues_data, lang_name=lang_name)
    if not schema_errors or allow_partial:
        return []
    visible_errors = schema_errors[:10]
    remaining = len(schema_errors) - len(visible_errors)
    errors = [
        "issues schema validation failed for holistic import. "
        "Fix payload or rerun with --allow-partial to continue."
    ]
    errors.extend(visible_errors)
    if remaining > 0:
        errors.append(f"... {remaining} additional schema error(s) omitted")
    return errors


def _parse_and_validate_import(
    import_file: str,
    *,
    options: ImportParseOptions | None = None,
) -> tuple[NormalizedReviewImportPayload | None, list[str]]:
    """Load, parse, and validate a review import file with filesystem I/O."""
    resolved_options = _coerce_import_parse_options(options)

    raw_payload, load_errors = _load_import_json(import_file)
    if load_errors:
        return None, load_errors
    normalized_root, root_errors = _normalize_import_root_payload(raw_payload)
    if root_errors:
        return None, root_errors
    if normalized_root is None:
        return None, ["issues payload root normalization returned no data"]

    normalized_issues_data, shape_errors = _normalize_import_payload_shape(normalized_root)
    if shape_errors:
        return None, shape_errors
    if normalized_issues_data is None:
        return None, ["issues payload normalization returned no data"]

    override_enabled, override_attest = resolve_override_context(
        manual_override=resolved_options.manual_override,
        manual_attest=resolved_options.manual_attest,
    )
    conflict_errors = _validate_override_option_conflicts(
        resolved_options,
        override_enabled=override_enabled,
    )
    if conflict_errors:
        return None, conflict_errors

    issues_data, policy_errors = apply_assessment_import_policy(
        normalized_issues_data,
        import_file=import_file,
        attested_external=resolved_options.attested_external,
        attested_attest=override_attest,
        manual_override=override_enabled,
        manual_attest=override_attest,
        trusted_assessment_source=resolved_options.trusted_assessment_source,
        trusted_assessment_label=resolved_options.trusted_assessment_label,
    )
    if policy_errors:
        return None, policy_errors
    if issues_data is None:
        return None, ["assessment import policy returned no payload"]

    feedback_errors = _validate_feedback_requirements(
        issues_data,
        override_enabled=override_enabled,
        override_attest=override_attest,
    )
    if feedback_errors:
        return None, feedback_errors

    schema_errors = _validate_schema_requirements(
        issues_data,
        lang_name=resolved_options.lang_name,
        allow_partial=resolved_options.allow_partial,
    )
    if schema_errors:
        return None, schema_errors

    return issues_data, []


def load_import_issues_data(
    import_file: str,
    *,
    colorize_fn=None,
    options: ImportParseOptions | None = None,
) -> NormalizedReviewImportPayload:
    """Load and normalize review import payload to object format.

    Raises ``ImportPayloadLoadError`` when validation fails.
    """
    resolved_options = _coerce_import_parse_options(options)
    data, errors = _parse_and_validate_import(
        import_file,
        options=resolved_options,
    )
    if errors:
        raise ImportPayloadLoadError(errors)
    if data is None:
        raise ImportPayloadLoadError(["import payload is empty after validation"])
    return data
