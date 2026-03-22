"""Compatibility re-exports for review import helpers.

Active import flows now depend on the smaller parse/output/policy modules
directly. This facade remains for tests and older imports.
"""

from __future__ import annotations

from desloppify.intelligence.review.importing.contracts_types import (
    NormalizedReviewImportPayload,
)

from .output import (
    print_assessment_mode_banner,
    print_assessment_policy_notice,
    print_assessments_summary,
    print_import_load_errors,
    print_open_review_summary,
    print_review_import_scores_and_integrity,
    print_skipped_validation_details,
)
from .parse import (
    ImportParseOptions,
    ImportPayloadLoadError,
    load_import_issues_data as parse_load_import_issues_data,
    resolve_override_context,
)
from .policy import (
    assessment_mode_label,
    assessment_policy_from_payload,
    assessment_policy_model_from_payload,
)

ImportLoadConfig = ImportParseOptions


def load_import_issues_data(
    import_file: str,
    *,
    config: ImportLoadConfig | None = None,
    options: ImportParseOptions | None = None,
) -> NormalizedReviewImportPayload:
    """Load import payload while preserving the legacy ``config=`` keyword."""
    return parse_load_import_issues_data(
        import_file,
        options=options or config,
    )

__all__ = [
    "ImportLoadConfig",
    "ImportPayloadLoadError",
    "assessment_mode_label",
    "assessment_policy_model_from_payload",
    "assessment_policy_from_payload",
    "load_import_issues_data",
    "print_assessment_mode_banner",
    "print_import_load_errors",
    "print_assessment_policy_notice",
    "print_assessments_summary",
    "print_open_review_summary",
    "print_review_import_scores_and_integrity",
    "print_skipped_validation_details",
    "resolve_override_context",
]
