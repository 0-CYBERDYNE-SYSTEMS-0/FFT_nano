"""Validation and guardrail helpers for triage stage workflow."""

from __future__ import annotations
from collections.abc import Callable

from desloppify.app.commands.helpers.command_runtime import command_runtime
from desloppify.base.output.terminal import colorize
from desloppify.engine.plan_state import save_plan
from desloppify.engine.plan_triage import collect_triage_input, detect_recurring_patterns
from desloppify.state_io import utc_now

from .completion_policy import (
    _completion_clusters_valid,
    _completion_strategy_valid,
    _confirm_existing_stages_valid,
    _confirm_note_valid,
    _confirm_strategy_valid,
    _confirmed_text_or_error,
    _note_cites_new_issues_or_error,
    _require_prior_strategy_for_confirm,
    _resolve_completion_strategy,
    _resolve_confirm_existing_strategy,
)
from .completion_stages import (
    _auto_confirm_enrich_for_complete,
    _auto_confirm_stage_for_complete,
    _require_enrich_stage_for_complete,
    _require_organize_stage_for_complete,
    _require_sense_check_stage_for_complete,
)
from .enrich_checks import (
    _cluster_file_overlaps,
    _clusters_with_directory_scatter,
    _clusters_with_high_step_ratio,
    _enrich_report_or_error,
    _require_organize_stage_for_enrich,
    _steps_missing_issue_refs,
    _steps_referencing_skipped_issues,
    _steps_with_bad_paths,
    _steps_with_vague_detail,
    _steps_without_effort,
    _underspecified_steps,
)
from .reflect_accounting import (
    ReflectDisposition,
    analyze_reflect_issue_accounting,
    parse_reflect_dispositions,
    validate_reflect_accounting,
)
from .organize_policy import (
    LedgerMismatch,
    _clusters_enriched_or_error,
    _manual_clusters_or_error,
    _organize_report_or_error,
    _unclustered_review_issues_or_error,
    _validate_organize_against_ledger_or_error,
    validate_organize_against_reflect_ledger,
)
from .stage_policy import (
    AutoConfirmStageRequest,
    ReflectAutoConfirmDeps,
    auto_confirm_observe_if_attested,
    auto_confirm_reflect_for_organize,
    confirm_stage,
    require_prerequisite,
)

require_stage_prerequisite = require_prerequisite
_analyze_reflect_issue_accounting = analyze_reflect_issue_accounting
_validate_reflect_issue_accounting = validate_reflect_accounting

RecurringDimensionBuckets = dict[str, dict[str, list[str]]]


def _auto_confirm_stage(
    *,
    plan: dict,
    stage_record: dict,
    attestation: str | None,
    request: AutoConfirmStageRequest,
    save_plan_fn: Callable[..., None] | None = None,
    utc_now_fn: Callable[[], str] | None = None,
) -> bool:
    return confirm_stage(
        plan=plan,
        stage_record=stage_record,
        attestation=attestation,
        request=request,
        save_plan_fn=save_plan_fn,
        utc_now_fn=utc_now_fn,
    )


def _auto_confirm_observe_if_attested(
    *,
    plan: dict,
    stages: dict,
    attestation: str | None,
    triage_input,
) -> bool:
    return auto_confirm_observe_if_attested(
        plan=plan,
        stages=stages,
        attestation=attestation,
        triage_input=triage_input,
        save_plan_fn=save_plan,
        utc_now_fn=utc_now,
    )


def _auto_confirm_reflect_for_organize(
    *,
    args,
    plan: dict,
    stages: dict,
    attestation: str | None,
    deps: ReflectAutoConfirmDeps | None = None,
) -> bool:
    resolved_deps = deps or ReflectAutoConfirmDeps()
    wrapped_deps = ReflectAutoConfirmDeps(
        triage_input=resolved_deps.triage_input,
        command_runtime_fn=resolved_deps.command_runtime_fn or command_runtime,
        collect_triage_input_fn=resolved_deps.collect_triage_input_fn or collect_triage_input,
        detect_recurring_patterns_fn=(
            resolved_deps.detect_recurring_patterns_fn or detect_recurring_patterns
        ),
        save_plan_fn=resolved_deps.save_plan_fn or save_plan,
    )
    return auto_confirm_reflect_for_organize(
        args=args,
        plan=plan,
        stages=stages,
        attestation=attestation,
        deps=wrapped_deps,
        utc_now_fn=utc_now,
    )


def _validate_recurring_dimension_mentions(
    *,
    report: str,
    recurring_dims: list[str],
    recurring: RecurringDimensionBuckets,
) -> bool:
    if not recurring_dims:
        return True
    report_lower = report.lower()
    mentioned = [dim for dim in recurring_dims if dim.lower() in report_lower]
    if mentioned:
        return True
    print(colorize("  Recurring patterns detected but not addressed in report:", "red"))
    for dim in recurring_dims:
        info = recurring[dim]
        print(
            colorize(
                f"    {dim}: {len(info['resolved'])} resolved, "
                f"{len(info['open'])} still open — potential loop",
                "yellow",
            )
        )
    print(colorize("  Your report must mention at least one recurring dimension name.", "dim"))
    return False


def _require_reflect_stage_for_organize(stages: dict) -> bool:
    return require_stage_prerequisite(
        stages,
        flow="organize",
        messages={
            "observe": (
                "  Cannot organize: observe stage not complete.",
                '  Run: desloppify plan triage --stage observe --report "..."',
            ),
            "reflect": (
                "  Cannot organize: reflect stage not complete.",
                '  Run: desloppify plan triage --stage reflect --report "..."',
            ),
        },
    )


__all__ = [
    "_auto_confirm_enrich_for_complete",
    "_auto_confirm_observe_if_attested",
    "AutoConfirmStageRequest",
    "_auto_confirm_stage_for_complete",
    "_auto_confirm_reflect_for_organize",
    "_cluster_file_overlaps",
    "_clusters_with_directory_scatter",
    "_clusters_with_high_step_ratio",
    "_clusters_enriched_or_error",
    "_enrich_report_or_error",
    "_unclustered_review_issues_or_error",
    "_validate_reflect_issue_accounting",
    "_completion_clusters_valid",
    "_completion_strategy_valid",
    "_confirm_existing_stages_valid",
    "_confirm_note_valid",
    "_confirm_strategy_valid",
    "_confirmed_text_or_error",
    "_manual_clusters_or_error",
    "_note_cites_new_issues_or_error",
    "_organize_report_or_error",
    "_require_enrich_stage_for_complete",
    "_require_organize_stage_for_complete",
    "_require_organize_stage_for_enrich",
    "_require_prior_strategy_for_confirm",
    "_require_reflect_stage_for_organize",
    "_require_sense_check_stage_for_complete",
    "_resolve_completion_strategy",
    "_resolve_confirm_existing_strategy",
    "_underspecified_steps",
    "_steps_missing_issue_refs",
    "_steps_referencing_skipped_issues",
    "_steps_with_bad_paths",
    "_steps_with_vague_detail",
    "_steps_without_effort",
    "_validate_organize_against_ledger_or_error",
    "_validate_recurring_dimension_mentions",
    "LedgerMismatch",
    "ReflectDisposition",
    "parse_reflect_dispositions",
    "require_stage_prerequisite",
    "validate_organize_against_reflect_ledger",
]
