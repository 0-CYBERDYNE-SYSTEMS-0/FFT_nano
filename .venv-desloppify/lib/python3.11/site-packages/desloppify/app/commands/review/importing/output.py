"""Output and rendering helpers for review imports."""

from __future__ import annotations

import shlex
import sys
from typing import Any

from desloppify.engine._state.schema import StateModel
from desloppify.intelligence.review.importing.contracts_models import (
    AssessmentImportPolicyModel,
)
from desloppify.intelligence.review.importing.contracts_types import (
    AssessmentImportPolicy,
)

from .policy import (
    ATTESTED_EXTERNAL_ATTEST_EXAMPLE,
    assessment_mode_label,
)


def _print_import_error_hints(
    errors: list[str],
    *,
    import_file: str,
    colorize_fn,
) -> None:
    """Print actionable retry commands for common import policy failures."""
    joined = " ".join(err.lower() for err in errors)
    quoted_import = shlex.quote(import_file)
    import_cmd = (
        "desloppify review --import "
        f"{quoted_import} --attested-external --attest "
        f"\"{ATTESTED_EXTERNAL_ATTEST_EXAMPLE}\""
    )
    validate_cmd = (
        "desloppify review --validate-import "
        f"{quoted_import} --attested-external --attest "
        f"\"{ATTESTED_EXTERNAL_ATTEST_EXAMPLE}\""
    )
    issues_only_cmd = f"desloppify review --import {quoted_import}"

    if "--attested-external requires --attest containing both" in joined:
        print(
            colorize_fn(
                "  Hint: rerun with the required attestation template:",
                "yellow",
            ),
            file=sys.stderr,
        )
        print(colorize_fn(f"    `{import_cmd}`", "dim"), file=sys.stderr)
        print(
            colorize_fn(
                f"  Preflight without state changes: `{validate_cmd}`",
                "dim",
            ),
            file=sys.stderr,
        )
        return

    if (
        "--attested-external requires valid blind packet provenance" in joined
        or "supports runner='claude'" in joined
    ):
        print(
            colorize_fn(
                "  Hint: if provenance is valid, rerun with:",
                "yellow",
            ),
            file=sys.stderr,
        )
        print(colorize_fn(f"    `{import_cmd}`", "dim"), file=sys.stderr)
        print(
            colorize_fn(
                f"  Preflight without state changes: `{validate_cmd}`",
                "dim",
            ),
            file=sys.stderr,
        )
        print(
            colorize_fn(
                f"  Issues-only fallback: `{issues_only_cmd}`",
                "dim",
            ),
            file=sys.stderr,
        )


def print_import_load_errors(
    errors: list[str],
    *,
    import_file: str,
    colorize_fn,
) -> None:
    """Print import payload validation errors and actionable hints."""
    for err in errors:
        print(colorize_fn(f"  Error: {err}", "red"), file=sys.stderr)
    _print_import_error_hints(errors, import_file=import_file, colorize_fn=colorize_fn)


def print_assessment_mode_banner(
    policy: AssessmentImportPolicy,
    *,
    colorize_fn,
) -> None:
    """Print the selected assessment import mode to make policy explicit."""
    policy_model = AssessmentImportPolicyModel.from_mapping(policy)
    mode = policy_model.mode.strip().lower()
    assessments_present = bool(policy_model.assessments_present)
    if not assessments_present and mode == "none":
        return
    style = "yellow" if mode in {"manual_override", "issues_only"} else "dim"
    print(colorize_fn(f"  Assessment import mode: {assessment_mode_label(policy)}", style))


def print_assessment_policy_notice(
    policy: AssessmentImportPolicy,
    *,
    import_file: str,
    colorize_fn,
) -> None:
    """Render trust/override status for assessment-bearing imports."""
    policy_model = AssessmentImportPolicyModel.from_mapping(policy)
    if not policy_model.assessments_present:
        return
    mode = policy_model.mode.strip().lower()
    handlers = {
        "trusted": lambda: _print_trusted_policy_notice(policy_model, colorize_fn=colorize_fn),
        "trusted_internal": lambda: _print_trusted_internal_policy_notice(
            policy_model,
            colorize_fn=colorize_fn,
        ),
        "manual_override": lambda: _print_manual_override_policy_notice(
            policy_model,
            colorize_fn=colorize_fn,
        ),
        "attested_external": lambda: _print_attested_external_policy_notice(
            policy_model,
            colorize_fn=colorize_fn,
        ),
        "issues_only": lambda: _print_issues_only_policy_notice(
            policy_model,
            import_file=import_file,
            colorize_fn=colorize_fn,
        ),
    }
    handler = handlers.get(mode)
    if handler:
        handler()


def _print_reason_line(reason: str, *, colorize_fn) -> None:
    if reason:
        print(colorize_fn(f"  Reason: {reason}", "dim"))


def _print_trusted_policy_notice(policy_model: AssessmentImportPolicyModel, *, colorize_fn) -> None:
    packet_path = policy_model.provenance.packet_path.strip() or None
    detail = f" · blind packet {packet_path}" if packet_path else ""
    print(
        colorize_fn(
            f"  Assessment provenance: trusted blind batch artifact{detail}.",
            "dim",
        )
    )


def _print_trusted_internal_policy_notice(
    policy_model: AssessmentImportPolicyModel,
    *,
    colorize_fn,
) -> None:
    count = int(policy_model.assessment_count or 0)
    reason = policy_model.reason.strip()
    suffix = f" ({reason})" if reason else ""
    print(
        colorize_fn(
            f"  Assessment updates applied: {count} dimension(s){suffix}.",
            "dim",
        )
    )


def _print_manual_override_policy_notice(
    policy_model: AssessmentImportPolicyModel,
    *,
    colorize_fn,
) -> None:
    count = int(policy_model.assessment_count or 0)
    print(
        colorize_fn(
            f"  WARNING: applying {count} assessment update(s) via manual override from untrusted provenance.",
            "yellow",
        )
    )
    _print_reason_line(policy_model.reason.strip(), colorize_fn=colorize_fn)


def _print_attested_external_policy_notice(
    policy_model: AssessmentImportPolicyModel,
    *,
    colorize_fn,
) -> None:
    count = int(policy_model.assessment_count or 0)
    print(
        colorize_fn(
            f"  Assessment updates applied via attested external blind review: {count} dimension(s).",
            "dim",
        )
    )
    _print_reason_line(policy_model.reason.strip(), colorize_fn=colorize_fn)


def _print_issues_only_policy_notice(
    policy_model: AssessmentImportPolicyModel,
    *,
    import_file: str,
    colorize_fn,
) -> None:
    count = int(policy_model.assessment_count or 0)
    reason = policy_model.reason.strip()
    print(
        colorize_fn(
            "  WARNING: untrusted assessment source detected. "
            f"Imported issues only; skipped {count} assessment score update(s).",
            "yellow",
        )
    )
    _print_reason_line(reason, colorize_fn=colorize_fn)
    print(
        colorize_fn(
            "  Assessment scores in state were left unchanged.",
            "dim",
        )
    )
    print(
        colorize_fn(
            "  Happy path: use `desloppify review --run-batches --parallel --scan-after-import`.",
            "dim",
        )
    )
    print(
        colorize_fn(
            "  If you intentionally want manual assessment import, rerun with "
            f"`desloppify review --import {import_file} --manual-override --attest \"<why this is justified>\"`.",
            "dim",
        )
    )
    print(
        colorize_fn(
            "  Claude cloud path for durable scores: "
            f"`desloppify review --import {import_file} --attested-external "
            f"--attest \"{ATTESTED_EXTERNAL_ATTEST_EXAMPLE}\"`",
            "dim",
        )
    )


def print_skipped_validation_details(diff: dict[str, Any], *, colorize_fn) -> None:
    """Print validation warnings for skipped imported issues."""
    n_skipped = diff.get("skipped", 0)
    if n_skipped <= 0:
        return
    print(
        colorize_fn(
            f"\n  ⚠ {n_skipped} issue(s) skipped (validation errors):",
            "yellow",
        )
    )
    for detail in diff.get("skipped_details", []):
        reasons = detail["missing"]
        missing_fields = [r for r in reasons if not r.startswith("invalid ")]
        validation_errors = [r for r in reasons if r.startswith("invalid ")]
        parts = []
        if missing_fields:
            parts.append(f"missing {', '.join(missing_fields)}")
        parts.extend(validation_errors)
        print(
            colorize_fn(
                f"    #{detail['index']} ({detail['identifier']}): {'; '.join(parts)}",
                "yellow",
            )
        )


def print_assessments_summary(state: StateModel, *, colorize_fn) -> None:
    """Print holistic subjective assessment summary when present."""
    assessments = state.get("subjective_assessments") or {}
    if not assessments:
        return
    parts = [
        f"{key.replace('_', ' ')} {value['score']}"
        for key, value in sorted(assessments.items())
    ]
    print(colorize_fn(f"\n  Assessments: {', '.join(parts)}", "bold"))


def print_open_review_summary(state: StateModel, *, colorize_fn) -> str:
    """Print current open review work item count and return next command."""
    work_items = state.get("work_items") or state.get("issues", {})
    open_review = [
        issue
        for issue in work_items.values()
        if issue["status"] == "open" and issue.get("detector") == "review"
    ]
    if not open_review:
        return "desloppify scan"
    print(
        colorize_fn(
            f"\n  {len(open_review)} review work item{'s' if len(open_review) != 1 else ''} open total",
            "bold",
        )
    )
    print(colorize_fn("  Run `desloppify show review --status open` to see the work queue", "dim"))
    return "desloppify show review --status open"


def print_review_import_scores_and_integrity(
    state: StateModel,
    config: dict[str, Any],
    *,
    target_strict_score_from_config_fn,
    subjective_at_target_fn,
    subjective_rerun_command_fn,
    colorize_fn,
) -> list[dict[str, Any]]:
    """Print subjective integrity warnings (score line handled by print_score_update)."""
    target_strict = target_strict_score_from_config_fn(config)
    at_target = subjective_at_target_fn(
        state,
        state.get("dimension_scores", {}),
        target=target_strict,
    )
    if not at_target:
        return []

    command = subjective_rerun_command_fn(at_target, max_items=5)
    count = len(at_target)
    if count >= 2:
        print(
            colorize_fn(
                "  WARNING: "
                f"{count} subjective scores match the target score. "
                "On the next scan, those dimensions will be reset to 0.0 by the anti-gaming safeguard "
                f"unless you rerun and re-import objective reviews first: {command}",
                "red",
            )
        )
    else:
        print(
            colorize_fn(
                "  WARNING: "
                f"{count} subjective score matches the target score, indicating a high risk of gaming. "
                f"Can you rerun it by running {command} taking extra care to be objective.",
                "yellow",
            )
        )
    return at_target
