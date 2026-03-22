"""Public triage stage-policy operations shared by commands and runners."""

from __future__ import annotations

import argparse
from dataclasses import dataclass

from desloppify.app.commands.helpers.command_runtime import command_runtime
from desloppify.base.output.terminal import colorize
from desloppify.engine.plan_triage import (
    StagePrerequisite,
    TRIAGE_STAGE_PREREQUISITES,
    compute_triage_progress,
)
from desloppify.engine.plan_state import save_plan
from desloppify.engine.plan_triage import collect_triage_input, detect_recurring_patterns
from desloppify.state_io import utc_now

from ..confirmations.basic import MIN_ATTESTATION_LEN, validate_attestation
from ..observe_batches import observe_dimension_breakdown
from .reflect_accounting import validate_reflect_accounting


@dataclass(frozen=True)
class AutoConfirmStageRequest:
    """Configuration for one fold-confirm stage auto-confirmation."""

    stage_name: str
    stage_label: str
    blocked_heading: str
    confirm_cmd: str
    inline_hint: str
    dimensions: list[str] | None = None
    cluster_names: list[str] | None = None


@dataclass(frozen=True)
class ReflectAutoConfirmDeps:
    """Dependency bundle for reflect auto-confirm flows."""

    triage_input: object | None = None
    command_runtime_fn: object | None = None
    collect_triage_input_fn: object = collect_triage_input
    detect_recurring_patterns_fn: object = detect_recurring_patterns
    save_plan_fn: object | None = None


def require_prerequisite(
    stages: dict,
    *,
    flow: str,
    messages: dict[str, tuple[str, str]],
) -> bool:
    """Print consistent prerequisite guidance for one triage flow."""
    flow_stage = flow.removeprefix("complete:")
    progress = compute_triage_progress(stages)
    if flow_stage in stages or progress.current_stage == flow_stage:
        return True

    for prerequisite in TRIAGE_STAGE_PREREQUISITES.get(flow_stage, ()):
        stage_record = stages.get(prerequisite.stage_name)
        if stage_record is None:
            blocked_heading, command_hint = messages[prerequisite.stage_name]
            print(colorize(blocked_heading, "red"))
            print(colorize(command_hint, "dim"))
            return False
        if prerequisite.require_confirmation and not stage_record.get("confirmed_at"):
            blocked_heading, command_hint = messages[prerequisite.stage_name]
            print(colorize(blocked_heading, "red"))
            print(colorize(command_hint, "dim"))
            return False

    if progress.blocked_reason:
        print(colorize(f"  {progress.blocked_reason}", "red"))
        if progress.next_command:
            print(colorize(f"  Run: {progress.next_command}", "dim"))
        return False

    blocked_heading, command_hint = next(iter(messages.values()))
    print(colorize(blocked_heading, "red"))
    print(colorize(command_hint, "dim"))
    return False


def confirm_stage(
    *,
    plan: dict,
    stage_record: dict,
    attestation: str | None,
    request: AutoConfirmStageRequest,
    save_plan_fn=None,
    utc_now_fn=None,
) -> bool:
    """Auto-confirm one recorded stage with a validated attestation."""
    resolved_save_plan = save_plan_fn or save_plan
    resolved_utc_now = utc_now_fn or utc_now
    if stage_record.get("confirmed_at"):
        return True
    if not attestation or len(attestation.strip()) < MIN_ATTESTATION_LEN:
        print(colorize(f"  {request.blocked_heading}", "red"))
        print(colorize(f"  Run: {request.confirm_cmd}", "dim"))
        print(colorize(f"  {request.inline_hint}", "dim"))
        return False

    confirmed_text = attestation.strip()
    validation_err = validate_attestation(
        confirmed_text,
        request.stage_name,
        dimensions=request.dimensions,
        cluster_names=request.cluster_names,
    )
    if validation_err:
        print(colorize(f"  {validation_err}", "red"))
        return False

    stage_record["confirmed_at"] = resolved_utc_now()
    stage_record["confirmed_text"] = confirmed_text
    resolved_save_plan(plan)
    print(colorize(f"  ✓ {request.stage_label} auto-confirmed via --attestation.", "green"))
    return True


def auto_confirm_observe_if_attested(
    *,
    plan: dict,
    stages: dict,
    attestation: str | None,
    triage_input,
    save_plan_fn=None,
    utc_now_fn=None,
) -> bool:
    """Auto-confirm observe inline when the report already exists."""
    observe_stage = stages.get("observe")
    if observe_stage is None:
        return False
    _by_dim, dim_names = observe_dimension_breakdown(triage_input)
    return confirm_stage(
        plan=plan,
        stage_record=observe_stage,
        attestation=attestation,
        request=AutoConfirmStageRequest(
            stage_name="observe",
            stage_label="Observe",
            blocked_heading="Cannot reflect: observe stage not confirmed.",
            confirm_cmd="desloppify plan triage --confirm observe",
            inline_hint="Or pass --attestation to auto-confirm observe inline.",
            dimensions=dim_names,
        ),
        save_plan_fn=save_plan_fn,
        utc_now_fn=utc_now_fn,
    )


def auto_confirm_reflect_for_organize(
    *,
    args: argparse.Namespace,
    plan: dict,
    stages: dict,
    attestation: str | None,
    deps: ReflectAutoConfirmDeps | None = None,
    utc_now_fn=None,
) -> bool:
    """Auto-confirm reflect after validating its issue accounting."""
    reflect_stage = stages.get("reflect")
    if reflect_stage is None:
        return False

    resolved_deps = deps or ReflectAutoConfirmDeps()
    triage_input = resolved_deps.triage_input
    if triage_input is None:
        runtime_factory = resolved_deps.command_runtime_fn or command_runtime
        runtime = runtime_factory(args)
        triage_input = resolved_deps.collect_triage_input_fn(plan, runtime.state)

    review_issues = getattr(triage_input, "review_issues", getattr(triage_input, "open_issues", {}))
    valid_ids = set(review_issues.keys())
    accounting_ok, cited_ids, missing_ids, duplicate_ids = validate_reflect_accounting(
        report=str(reflect_stage.get("report", "")),
        valid_ids=valid_ids,
    )
    if not accounting_ok:
        return False
    reflect_stage["cited_ids"] = sorted(cited_ids)
    reflect_stage["missing_issue_ids"] = missing_ids
    reflect_stage["duplicate_issue_ids"] = duplicate_ids

    recurring = resolved_deps.detect_recurring_patterns_fn(
        review_issues,
        triage_input.resolved_issues,
    )
    _by_dim, observe_dims = observe_dimension_breakdown(triage_input)
    reflect_dims = sorted(set((list(recurring.keys()) if recurring else []) + observe_dims))
    reflect_clusters = [
        name for name, cluster in plan.get("clusters", {}).items() if not cluster.get("auto")
    ]
    return confirm_stage(
        plan=plan,
        stage_record=reflect_stage,
        attestation=attestation,
        request=AutoConfirmStageRequest(
            stage_name="reflect",
            stage_label="Reflect",
            blocked_heading="Cannot organize: reflect stage not confirmed.",
            confirm_cmd="desloppify plan triage --confirm reflect",
            inline_hint="Or pass --attestation to auto-confirm reflect inline.",
            dimensions=reflect_dims,
            cluster_names=reflect_clusters,
        ),
        save_plan_fn=resolved_deps.save_plan_fn,
        utc_now_fn=utc_now_fn,
    )


__all__ = [
    "AutoConfirmStageRequest",
    "ReflectAutoConfirmDeps",
    "StagePrerequisite",
    "auto_confirm_observe_if_attested",
    "auto_confirm_reflect_for_organize",
    "confirm_stage",
    "require_prerequisite",
]
