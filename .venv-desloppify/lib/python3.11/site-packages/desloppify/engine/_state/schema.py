"""State schema/types, constants, and validation helpers."""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from typing import Any, cast

from desloppify.base.discovery.paths import get_project_root
from desloppify.base.enums import Status, canonical_issue_status, issue_status_tokens
from desloppify.engine._state.issue_semantics import (
    ensure_work_item_semantics,
    WORK_ITEM_KINDS,
    WORK_ITEM_ORIGINS,
)
from desloppify.engine._state.schema_scores import (
    json_default,
)
from desloppify.engine._state.schema_types import (
    AssessmentImportAuditEntry,
    AttestationLogEntry,
    ConcernDismissal,
    DimensionScore,
    IgnoreIntegrityModel,
    Issue,
    WorkItem,
    LangCapability,
    ReviewCacheModel,
    ScanMetadataModel,
    ScanDiff,
    ScanHistoryEntry,
    ScoreConfidenceDetector,
    ScoreConfidenceModel,
    StateModel,
    StateStats,
    SubjectiveAssessment,
    SubjectiveAssessmentJudgment,
    SubjectiveIntegrity,
    TierStats,
)

__all__ = [
    "ConcernDismissal",
    "AssessmentImportAuditEntry",
    "AttestationLogEntry",
    "Issue",
    "WorkItem",
    "TierStats",
    "StateStats",
    "DimensionScore",
    "ScoreConfidenceDetector",
    "ScoreConfidenceModel",
    "ScanHistoryEntry",
    "SubjectiveAssessment",
    "SubjectiveAssessmentJudgment",
    "SubjectiveIntegrity",
    "LangCapability",
    "ReviewCacheModel",
    "IgnoreIntegrityModel",
    "ScanMetadataModel",
    "StateModel",
    "ScanDiff",
    "get_state_dir",
    "get_state_file",
    "CURRENT_VERSION",
    "utc_now",
    "empty_state",
    "ensure_state_defaults",
    "scan_source",
    "scan_metadata",
    "scan_inventory_available",
    "scan_metrics_available",
    "scan_reconstructed_issue_count",
    "validate_state_invariants",
    "json_default",
    "migrate_state_keys",
]

_ALLOWED_ISSUE_STATUSES: set[str] = {
    *issue_status_tokens(),
}
_SCAN_METADATA_SOURCES = {"empty", "scan", "plan_reconstruction"}


def get_state_dir() -> Path:
    """Return the active state directory for the current runtime context."""
    return get_project_root() / ".desloppify"


def get_state_file() -> Path:
    """Return the default state file for the current runtime context."""
    return get_state_dir() / "state.json"


CURRENT_VERSION = 3


def utc_now() -> str:
    """Return current UTC timestamp with second-level precision."""
    return datetime.now(UTC).isoformat(timespec="seconds")


def empty_state() -> StateModel:
    """Return a new empty state payload."""
    work_items: dict[str, WorkItem] = {}
    return {
        "version": CURRENT_VERSION,
        "created": utc_now(),
        "last_scan": None,
        "scan_count": 0,
        "overall_score": 0,
        "objective_score": 0,
        "strict_score": 0,
        "verified_strict_score": 0,
        "stats": {},
        "work_items": work_items,
        "issues": work_items,
        "scan_coverage": {},
        "score_confidence": {},
        "scan_metadata": {"source": "empty"},
        "subjective_integrity": {},
        "subjective_assessments": {},
    }


def _as_non_negative_int(value: Any, default: int = 0) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    return parsed if parsed >= 0 else 0


def _rename_key(d: dict, old: str, new: str) -> bool:
    if old not in d:
        return False
    d.setdefault(new, d.pop(old))
    return True


def migrate_state_keys(state: StateModel | dict[str, Any]) -> None:
    """Migrate legacy key names in-place.

    - ``"findings"`` → ``"work_items"``
    - legacy ``"issues"`` → ``"work_items"``
    - ``dimension_scores[dim]["issues"]`` → ``"failing"``
    """
    state_dict = cast(dict[str, Any], state)
    _rename_key(state_dict, "findings", "work_items")
    _rename_key(state_dict, "issues", "work_items")

    for ds in state_dict.get("dimension_scores", {}).values():
        if isinstance(ds, dict):
            _rename_key(ds, "issues", "failing")

    for entry in state_dict.get("scan_history", []):
        if not isinstance(entry, dict):
            continue
        _rename_key(entry, "raw_findings", "raw_issues")
        for ds in (entry.get("dimension_scores") or {}).values():
            if isinstance(ds, dict):
                _rename_key(ds, "issues", "failing")


def _normalize_scan_metadata(state: StateModel | dict[str, Any]) -> None:
    raw_metadata = state.get("scan_metadata")
    metadata = raw_metadata if isinstance(raw_metadata, dict) else {}

    source = _coerce_scan_source(state, metadata)
    normalized: ScanMetadataModel = {"source": source}
    if source == "plan_reconstruction":
        normalized["plan_queue_available"] = bool(metadata.get("plan_queue_available"))
        work_item_count = metadata.get(
            "reconstructed_work_item_count",
            metadata.get("reconstructed_issue_count", 0),
        )
        if isinstance(work_item_count, int) and not isinstance(work_item_count, bool):
            normalized["reconstructed_issue_count"] = max(0, work_item_count)
        else:
            normalized["reconstructed_issue_count"] = 0

    state["scan_metadata"] = normalized


def ensure_state_defaults(state: StateModel | dict) -> None:
    """Normalize loose/legacy state payloads to a valid base shape in-place."""
    migrate_state_keys(state)

    mutable_state = cast(dict[str, Any], state)
    for key, value in empty_state().items():
        mutable_state.setdefault(key, value)
    version = mutable_state.get("version")
    if not isinstance(version, int):
        mutable_state["version"] = CURRENT_VERSION
    elif version < CURRENT_VERSION:
        mutable_state["version"] = CURRENT_VERSION

    if not isinstance(state.get("work_items"), dict):
        legacy_items = state.get("issues")
        state["work_items"] = legacy_items if isinstance(legacy_items, dict) else {}
    # Keep the legacy alias available in-memory while internal call sites
    # migrate, but make ``work_items`` the canonical storage.
    state["issues"] = state["work_items"]
    if not isinstance(state.get("stats"), dict):
        state["stats"] = {}
    if not isinstance(state.get("scan_history"), list):
        state["scan_history"] = []
    if not isinstance(state.get("scan_coverage"), dict):
        state["scan_coverage"] = {}
    if not isinstance(state.get("score_confidence"), dict):
        state["score_confidence"] = {}
    if not isinstance(state.get("subjective_integrity"), dict):
        state["subjective_integrity"] = {}
    _normalize_scan_metadata(state)

    all_issues = state["work_items"]
    to_remove: list[str] = []
    for issue_id, issue in all_issues.items():
        if not isinstance(issue, dict):
            to_remove.append(issue_id)
            continue

        issue.setdefault("id", issue_id)
        issue.setdefault("detector", "unknown")
        ensure_work_item_semantics(issue)
        issue.setdefault("file", "")
        issue.setdefault("tier", 3)
        issue.setdefault("confidence", "low")
        issue.setdefault("summary", "")
        issue.setdefault("detail", {})
        issue.setdefault("status", Status.OPEN)
        issue["status"] = canonical_issue_status(
            issue.get("status"),
            default=Status.OPEN,
        )
        issue.setdefault("note", None)
        issue.setdefault("first_seen", state.get("created") or utc_now())
        issue.setdefault("last_seen", issue["first_seen"])
        issue.setdefault("resolved_at", None)
        issue["reopen_count"] = _as_non_negative_int(
            issue.get("reopen_count", 0), default=0
        )
        issue.setdefault("suppressed", False)
        issue.setdefault("suppressed_at", None)
        issue.setdefault("suppression_pattern", None)

    for issue_id in to_remove:
        all_issues.pop(issue_id, None)

    for entry in state["scan_history"]:
        if not isinstance(entry, dict):
            continue
        integrity = entry.get("subjective_integrity")
        if integrity is not None and not isinstance(integrity, dict):
            entry["subjective_integrity"] = None

    state["scan_count"] = _as_non_negative_int(state.get("scan_count", 0), default=0)
    return None


def validate_state_invariants(state: StateModel) -> None:
    """Raise ValueError when core state invariants are violated."""
    if not isinstance(state.get("work_items"), dict):
        raise ValueError("state.work_items must be a dict")
    if not isinstance(state.get("stats"), dict):
        raise ValueError("state.stats must be a dict")
    metadata = state.get("scan_metadata")
    if not isinstance(metadata, dict):
        raise ValueError("state.scan_metadata must be a dict")
    source = metadata.get("source")
    if source not in _SCAN_METADATA_SOURCES:
        raise ValueError(f"state.scan_metadata.source has invalid value {source!r}")
    if source == "plan_reconstruction":
        issue_count = metadata.get("reconstructed_issue_count", 0)
        if not isinstance(issue_count, int) or isinstance(issue_count, bool) or issue_count < 0:
            raise ValueError(
                "state.scan_metadata.reconstructed_issue_count must be a non-negative int"
            )

    all_issues = state["work_items"]
    for issue_id, issue in all_issues.items():
        if not isinstance(issue, dict):
            raise ValueError(f"issue {issue_id!r} must be a dict")
        if issue.get("id") != issue_id:
            raise ValueError(f"issue id mismatch for {issue_id!r}")
        issue_kind = issue.get("work_item_kind", issue.get("issue_kind"))
        if issue_kind not in WORK_ITEM_KINDS:
            raise ValueError(
                f"issue {issue_id!r} has invalid work_item_kind {issue_kind!r}"
            )
        origin = issue.get("origin")
        if origin not in WORK_ITEM_ORIGINS:
            raise ValueError(
                f"issue {issue_id!r} has invalid origin {origin!r}"
            )
        if issue.get("status") not in _ALLOWED_ISSUE_STATUSES:
            raise ValueError(
                f"issue {issue_id!r} has invalid status {issue.get('status')!r}"
            )

        tier = issue.get("tier")
        if not isinstance(tier, int) or tier < 1 or tier > 4:
            raise ValueError(f"issue {issue_id!r} has invalid tier {tier!r}")

        reopen_count = issue.get("reopen_count")
        if not isinstance(reopen_count, int) or reopen_count < 0:
            raise ValueError(
                f"issue {issue_id!r} has invalid reopen_count {reopen_count!r}"
            )


def _coerce_scan_source(
    state: StateModel | dict[str, Any],
    metadata: dict[str, Any] | None = None,
) -> str:
    raw_metadata = metadata if isinstance(metadata, dict) else state.get("scan_metadata")
    metadata_dict = raw_metadata if isinstance(raw_metadata, dict) else {}
    raw_source = metadata_dict.get("source")
    source = raw_source if isinstance(raw_source, str) else ""
    if state.get("last_scan"):
        return "scan"
    if source == "plan_reconstruction":
        return source
    return "empty"


def scan_source(state: StateModel | dict[str, Any]) -> str:
    """Return the normalized source that backs the current runtime state."""
    metadata = state.get("scan_metadata")
    return _coerce_scan_source(state, metadata if isinstance(metadata, dict) else None)


def scan_metadata(state: StateModel | dict[str, Any]) -> ScanMetadataModel:
    """Return normalized scan metadata for capability-aware command logic."""
    raw = state.get("scan_metadata")
    if isinstance(raw, dict):
        return cast(ScanMetadataModel, raw)
    if state.get("last_scan"):
        return {"source": "scan"}
    return empty_state()["scan_metadata"]


def scan_inventory_available(state: StateModel | dict[str, Any]) -> bool:
    """Whether command consumers can rely on the current issue inventory."""
    return scan_source(state) in {"scan", "plan_reconstruction"}


def scan_metrics_available(state: StateModel | dict[str, Any]) -> bool:
    """Whether scan-derived metrics/timestamps are present."""
    return scan_source(state) == "scan"


def scan_reconstructed_issue_count(state: StateModel | dict[str, Any]) -> int:
    """Return the number of issues reconstructed from a saved plan, if any."""
    if scan_source(state) != "plan_reconstruction":
        return 0
    metadata = scan_metadata(state)
    value = metadata.get("reconstructed_issue_count", 0)
    if isinstance(value, int) and not isinstance(value, bool):
        return max(0, value)
    return 0
