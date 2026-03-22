"""Typed contracts for unified work-queue items."""

from __future__ import annotations

from typing import Any, Literal, TypeAlias, TypedDict

from desloppify.engine.plan_state import ActionStep

QueueItemKind: TypeAlias = Literal[
    "issue",
    "cluster",
    "workflow_stage",
    "workflow_action",
    "subjective_dimension",
]


class PlanClusterRef(TypedDict, total=False):
    """Plan-cluster metadata stamped onto queue items."""

    name: str
    description: str | None
    total_items: int
    action_steps: list[ActionStep]


class QueueItemBase(TypedDict):
    """Required fields shared by all queue views."""

    id: str
    kind: QueueItemKind
    summary: str


class QueueItemCommon(QueueItemBase, total=False):
    """Optional fields shared across multiple queue item variants."""

    detector: str
    work_item_kind: str
    issue_kind: str
    origin: str
    file: str
    confidence: str
    detail: dict[str, Any]
    status: str
    note: str | None
    first_seen: str
    last_seen: str
    resolved_at: str | None
    reopen_count: int
    suppressed: bool
    lang: str

    # Ranking + policy metadata
    is_review: bool
    is_subjective: bool
    review_weight: float | None
    subjective_score: float | None
    estimated_impact: float
    primary_command: str
    action_type: str
    execution_policy: str
    execution_status: str
    explain: dict[str, Any]

    # Plan-order metadata
    _plan_position: int | None
    _is_new: bool
    queue_position: int
    plan_description: str
    plan_note: str
    plan_cluster: PlanClusterRef
    plan_skipped: bool
    plan_skip_kind: str
    plan_skip_reason: str

    # Optional passthrough keys observed in queue item payloads
    active_cluster: str | None
    auto: bool
    cluster: str
    clusters: dict[str, Any]
    count: int
    description: str
    dimension_scores: dict[str, Any]
    entries: list[Any]
    epic_triage_meta: dict[str, Any]
    fixers: list[str]
    issue_ids: list[str]
    work_items: dict[str, Any]
    issues: dict[str, Any]
    lang_capabilities: dict[str, Any]
    name: str
    optional: bool
    overall_per_point: float
    plan_start_scores: dict[str, Any]
    queue_order: list[str]
    reason: str
    scan_history: list[dict[str, Any]]
    scan_path: str | None
    skipped: dict[str, Any]
    triage_stages: dict[str, Any]


class WorkItemQueueItem(QueueItemCommon, total=False):
    """Concrete queue item for one tracked work item."""

    tier: int


class ClusterQueueItem(QueueItemCommon, total=False):
    """Collapsed plan/work queue cluster item."""

    members: list["WorkQueueItem"]
    member_count: int
    cluster_name: str
    cluster_auto: bool
    cluster_optional: bool


class WorkflowStageItem(QueueItemCommon, total=False):
    """Workflow-stage item used by triage/import checkpoints."""

    stage_name: str
    stage_index: int
    blocked_by: list[str]
    is_blocked: bool


class WorkflowActionItem(QueueItemCommon, total=False):
    """Workflow action or synthetic helper item."""

    action: str


class SubjectiveDimensionItem(QueueItemCommon, total=False):
    """Subjective-dimension queue item."""

    initial_review: bool
    cli_keys: list[str]
    dimension: str
    dimension_name: str
    strict: float
    score: float
    failing: int
    timestamp: str
    placeholder: bool
    stale: bool


class SerializedClusterMember(TypedDict, total=False):
    """Serialized cluster member payload used by next/backlog JSON output."""

    id: str | None
    kind: QueueItemKind
    confidence: str | None
    detector: str | None
    file: str | None
    summary: str | None
    status: str | None
    primary_command: str | None


class SerializedQueueItem(TypedDict, total=False):
    """Serialized queue item payload written to query/output surfaces."""

    id: str | None
    kind: QueueItemKind
    confidence: str | None
    detector: str | None
    file: str | None
    summary: str | None
    detail: dict[str, Any]
    status: str | None
    primary_command: str | None
    blocked_by: list[str]
    is_blocked: bool
    explain: dict[str, Any]
    queue_position: int
    plan_description: str
    plan_note: str
    plan_cluster: PlanClusterRef
    plan_skipped: bool
    plan_skip_kind: str
    plan_skip_reason: str
    action_type: str
    member_count: int
    members: list["SerializedClusterMember"]
    cluster_name: str
    cluster_auto: bool
    members_truncated: bool
    members_sample_limit: int
    autofix_hint: str
    execution_policy: str
    action_steps: list[ActionStep]


WorkQueueItem: TypeAlias = (
    WorkItemQueueItem
    | ClusterQueueItem
    | WorkflowStageItem
    | WorkflowActionItem
    | SubjectiveDimensionItem
)
WorkQueueGroups: TypeAlias = dict[str, list[WorkQueueItem]]


__all__ = [
    "ClusterQueueItem",
    "PlanClusterRef",
    "QueueItemBase",
    "QueueItemCommon",
    "QueueItemKind",
    "SerializedClusterMember",
    "SerializedQueueItem",
    "SubjectiveDimensionItem",
    "WorkflowActionItem",
    "WorkflowStageItem",
    "WorkQueueGroups",
    "WorkQueueItem",
    "WorkItemQueueItem",
]
