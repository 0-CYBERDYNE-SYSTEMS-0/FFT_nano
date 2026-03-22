"""Metadata and logging mutations for plan operations."""

from __future__ import annotations

from dataclasses import dataclass

from desloppify.engine._plan.schema import (
    ExecutionLogEntry,
    PlanModel,
    ensure_plan_defaults,
)
from desloppify.engine._state.schema import utc_now

_DEFAULT_MAX_LOG_ENTRIES = 10000


@dataclass(frozen=True)
class AppendLogOptions:
    """Optional metadata fields for execution log entries."""

    issue_ids: list[str] | None = None
    cluster_name: str | None = None
    actor: str = "user"
    note: str | None = None
    detail: dict | None = None


def _append_log_options(
    *,
    options: AppendLogOptions | None,
    legacy_kwargs: dict[str, object],
) -> AppendLogOptions:
    """Resolve append-log options from modern object or legacy kwargs."""
    allowed_keys = {"issue_ids", "cluster_name", "actor", "note", "detail"}
    unknown = sorted(set(legacy_kwargs) - allowed_keys)
    if unknown:
        joined = ", ".join(unknown)
        raise TypeError(f"Unexpected keyword argument(s): {joined}")
    if options is not None and legacy_kwargs:
        raise TypeError("Pass either options=... or legacy keyword args, not both")
    if options is not None:
        return options
    issue_ids = legacy_kwargs.get("issue_ids")
    cluster_name = legacy_kwargs.get("cluster_name")
    actor = legacy_kwargs.get("actor")
    note = legacy_kwargs.get("note")
    detail = legacy_kwargs.get("detail")
    return AppendLogOptions(
        issue_ids=list(issue_ids) if isinstance(issue_ids, list) else None,
        cluster_name=None if cluster_name is None else str(cluster_name),
        actor=str(actor) if actor is not None else "user",
        note=None if note is None else str(note),
        detail=detail if isinstance(detail, dict) else None,
    )


def _get_log_cap() -> int:
    """Read execution_log_max_entries from config. Returns 0 for unlimited."""
    try:
        from desloppify.base.config import load_config

        config = load_config()
        value = config.get("execution_log_max_entries", _DEFAULT_MAX_LOG_ENTRIES)
        return max(0, int(value))
    except (ImportError, OSError, ValueError, TypeError):
        return _DEFAULT_MAX_LOG_ENTRIES


def append_log_entry(
    plan: PlanModel,
    action: str,
    *,
    options: AppendLogOptions | None = None,
    **legacy_kwargs,
) -> None:
    """Append a structured entry to the plan's execution log."""
    append_options = _append_log_options(
        options=options,
        legacy_kwargs=legacy_kwargs,
    )
    log = plan.get("execution_log", [])
    entry: ExecutionLogEntry = {
        "timestamp": utc_now(),
        "action": action,
        "issue_ids": append_options.issue_ids or [],
        "cluster_name": append_options.cluster_name,
        "actor": append_options.actor,
        "note": append_options.note,
        "detail": append_options.detail or {},
    }
    log.append(entry)
    cap = _get_log_cap()
    if cap > 0 and len(log) > cap:
        plan["execution_log"] = log[-cap:]


def describe_issue(
    plan: PlanModel, issue_id: str, description: str | None
) -> None:
    """Set or clear an augmented description on a issue."""
    ensure_plan_defaults(plan)
    now = utc_now()
    overrides = plan["overrides"]
    if issue_id not in overrides:
        overrides[issue_id] = {"issue_id": issue_id, "created_at": now}
    overrides[issue_id]["description"] = description
    overrides[issue_id]["updated_at"] = now


def annotate_issue(
    plan: PlanModel, issue_id: str, note: str | None
) -> None:
    """Set or clear a note on a issue."""
    ensure_plan_defaults(plan)
    now = utc_now()
    overrides = plan["overrides"]
    if issue_id not in overrides:
        overrides[issue_id] = {"issue_id": issue_id, "created_at": now}
    overrides[issue_id]["note"] = note
    overrides[issue_id]["updated_at"] = now


__all__ = ["annotate_issue", "append_log_entry", "describe_issue"]
