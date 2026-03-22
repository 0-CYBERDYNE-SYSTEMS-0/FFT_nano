"""Internal sync helpers for auto-cluster regeneration.

Creates and updates auto-clusters from current queue state.  Does NOT
manage queue membership — ``sync_subjective_dimensions`` is the sole authority
on which subjective IDs belong in ``queue_order``.
"""

from __future__ import annotations

from dataclasses import dataclass

from desloppify.engine._plan.policy import stale as stale_policy_mod
from desloppify.engine._plan.sync.context import (
    has_objective_backlog as _has_objective_backlog,
)
from desloppify.engine._plan.auto_cluster_sync_issue import (
    _sync_auto_cluster,
    sync_issue_clusters,
)
from desloppify.engine._plan.constants import SUBJECTIVE_PREFIX
from desloppify.engine._plan.policy.subjective import SubjectiveVisibility
from desloppify.engine._plan.sync.auto_prune import prune_stale_clusters
from desloppify.engine._plan.sync.dimensions import (
    current_under_target_ids,
    current_unscored_ids,
)
from desloppify.engine._state.schema import StateModel

_MIN_CLUSTER_SIZE = 2
_STALE_KEY = "subjective::stale"
_STALE_NAME = "auto/stale-review"
_UNSCORED_KEY = "subjective::unscored"
_UNSCORED_NAME = "auto/initial-review"
_UNDER_TARGET_KEY = "subjective::under-target"
_UNDER_TARGET_NAME = "auto/under-target-review"
_MIN_UNSCORED_CLUSTER_SIZE = 1


@dataclass(frozen=True)
class SubjectiveClusterSpec:
    cluster_key: str
    cluster_name: str
    member_ids: list[str]
    description: str
    action: str
    optional: bool = False


def _subjective_state_sets(
    state: StateModel,
    *,
    policy: SubjectiveVisibility | None,
    target_strict: float,
) -> tuple[set, set, set]:
    """Return (stale_ids, under_target_ids, unscored_ids) for subjective cluster logic."""
    if policy is not None:
        unscored_ids = policy.unscored_ids
        stale_ids = policy.stale_ids
        under_target_ids = policy.under_target_ids
    else:
        unscored_ids = current_unscored_ids(state)
        stale_ids = stale_policy_mod.current_stale_ids(
            state, subjective_prefix=SUBJECTIVE_PREFIX
        )
        under_target_ids = current_under_target_ids(state, target_strict=target_strict)
    return stale_ids, under_target_ids, unscored_ids


def _skipped_subjective_ids(plan: dict) -> set[str]:
    """Return skipped subjective IDs so auto-clusters don't re-queue them."""
    skipped = plan.get("skipped", {})
    if not isinstance(skipped, dict):
        return set()
    return {
        str(fid)
        for fid in skipped
        if isinstance(fid, str) and fid.startswith(SUBJECTIVE_PREFIX)
    }


def _subjective_cli_keys(issue_ids: list[str]) -> list[str]:
    return [fid.removeprefix(SUBJECTIVE_PREFIX) for fid in issue_ids]


def _subjective_action(issue_ids: list[str]) -> str:
    return "desloppify review --prepare --dimensions " + ",".join(_subjective_cli_keys(issue_ids))


def _sync_subjective_cluster(
    *,
    plan: dict,
    clusters: dict,
    existing_by_key: dict[str, str],
    active_auto_keys: set[str],
    cluster_key: str,
    cluster_name: str,
    member_ids: list[str],
    description: str,
    action: str,
    now: str,
    optional: bool = False,
) -> int:
    """Sync one subjective auto-cluster when it has enough members."""
    min_size = _MIN_UNSCORED_CLUSTER_SIZE if cluster_key == _UNSCORED_KEY else _MIN_CLUSTER_SIZE
    if len(member_ids) < min_size:
        return 0
    active_auto_keys.add(cluster_key)
    sync_result = _sync_auto_cluster(
        plan,
        clusters,
        existing_by_key,
        cluster_key=cluster_key,
        cluster_name=cluster_name,
        member_ids=member_ids,
        description=description,
        action=action,
        now=now,
        optional=optional,
    )
    return int(sync_result.changed)


def _queue_subjective_members(
    order: list[str],
    *,
    stale_state_ids: set[str],
    under_target_ids: set[str],
    unscored_state_ids: set[str],
) -> tuple[list[str], list[str], list[str]]:
    all_subjective_ids = sorted(
        fid
        for fid in order
        if fid.startswith(SUBJECTIVE_PREFIX)
    )
    unscored_queue_ids = sorted(
        fid for fid in all_subjective_ids if fid in unscored_state_ids
    )
    stale_queue_ids = sorted(
        fid
        for fid in all_subjective_ids
        if fid in stale_state_ids and fid not in unscored_state_ids
    )
    under_target_queue_ids = sorted(fid for fid in under_target_ids)
    return unscored_queue_ids, stale_queue_ids, under_target_queue_ids


def _subjective_cluster_specs(
    *,
    unscored_queue_ids: list[str],
    stale_queue_ids: list[str],
    under_target_queue_ids: list[str],
    skipped_subjective_ids: set[str],
    has_objective_items: bool,
) -> list[SubjectiveClusterSpec]:
    specs = [
        SubjectiveClusterSpec(
            cluster_key=_UNSCORED_KEY,
            cluster_name=_UNSCORED_NAME,
            member_ids=unscored_queue_ids,
            description=(
                f"Initial review of {len(unscored_queue_ids)} unscored subjective dimensions"
            ),
            action=_subjective_action(unscored_queue_ids),
        ),
        SubjectiveClusterSpec(
            cluster_key=_STALE_KEY,
            cluster_name=_STALE_NAME,
            member_ids=stale_queue_ids,
            description=f"Re-review {len(stale_queue_ids)} stale subjective dimensions",
            action=_subjective_action(stale_queue_ids),
        ),
    ]
    if has_objective_items:
        return specs

    filtered_under_target_ids = sorted(
        fid for fid in under_target_queue_ids if fid not in skipped_subjective_ids
    )
    specs.append(
        SubjectiveClusterSpec(
            cluster_key=_UNDER_TARGET_KEY,
            cluster_name=_UNDER_TARGET_NAME,
            member_ids=filtered_under_target_ids,
            description=(
                f"Consider re-reviewing {len(filtered_under_target_ids)} "
                f"dimensions under target score"
            ),
            action=_subjective_action(filtered_under_target_ids),
            optional=True,
        )
    )
    return specs


def sync_subjective_clusters(
    plan: dict,
    state: StateModel,
    issues: dict,
    clusters: dict,
    existing_by_key: dict[str, str],
    active_auto_keys: set[str],
    now: str,
    *,
    target_strict: float,
    policy: SubjectiveVisibility | None = None,
) -> int:
    """Sync unscored, stale, and under-target subjective dimension clusters.

    Creates/updates cluster groupings from IDs currently in the queue.
    Does NOT inject or evict IDs — that is sync_stale's responsibility.
    """
    changes = 0
    skipped_subjective_ids = _skipped_subjective_ids(plan)
    order = plan.get("queue_order", [])

    stale_state_ids, under_target_ids, unscored_state_ids = _subjective_state_sets(
        state, policy=policy, target_strict=target_strict
    )
    unscored_queue_ids, stale_queue_ids, under_target_queue_ids = _queue_subjective_members(
        order,
        stale_state_ids=stale_state_ids,
        under_target_ids=under_target_ids,
        unscored_state_ids=unscored_state_ids,
    )

    has_objective_items = _has_objective_backlog(issues, policy)
    for spec in _subjective_cluster_specs(
        unscored_queue_ids=unscored_queue_ids,
        stale_queue_ids=stale_queue_ids,
        under_target_queue_ids=under_target_queue_ids,
        skipped_subjective_ids=skipped_subjective_ids,
        has_objective_items=has_objective_items,
    ):
        changes += _sync_subjective_cluster(
            plan=plan,
            clusters=clusters,
            existing_by_key=existing_by_key,
            active_auto_keys=active_auto_keys,
            cluster_key=spec.cluster_key,
            cluster_name=spec.cluster_name,
            member_ids=spec.member_ids,
            description=spec.description,
            action=spec.action,
            now=now,
            optional=spec.optional,
        )

    return changes


__all__ = ["prune_stale_clusters", "sync_issue_clusters", "sync_subjective_clusters"]
