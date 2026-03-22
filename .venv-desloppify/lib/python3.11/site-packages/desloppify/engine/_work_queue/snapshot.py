"""Canonical queue snapshot for phase and visibility decisions."""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any, NamedTuple

from desloppify.base.config import DEFAULT_TARGET_STRICT_SCORE
from desloppify.engine._plan.cluster_semantics import (
    cluster_is_active,
)
from desloppify.engine._plan.constants import (
    WORKFLOW_DEFERRED_DISPOSITION_ID,
    WORKFLOW_RUN_SCAN_ID,
)
from desloppify.engine._plan.schema import (
    executable_objective_ids as _executable_objective_ids,
    live_planned_queue_ids as _live_planned_queue_ids,
)
from desloppify.engine._plan.refresh_lifecycle import (
    LIFECYCLE_PHASE_ASSESSMENT_POSTFLIGHT,
    LIFECYCLE_PHASE_EXECUTE,
    LIFECYCLE_PHASE_REVIEW_INITIAL,
    LIFECYCLE_PHASE_REVIEW_POSTFLIGHT,
    LIFECYCLE_PHASE_REVIEW,
    LIFECYCLE_PHASE_SCAN,
    LIFECYCLE_PHASE_TRIAGE_POSTFLIGHT,
    LIFECYCLE_PHASE_TRIAGE,
    LIFECYCLE_PHASE_WORKFLOW_POSTFLIGHT,
    LIFECYCLE_PHASE_WORKFLOW,
    current_lifecycle_phase,
    postflight_scan_pending,
)
from desloppify.engine._plan.triage.snapshot import build_triage_snapshot
from desloppify.engine._state.filtering import path_scoped_issues
from desloppify.engine._state.issue_semantics import (
    counts_toward_objective_backlog,
    is_assessment_request,
    is_triage_finding,
)
from desloppify.engine._state.schema import StateModel
from desloppify.engine._work_queue.ranking import build_issue_items
from desloppify.engine._work_queue.synthetic import (
    build_subjective_items,
    build_triage_stage_items,
)
from desloppify.engine._work_queue.synthetic_workflow import (
    build_communicate_score_item,
    build_create_plan_item,
    build_deferred_disposition_item,
    build_import_scores_item,
    build_run_scan_item,
    build_score_checkpoint_item,
)
from desloppify.engine._work_queue.types import WorkQueueItem

PHASE_REVIEW_INITIAL = LIFECYCLE_PHASE_REVIEW_INITIAL
PHASE_EXECUTE = LIFECYCLE_PHASE_EXECUTE
PHASE_SCAN = LIFECYCLE_PHASE_SCAN
PHASE_ASSESSMENT_POSTFLIGHT = LIFECYCLE_PHASE_ASSESSMENT_POSTFLIGHT
PHASE_REVIEW_POSTFLIGHT = LIFECYCLE_PHASE_REVIEW_POSTFLIGHT
PHASE_WORKFLOW_POSTFLIGHT = LIFECYCLE_PHASE_WORKFLOW_POSTFLIGHT
PHASE_TRIAGE_POSTFLIGHT = LIFECYCLE_PHASE_TRIAGE_POSTFLIGHT

# Maps fine-grained phase → partition field that must be non-empty for it to be valid.
# Used by _phase_for_snapshot to trust the persisted phase.
_FINE_GRAINED_ITEM_MAP: dict[str, str | None] = {
    PHASE_REVIEW_INITIAL: "initial_review_items",
    PHASE_ASSESSMENT_POSTFLIGHT: "postflight_assessment_items",
    PHASE_WORKFLOW_POSTFLIGHT: "postflight_workflow_items",
    PHASE_TRIAGE_POSTFLIGHT: "triage_items",
    PHASE_REVIEW_POSTFLIGHT: "postflight_review_items",
    PHASE_SCAN: "scan_items",
}

# Coarse phases that trigger postflight-sticky inference (legacy plans).
_COARSE_POSTFLIGHT_PHASES = {
    LIFECYCLE_PHASE_REVIEW,
    LIFECYCLE_PHASE_WORKFLOW,
    LIFECYCLE_PHASE_TRIAGE,
}


@dataclass(frozen=True)
class QueueSnapshot:
    """Canonical queue facts and partitions for one invocation."""

    phase: str
    all_objective_items: tuple[WorkQueueItem, ...]
    all_initial_review_items: tuple[WorkQueueItem, ...]
    all_postflight_assessment_items: tuple[WorkQueueItem, ...]
    all_postflight_review_items: tuple[WorkQueueItem, ...]
    all_scan_items: tuple[WorkQueueItem, ...]
    all_postflight_workflow_items: tuple[WorkQueueItem, ...]
    all_postflight_triage_items: tuple[WorkQueueItem, ...]
    execution_items: tuple[WorkQueueItem, ...]
    backlog_items: tuple[WorkQueueItem, ...]
    objective_in_scope_count: int
    planned_objective_count: int
    objective_execution_count: int
    objective_backlog_count: int
    subjective_initial_count: int
    assessment_postflight_count: int
    subjective_postflight_count: int
    workflow_postflight_count: int
    triage_pending_count: int
    has_unplanned_objective_blockers: bool


# ---------------------------------------------------------------------------
# Internal helpers — option resolution, item classification
# ---------------------------------------------------------------------------

def _option_value(options: object | None, name: str, default: Any) -> Any:
    if options is None:
        return default
    return getattr(options, name, default)


def _resolved_scan_path(options: object | None, state: StateModel) -> str | None:
    scan_path = _option_value(options, "scan_path", state.get("scan_path"))
    if hasattr(scan_path, "__class__") and scan_path.__class__.__name__ == "_ScanPathFromState":
        return state.get("scan_path")
    return scan_path


def _is_fresh_boundary(plan: dict | None) -> bool:
    if not isinstance(plan, dict):
        return True
    scores = plan.get("plan_start_scores")
    if not scores:
        return True
    return isinstance(scores, dict) and bool(scores.get("reset"))


def _is_objective_item(item: WorkQueueItem, *, skipped_ids: set[str]) -> bool:
    return (
        item.get("kind") in {"issue", "cluster"}
        and counts_toward_objective_backlog(item)
        and item.get("id", "") not in skipped_ids
    )


def _review_issue_items(items: Iterable[WorkQueueItem]) -> list[WorkQueueItem]:
    return [
        item for item in items
        if is_triage_finding(item)
    ]


def _assessment_request_items(items: Iterable[WorkQueueItem]) -> list[WorkQueueItem]:
    return [
        item for item in items
        if is_assessment_request(item)
    ]


def _active_cluster_issue_ids(plan: dict | None) -> set[str]:
    """Return issue IDs owned by clusters that are active planned work."""
    if not isinstance(plan, dict):
        return set()
    active_ids: set[str] = set()
    skipped_ids = set(plan.get("skipped", {}).keys())
    for cluster in plan.get("clusters", {}).values():
        if not isinstance(cluster, dict) or not cluster_is_active(cluster):
            continue
        for issue_id in cluster.get("issue_ids", []):
            if isinstance(issue_id, str) and issue_id and issue_id not in skipped_ids:
                active_ids.add(issue_id)
    return active_ids


def _all_cluster_issue_ids(plan: dict | None) -> set[str]:
    """Return issue IDs owned by any cluster (regardless of status)."""
    if not isinstance(plan, dict):
        return set()
    all_ids: set[str] = set()
    for cluster in plan.get("clusters", {}).values():
        if not isinstance(cluster, dict):
            continue
        for issue_id in cluster.get("issue_ids", []):
            if isinstance(issue_id, str) and issue_id:
                all_ids.add(issue_id)
    return all_ids


def _merge_execution_candidates(
    *,
    all_issue_items: list[WorkQueueItem],
    explicit_objective_items: list[WorkQueueItem],
    plan: dict | None,
    review_issue_ids: set[str],
    assessment_request_ids: set[str],
) -> tuple[list[WorkQueueItem], list[WorkQueueItem]]:
    """Merge queue-owned execution items with objective defaults."""
    explicit_queue_ids = _live_planned_queue_ids(plan)
    active_cluster_ids = _active_cluster_issue_ids(plan)

    queued_non_review_items = [
        item
        for item in all_issue_items
        if item.get("id", "") in explicit_queue_ids
        and item.get("id", "") not in assessment_request_ids
        and (
            item.get("id", "") not in review_issue_ids
            or item.get("id", "") in active_cluster_ids
        )
    ]

    execution_candidates: list[WorkQueueItem] = []
    seen_execution_ids: set[str] = set()
    for item in [*explicit_objective_items, *queued_non_review_items]:
        item_id = str(item.get("id", ""))
        if not item_id or item_id in seen_execution_ids:
            continue
        seen_execution_ids.add(item_id)
        execution_candidates.append(item)

    anchored_execution_items = [
        item
        for item in execution_candidates
        if item.get("id", "") in explicit_queue_ids
    ]
    return execution_candidates, anchored_execution_items


def _executable_review_issue_items(
    plan: dict | None,
    state: StateModel,
    review_issue_items: list[WorkQueueItem],
) -> list[WorkQueueItem]:
    """Hide raw review findings until triage is current for the live issue set."""
    if not review_issue_items or not isinstance(plan, dict):
        return review_issue_items

    triage_snapshot = build_triage_snapshot(plan, state)
    if triage_snapshot.has_triage_in_queue:
        return []
    if triage_snapshot.is_triage_stale:
        return []
    if not triage_snapshot.triage_has_run:
        return []
    return review_issue_items


def _subjective_partitions(
    state: StateModel,
    *,
    scoped_issues: dict[str, dict],
    threshold: float,
    plan: dict | None,
) -> tuple[list[WorkQueueItem], list[WorkQueueItem]]:
    candidates = build_subjective_items(state, scoped_issues, threshold=threshold, plan=plan)
    initial = [item for item in candidates if item.get("initial_review")]
    postflight = [item for item in candidates if not item.get("initial_review")]
    return initial, postflight


def _workflow_partitions(
    plan: dict | None,
    state: StateModel,
) -> tuple[list[WorkQueueItem], list[WorkQueueItem], list[WorkQueueItem]]:
    if not isinstance(plan, dict):
        return [], [], []
    scan_items = [
        item
        for item in (
            build_deferred_disposition_item(plan),
            build_run_scan_item(plan),
        )
        if item is not None
    ]
    postflight_workflow = [
        item
        for item in (
            build_score_checkpoint_item(plan, state),
            build_import_scores_item(plan, state),
            build_communicate_score_item(plan, state),
            build_create_plan_item(plan),
        )
        if item is not None
    ]
    triage_items = build_triage_stage_items(plan, state)
    return scan_items, postflight_workflow, triage_items


# ---------------------------------------------------------------------------
# Phase resolution — persisted fine-grained phase with legacy fallback
# ---------------------------------------------------------------------------

def _raw_persisted_phase(plan: dict | None) -> str | None:
    """Read the raw lifecycle_phase string from the plan, without validation."""
    if not isinstance(plan, dict):
        return None
    refresh_state = plan.get("refresh_state")
    if isinstance(refresh_state, dict):
        phase = refresh_state.get("lifecycle_phase")
        if isinstance(phase, str):
            return phase
    return None


def _phase_for_snapshot(
    plan: dict | None,
    *,
    fresh_boundary: bool,
    initial_review_items: list[WorkQueueItem],
    anchored_execution_items: list[WorkQueueItem],
    explicit_queue_items: list[WorkQueueItem],
    scan_items: list[WorkQueueItem],
    review_backlog_present: bool,
    undispositioned_review_backlog_present: bool,
    postflight_assessment_items: list[WorkQueueItem],
    postflight_review_items: list[WorkQueueItem],
    postflight_workflow_items: list[WorkQueueItem],
    triage_items: list[WorkQueueItem],
) -> str:
    raw_phase = _raw_persisted_phase(plan)

    ordered_postflight_phase = _ordered_postflight_phase(
        postflight_assessment_items=postflight_assessment_items,
        postflight_review_items=postflight_review_items,
        postflight_workflow_items=postflight_workflow_items,
        triage_items=triage_items,
    )

    # ── Fine-grained persisted phase: trust it if items match ──
    if raw_phase in {
        PHASE_ASSESSMENT_POSTFLIGHT,
        PHASE_REVIEW_POSTFLIGHT,
        PHASE_WORKFLOW_POSTFLIGHT,
        PHASE_TRIAGE_POSTFLIGHT,
    } and ordered_postflight_phase is not None:
        return ordered_postflight_phase
    if raw_phase in _FINE_GRAINED_ITEM_MAP:
        items_key = _FINE_GRAINED_ITEM_MAP[raw_phase]
        items = locals().get(items_key) if items_key else None
        if items_key is None or items:
            return raw_phase
    # Execute needs special check (two possible item lists).
    if raw_phase == LIFECYCLE_PHASE_EXECUTE and (anchored_execution_items or explicit_queue_items):
        return PHASE_EXECUTE

    # ── Legacy inference for coarse-phase or missing-phase plans ──
    return _legacy_phase_inference(
        plan,
        fresh_boundary=fresh_boundary,
        initial_review_items=initial_review_items,
        anchored_execution_items=anchored_execution_items,
        explicit_queue_items=explicit_queue_items,
        scan_items=scan_items,
        review_backlog_present=review_backlog_present,
        undispositioned_review_backlog_present=undispositioned_review_backlog_present,
        postflight_assessment_items=postflight_assessment_items,
        postflight_review_items=postflight_review_items,
        postflight_workflow_items=postflight_workflow_items,
        triage_items=triage_items,
    )


def _ordered_postflight_phase(
    *,
    postflight_assessment_items: list[WorkQueueItem],
    postflight_review_items: list[WorkQueueItem],
    postflight_workflow_items: list[WorkQueueItem],
    triage_items: list[WorkQueueItem],
) -> str | None:
    """Return the earliest active postflight phase in fixed sequence order."""
    if postflight_assessment_items:
        return PHASE_ASSESSMENT_POSTFLIGHT
    if postflight_workflow_items:
        return PHASE_WORKFLOW_POSTFLIGHT
    if triage_items:
        return PHASE_TRIAGE_POSTFLIGHT
    if postflight_review_items:
        return PHASE_REVIEW_POSTFLIGHT
    return None


def _legacy_phase_inference(
    plan: dict | None,
    *,
    fresh_boundary: bool,
    initial_review_items: list[WorkQueueItem],
    anchored_execution_items: list[WorkQueueItem],
    explicit_queue_items: list[WorkQueueItem],
    scan_items: list[WorkQueueItem],
    review_backlog_present: bool,
    undispositioned_review_backlog_present: bool,
    postflight_assessment_items: list[WorkQueueItem],
    postflight_review_items: list[WorkQueueItem],
    postflight_workflow_items: list[WorkQueueItem],
    triage_items: list[WorkQueueItem],
) -> str:
    """Infer the phase from item partitions for plans without fine-grained phases.

    This handles old plans that persisted coarse phases ("review", "workflow",
    "triage") or have no persisted phase at all.  As plans are migrated to
    fine-grained phases by the reconcile pipeline, this code path is exercised
    less frequently.
    """
    persisted_phase = (
        current_lifecycle_phase(plan) if isinstance(plan, dict) else None
    )

    # Coarse "postflight sticky" — old plans that persisted a coarse phase
    # need priority-ordered inference within that phase family.
    postflight_sticky = (
        isinstance(plan, dict)
        and persisted_phase in _COARSE_POSTFLIGHT_PHASES
        and not postflight_scan_pending(plan)
    )

    if fresh_boundary and initial_review_items:
        return PHASE_REVIEW_INITIAL

    if postflight_sticky:
        result = _sticky_postflight_phase(
            persisted_phase,
            postflight_assessment_items=postflight_assessment_items,
            postflight_review_items=postflight_review_items,
            postflight_workflow_items=postflight_workflow_items,
            triage_items=triage_items,
            review_backlog_present=review_backlog_present,
        )
        if result is not None:
            return result

    if anchored_execution_items:
        return PHASE_EXECUTE
    if scan_items:
        return PHASE_SCAN
    if explicit_queue_items and (
        not isinstance(plan, dict) or postflight_scan_pending(plan)
    ):
        return PHASE_EXECUTE

    # Postflight sequence: assessment → workflow → triage → review → execute.
    if postflight_assessment_items:
        return PHASE_ASSESSMENT_POSTFLIGHT
    if postflight_workflow_items:
        return PHASE_WORKFLOW_POSTFLIGHT
    if undispositioned_review_backlog_present and postflight_review_items:
        return PHASE_REVIEW_POSTFLIGHT
    if explicit_queue_items:
        return PHASE_EXECUTE
    if postflight_review_items:
        return PHASE_REVIEW_POSTFLIGHT
    if triage_items:
        return PHASE_TRIAGE_POSTFLIGHT
    return PHASE_SCAN


def _sticky_postflight_phase(
    persisted_phase: str | None,
    *,
    postflight_assessment_items: list[WorkQueueItem],
    postflight_review_items: list[WorkQueueItem],
    postflight_workflow_items: list[WorkQueueItem],
    triage_items: list[WorkQueueItem],
    review_backlog_present: bool,
) -> str | None:
    """Resolve phase within a coarse postflight-sticky context.

    Returns None if no items match, letting the caller fall through.
    """
    if persisted_phase == LIFECYCLE_PHASE_WORKFLOW:
        candidates = [
            (postflight_workflow_items, PHASE_WORKFLOW_POSTFLIGHT),
            (triage_items, PHASE_TRIAGE_POSTFLIGHT),
            (postflight_assessment_items, PHASE_ASSESSMENT_POSTFLIGHT),
            (postflight_review_items, PHASE_REVIEW_POSTFLIGHT),
        ]
    elif persisted_phase == LIFECYCLE_PHASE_TRIAGE:
        candidates = [
            (triage_items, PHASE_TRIAGE_POSTFLIGHT),
            (postflight_workflow_items, PHASE_WORKFLOW_POSTFLIGHT),
            (postflight_assessment_items, PHASE_ASSESSMENT_POSTFLIGHT),
            (postflight_review_items, PHASE_REVIEW_POSTFLIGHT),
        ]
    else:
        # Coarse "review" phase.
        candidates = [
            (postflight_assessment_items, PHASE_ASSESSMENT_POSTFLIGHT),
            (postflight_review_items, PHASE_REVIEW_POSTFLIGHT),
            (postflight_workflow_items, PHASE_WORKFLOW_POSTFLIGHT),
            (triage_items, PHASE_TRIAGE_POSTFLIGHT),
        ]
    for items, phase in candidates:
        if items:
            return phase
    return None


# ---------------------------------------------------------------------------
# Execution item selection
# ---------------------------------------------------------------------------

def _execution_items_for_phase(
    phase: str,
    *,
    explicit_queue_items: list[WorkQueueItem],
    initial_review_items: list[WorkQueueItem],
    scan_items: list[WorkQueueItem],
    postflight_assessment_items: list[WorkQueueItem],
    postflight_review_items: list[WorkQueueItem],
    postflight_workflow_items: list[WorkQueueItem],
    triage_items: list[WorkQueueItem],
) -> list[WorkQueueItem]:
    if phase == PHASE_REVIEW_INITIAL:
        return initial_review_items
    if phase == PHASE_EXECUTE:
        return explicit_queue_items
    if phase == PHASE_SCAN:
        deferred_items = [
            item for item in scan_items
            if item.get("id") == WORKFLOW_DEFERRED_DISPOSITION_ID
        ]
        if deferred_items:
            return deferred_items
        return [
            item for item in scan_items
            if item.get("id") == WORKFLOW_RUN_SCAN_ID
        ]
    if phase == PHASE_ASSESSMENT_POSTFLIGHT:
        return postflight_assessment_items
    if phase == PHASE_REVIEW_POSTFLIGHT:
        return postflight_review_items
    if phase == PHASE_WORKFLOW_POSTFLIGHT:
        return postflight_workflow_items
    if phase == PHASE_TRIAGE_POSTFLIGHT:
        return triage_items
    return []


# ---------------------------------------------------------------------------
# Item partition building
# ---------------------------------------------------------------------------

class _Partitions(NamedTuple):
    """All item lists computed from state + plan, before phase resolution."""

    objective_items: list[WorkQueueItem]
    explicit_objective_items: list[WorkQueueItem]
    review_issue_items: list[WorkQueueItem]
    initial_review_items: list[WorkQueueItem]
    subjective_postflight_items: list[WorkQueueItem]
    postflight_assessment_items: list[WorkQueueItem]
    postflight_review_items: list[WorkQueueItem]
    scan_items: list[WorkQueueItem]
    postflight_workflow_items: list[WorkQueueItem]
    triage_items: list[WorkQueueItem]
    explicit_queue_items: list[WorkQueueItem]
    anchored_execution_items: list[WorkQueueItem]


def _build_item_partitions(
    state: StateModel,
    *,
    effective_plan: dict | None,
    scan_path: str | None,
    scope: object | None,
    chronic: bool,
    target_strict: float,
) -> _Partitions:
    """Build all item partitions from state and plan."""
    skipped_ids = set((effective_plan or {}).get("skipped", {}).keys())
    scoped_issues = path_scoped_issues(
        (state.get("work_items") or state.get("issues", {})), scan_path,
    )

    all_issue_items = build_issue_items(
        state,
        scan_path=scan_path,
        status_filter="open",
        scope=scope,
        chronic=chronic,
        forced_ids=_live_planned_queue_ids(effective_plan),
    )
    objective_items = [
        item for item in all_issue_items
        if _is_objective_item(item, skipped_ids=skipped_ids)
    ]
    executable_objective_ids = _executable_objective_ids(
        {item.get("id", "") for item in objective_items},
        effective_plan,
    )
    all_clustered_ids = _all_cluster_issue_ids(effective_plan)
    if (
        isinstance(effective_plan, dict)
        and not _live_planned_queue_ids(effective_plan)
        and all_clustered_ids & executable_objective_ids
    ):
        executable_objective_ids -= all_clustered_ids
    explicit_objective_items = [
        item for item in objective_items
        if item.get("id", "") in executable_objective_ids
    ]

    review_issue_items = _review_issue_items(all_issue_items)
    assessment_request_items_list = _assessment_request_items(all_issue_items)
    executable_review_items = _executable_review_issue_items(
        effective_plan, state, review_issue_items,
    )
    review_issue_ids = {item.get("id", "") for item in review_issue_items}
    assessment_request_ids = {item.get("id", "") for item in assessment_request_items_list}

    explicit_queue_items, anchored_execution_items = _merge_execution_candidates(
        all_issue_items=all_issue_items,
        explicit_objective_items=explicit_objective_items,
        plan=effective_plan,
        review_issue_ids=review_issue_ids,
        assessment_request_ids=assessment_request_ids,
    )

    initial_review_items, subjective_postflight_items = _subjective_partitions(
        state, scoped_issues=scoped_issues, threshold=target_strict, plan=effective_plan,
    )
    # Suppress subjective dimension items when review issues already cover
    # the same dimension — the review issues are more actionable.
    postflight_assessment_items = [
        item
        for item in subjective_postflight_items
        if not (
            item.get("kind") == "subjective_dimension"
            and int((item.get("detail") or {}).get("open_review_issues", 0)) > 0
        )
    ] + list(assessment_request_items_list)
    postflight_review_items = list(executable_review_items)

    scan_items, postflight_workflow_items, triage_items = _workflow_partitions(
        effective_plan, state,
    )

    return _Partitions(
        objective_items=objective_items,
        explicit_objective_items=explicit_objective_items,
        review_issue_items=review_issue_items,
        initial_review_items=initial_review_items,
        subjective_postflight_items=subjective_postflight_items,
        postflight_assessment_items=postflight_assessment_items,
        postflight_review_items=postflight_review_items,
        scan_items=scan_items,
        postflight_workflow_items=postflight_workflow_items,
        triage_items=triage_items,
        explicit_queue_items=explicit_queue_items,
        anchored_execution_items=anchored_execution_items,
    )


def _build_backlog(
    p: _Partitions,
    execution_ids: set[str],
) -> list[WorkQueueItem]:
    return [
        item for item in (
            [
                *p.objective_items,
                *p.initial_review_items,
                *p.postflight_assessment_items,
                *p.review_issue_items,
                *p.scan_items,
                *p.postflight_workflow_items,
                *p.triage_items,
            ]
        )
        if item.get("id", "") not in execution_ids
    ]


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def build_queue_snapshot(
    state: StateModel,
    *,
    options: object | None = None,
    plan: dict | None = None,
    target_strict: float = DEFAULT_TARGET_STRICT_SCORE,
) -> QueueSnapshot:
    """Build the canonical queue snapshot for the current state."""
    context = _option_value(options, "context", None)
    effective_plan = context.plan if context is not None else (
        plan if plan is not None else _option_value(options, "plan", None)
    )

    p = _build_item_partitions(
        state,
        effective_plan=effective_plan,
        scan_path=_resolved_scan_path(options, state),
        scope=_option_value(options, "scope", None),
        chronic=bool(_option_value(options, "chronic", False)),
        target_strict=target_strict,
    )

    triage_snapshot = (
        build_triage_snapshot(effective_plan, state)
        if isinstance(effective_plan, dict)
        else None
    )
    fresh_boundary = _is_fresh_boundary(effective_plan)

    phase = _phase_for_snapshot(
        effective_plan,
        fresh_boundary=fresh_boundary,
        initial_review_items=p.initial_review_items,
        anchored_execution_items=p.anchored_execution_items,
        explicit_queue_items=p.explicit_queue_items,
        scan_items=p.scan_items,
        review_backlog_present=bool(p.review_issue_items),
        undispositioned_review_backlog_present=bool(
            triage_snapshot is not None and triage_snapshot.undispositioned_ids
        ),
        postflight_assessment_items=p.postflight_assessment_items,
        postflight_review_items=p.postflight_review_items,
        postflight_workflow_items=p.postflight_workflow_items,
        triage_items=p.triage_items,
    )
    execution_items = _execution_items_for_phase(
        phase,
        explicit_queue_items=p.explicit_queue_items,
        initial_review_items=p.initial_review_items,
        scan_items=p.scan_items,
        postflight_assessment_items=p.postflight_assessment_items,
        postflight_review_items=p.postflight_review_items,
        postflight_workflow_items=p.postflight_workflow_items,
        triage_items=p.triage_items,
    )

    execution_ids = {item.get("id", "") for item in execution_items}
    backlog_items = _build_backlog(p, execution_ids)
    objective_backlog_count = sum(
        1 for item in p.objective_items if item.get("id", "") not in execution_ids
    )

    return QueueSnapshot(
        phase=phase,
        all_objective_items=tuple(p.objective_items),
        all_initial_review_items=tuple(p.initial_review_items),
        all_postflight_assessment_items=tuple(p.postflight_assessment_items),
        all_postflight_review_items=tuple(p.postflight_review_items),
        all_scan_items=tuple(p.scan_items),
        all_postflight_workflow_items=tuple(p.postflight_workflow_items),
        all_postflight_triage_items=tuple(p.triage_items),
        execution_items=tuple(execution_items),
        backlog_items=tuple(backlog_items),
        objective_in_scope_count=len(p.objective_items),
        planned_objective_count=len(p.explicit_objective_items),
        objective_execution_count=sum(
            1
            for item in execution_items
            if item.get("kind") in {"issue", "cluster"}
            and counts_toward_objective_backlog(item)
        ),
        objective_backlog_count=objective_backlog_count,
        subjective_initial_count=len(p.initial_review_items),
        assessment_postflight_count=len(p.postflight_assessment_items),
        subjective_postflight_count=len(p.subjective_postflight_items),
        workflow_postflight_count=len(p.postflight_workflow_items),
        triage_pending_count=len(p.triage_items),
        has_unplanned_objective_blockers=len(p.explicit_objective_items) < len(p.objective_items),
    )


__all__ = [
    "PHASE_ASSESSMENT_POSTFLIGHT",
    "PHASE_EXECUTE",
    "PHASE_REVIEW_INITIAL",
    "PHASE_REVIEW_POSTFLIGHT",
    "PHASE_SCAN",
    "PHASE_TRIAGE_POSTFLIGHT",
    "PHASE_WORKFLOW_POSTFLIGHT",
    "QueueSnapshot",
    "build_queue_snapshot",
]
