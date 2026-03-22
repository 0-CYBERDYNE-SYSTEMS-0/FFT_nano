"""Whole-plan triage API.

Primary runtime triage orchestration is staged and lives in
``app.commands.plan.triage``. The single-shot ``triage_epics`` runtime
lives here; callers import from ``engine.plan_triage``.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import Any

from desloppify.engine._plan.schema import PlanModel, ensure_plan_defaults
from desloppify.engine._state.schema import StateModel

from desloppify.engine._plan.triage.apply import (
    TriageMutationResult,
    apply_triage_to_plan,
)
from desloppify.engine._plan.triage.parsing import (
    ISSUE_ID_RE,
    extract_issue_citations,
    parse_triage_result,
)
from desloppify.engine._plan.triage.prompt import (
    _TRIAGE_SYSTEM_PROMPT,
    ContradictionNote,
    DismissedIssue,
    TriageInput,
    TriageResult,
    build_triage_prompt,
    collect_triage_input,
)

logger = logging.getLogger(__name__)


def last_real_review_timestamp(state: dict) -> str | None:
    """ISO timestamp of most recent genuine review import (not manual override/scan reset)."""
    real_modes = {"holistic", "per_file", "trusted_internal", "attested_external"}
    audit = state.get("assessment_import_audit", [])
    if isinstance(audit, list):
        for entry in reversed(audit):
            if isinstance(entry, dict) and entry.get("mode") in real_modes:
                ts = entry.get("timestamp")
                if ts:
                    return str(ts)
    holistic = (state.get("review_cache") or {}).get("holistic")
    if isinstance(holistic, dict):
        return holistic.get("reviewed_at")
    return None


def detect_recurring_patterns(
    open_issues: dict[str, dict],
    resolved_issues: dict[str, dict],
) -> dict[str, dict]:
    """Detect dimensions with both resolved AND current open issues.

    Returns ``{dimension: {"open": [ids], "resolved": [ids]}}``.
    A dimension with both resolved and open issues signals a potential
    loop — similar issues recur after previous fixes.
    """

    def _dimension(finding: dict) -> str:
        detail = finding.get("detail", {})
        if isinstance(detail, dict):
            return detail.get("dimension", "")
        return ""

    open_by_dim: dict[str, list[str]] = {}
    for fid, finding in open_issues.items():
        dim = _dimension(finding)
        if dim:
            open_by_dim.setdefault(dim, []).append(fid)

    resolved_by_dim: dict[str, list[str]] = {}
    for fid, finding in resolved_issues.items():
        dim = _dimension(finding)
        if dim:
            resolved_by_dim.setdefault(dim, []).append(fid)

    recurring: dict[str, dict] = {}
    for dim in set(open_by_dim) & set(resolved_by_dim):
        recurring[dim] = {
            "open": open_by_dim[dim],
            "resolved": resolved_by_dim[dim],
        }
    return recurring


@dataclass
class TriageDeps:
    """Injectable dependencies for the triage engine."""

    llm_call: Any = None  # Callable[[str, str], str] — (system, user) -> response


def triage_epics(
    plan: PlanModel,
    state: StateModel,
    *,
    deps: TriageDeps | None = None,
    dry_run: bool = False,
    trigger: str = "manual",
) -> TriageMutationResult:
    """Run legacy whole-plan triage: collect input, call LLM, apply results.

    If ``dry_run`` is True, collects input and builds prompt but does not
    call the LLM or mutate the plan.

    If ``deps.llm_call`` is None, returns a dry-run result with the prompt.
    """
    ensure_plan_defaults(plan)
    si = collect_triage_input(plan, state)

    prompt = build_triage_prompt(si)
    valid_ids = set(si.review_issues.keys())

    if dry_run or deps is None or deps.llm_call is None:
        result = TriageMutationResult(dry_run=True)
        result.strategy_summary = f"[dry-run] Prompt built with {len(si.review_issues)} issues"
        return result

    try:
        raw_response = deps.llm_call(_TRIAGE_SYSTEM_PROMPT, prompt)
        raw_json = json.loads(raw_response)
    except (json.JSONDecodeError, TypeError, ValueError) as exc:
        logger.error("Cluster triage LLM response parse error: %s", exc)
        result = TriageMutationResult()
        result.strategy_summary = f"Triage failed: {exc}"
        return result

    triage = parse_triage_result(raw_json, valid_ids)
    return apply_triage_to_plan(plan, state, triage, trigger=trigger)


__all__ = [
    "ContradictionNote",
    "DismissedIssue",
    "ISSUE_ID_RE",
    "TriageDeps",
    "TriageInput",
    "TriageMutationResult",
    "TriageResult",
    "apply_triage_to_plan",
    "build_triage_prompt",
    "collect_triage_input",
    "detect_recurring_patterns",
    "extract_issue_citations",
    "last_real_review_timestamp",
    "parse_triage_result",
    "triage_epics",
]
