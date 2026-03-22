"""Validation and preflight helpers for resolve command flows."""

from __future__ import annotations

import argparse
import copy
import sys
from dataclasses import dataclass

from desloppify import state as state_mod
from desloppify.app.commands.helpers.attestation import (
    show_attestation_requirement,
    validate_attestation,
)
from desloppify.base.exception_sets import CommandError
from desloppify.base.output.terminal import colorize
from desloppify.engine._work_queue.core import ATTEST_EXAMPLE


def _emit_warning(message: str) -> None:
    """Write resolve preflight warnings to stderr consistently."""
    print(colorize(message, "yellow"), file=sys.stderr)


@dataclass(frozen=True)
class ResolveQueryContext:
    patterns: list[str]
    status: str
    resolved: list[str]
    next_command: str
    prev_overall: float | None
    prev_objective: float | None
    prev_strict: float | None
    prev_verified: float | None
    attestation: str | None
    narrative: dict
    state: dict


def _validate_resolve_inputs(args: argparse.Namespace, attestation: str | None) -> None:
    if args.status == "wontfix" and not args.note:
        raise CommandError(
            "Wontfix items become technical debt. Add --note to record your reasoning for future review."
        )
    if args.status == "open":
        return
    if not validate_attestation(attestation):
        show_attestation_requirement(
            "Manual resolve",
            attestation,
            ATTEST_EXAMPLE,
        )
        raise CommandError("Manual resolve requires a valid attestation.")


def _previous_score_snapshot(state: dict) -> state_mod.ScoreSnapshot:
    """Load a score snapshot for comparison after resolve operations."""
    return state_mod.score_snapshot(state)


def _preview_resolve_count(state: dict, patterns: list[str]) -> int:
    """Count unique open issues matching the provided patterns."""
    matched_ids: set[str] = set()
    for pattern in patterns:
        for issue in state_mod.match_issues(state, pattern, status_filter="open"):
            issue_id = issue.get("id")
            if issue_id:
                matched_ids.add(issue_id)
    return len(matched_ids)


def _estimate_wontfix_strict_delta(
    state: dict,
    args: argparse.Namespace,
    *,
    attestation: str | None,
    resolve_all_patterns_fn,
) -> float:
    """Estimate strict score drop if this resolve command is applied as wontfix."""
    before = state_mod.score_snapshot(state).strict
    if before is None:
        return 0.0

    preview_state = copy.deepcopy(state)
    resolve_all_patterns_fn(preview_state, args, attestation=attestation)
    after = state_mod.score_snapshot(preview_state).strict
    if after is None:
        return 0.0
    return max(0.0, before - after)


def _enforce_batch_wontfix_confirmation(
    state: dict,
    args: argparse.Namespace,
    *,
    attestation: str | None,
    resolve_all_patterns_fn,
) -> None:
    if args.status != "wontfix":
        return

    preview_count = _preview_resolve_count(state, args.patterns)
    if preview_count <= 10:
        return
    if getattr(args, "confirm_batch_wontfix", False):
        return

    strict_delta = _estimate_wontfix_strict_delta(
        state,
        args,
        attestation=attestation,
        resolve_all_patterns_fn=resolve_all_patterns_fn,
    )
    _emit_warning(f"Large wontfix batch detected ({preview_count} issues).")
    if strict_delta > 0:
        _emit_warning(f"Estimated strict-score debt added now: {strict_delta:.1f} points.")
    raise CommandError(
        "Re-run with --confirm-batch-wontfix if this debt is intentional."
    )
