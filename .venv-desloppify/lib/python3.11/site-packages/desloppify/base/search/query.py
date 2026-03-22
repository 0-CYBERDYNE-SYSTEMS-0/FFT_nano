"""Core query payload writing helpers."""

from __future__ import annotations

import json
import logging
import sys
from pathlib import Path

from desloppify.base.config import config_for_query, load_config
from desloppify.base.discovery.file_paths import safe_write_text
from desloppify.base.output.contract import OutputResult
from desloppify.state_io import json_default

logger = logging.getLogger(__name__)

QUERY_PAYLOAD_MAX_BYTES = 2_000_000
QUERY_ITEMS_SOFT_LIMIT = 200
QUERY_CLUSTER_MEMBER_LIMIT = 10
QUERY_TEXT_LIMIT = 400


def _payload_over_budget(payload: dict, *, max_bytes: int) -> bool:
    return _payload_size_bytes(payload) > max_bytes


def _payload_size_bytes(payload: dict) -> int:
    """Return UTF-8 byte size for a JSON-serializable payload."""
    return len(json.dumps(payload, indent=2, default=json_default).encode("utf-8"))


def _truncate_text(value: object, *, limit: int | None = None) -> object:
    """Return text truncated to a fixed character budget."""
    if not isinstance(value, str):
        return value
    limit_value = QUERY_TEXT_LIMIT if limit is None else limit
    if len(value) <= limit_value:
        return value
    return value[: limit_value - 1] + "…"


def _lightweight_item(item: object) -> object:
    """Return a lighter-weight queue item safe for query payload persistence."""
    if not isinstance(item, dict):
        return item

    light = dict(item)
    light["summary"] = _truncate_text(light.get("summary"))

    detail = light.get("detail")
    if isinstance(detail, dict):
        compact_detail: dict = {}
        for key, value in detail.items():
            if isinstance(value, str):
                compact_detail[key] = _truncate_text(value, limit=200)
            elif isinstance(value, list):
                compact_detail[key] = value[:20]
            elif isinstance(value, dict):
                compact_detail[key] = {"truncated": True, "keys": len(value)}
            else:
                compact_detail[key] = value
        light["detail"] = compact_detail

    if item.get("kind") == "cluster":
        members = light.get("members")
        if isinstance(members, list) and len(members) > QUERY_CLUSTER_MEMBER_LIMIT:
            light["members"] = members[:QUERY_CLUSTER_MEMBER_LIMIT]
            light["members_truncated"] = True
            light["members_sample_limit"] = QUERY_CLUSTER_MEMBER_LIMIT

    return light


def _minimal_payload(payload: dict, *, max_bytes: int) -> dict:
    """Build a minimal fallback payload when budget cannot be met."""
    minimal: dict = {
        "command": payload.get("command"),
        "queue": payload.get("queue", {}),
        "overall_score": payload.get("overall_score"),
        "objective_score": payload.get("objective_score"),
        "strict_score": payload.get("strict_score"),
    }

    sample_items: list[dict] = []
    items = payload.get("items")
    if isinstance(items, list):
        for item in items[:20]:
            if not isinstance(item, dict):
                continue
            sample_items.append(
                {
                    "id": item.get("id"),
                    "kind": item.get("kind"),
                    "detector": item.get("detector"),
                    "file": item.get("file"),
                    "summary": _truncate_text(item.get("summary"), limit=200),
                }
            )
    minimal["items"] = sample_items

    if "config" in payload:
        minimal["config"] = payload["config"]
    if "config_error" in payload:
        minimal["config_error"] = payload["config_error"]

    minimal["query_truncated"] = {
        "mode": "minimal",
        "max_bytes": max_bytes,
        "items_sample": len(sample_items),
    }
    return _fit_payload_to_budget(minimal, max_bytes=max_bytes)


def _fit_payload_to_budget(payload: dict, *, max_bytes: int) -> dict:
    """Shrink payload further until it fits max_bytes."""
    trimmed = dict(payload)

    items = trimmed.get("items")
    if isinstance(items, list):
        keep = len(items)
        while keep > 0 and _payload_size_bytes(trimmed) > max_bytes:
            keep = max(0, keep // 2)
            trimmed["items"] = items[:keep]

    if _payload_size_bytes(trimmed) > max_bytes and "config" in payload:
        trimmed = {key: value for key, value in trimmed.items() if key != "config"}
        trimmed["config_truncated"] = True

    if _payload_size_bytes(trimmed) > max_bytes and "queue" in trimmed:
        trimmed["queue"] = {}

    if _payload_size_bytes(trimmed) > max_bytes:
        return {
            "command": payload.get("command"),
            "query_truncated": {
                "mode": "minimal",
                "max_bytes": max_bytes,
                "overflow": True,
            },
        }

    query_meta = payload.get("query_truncated")
    if isinstance(query_meta, dict) and isinstance(trimmed.get("items"), list):
        updated_query_meta = dict(query_meta)
        updated_query_meta["items_sample"] = len(trimmed["items"])
        trimmed["query_truncated"] = updated_query_meta
    return trimmed


def _trim_query_items(payload: dict, notes: list[str]) -> dict:
    trimmed = dict(payload)
    items = trimmed.get("items")
    if not isinstance(items, list):
        return trimmed

    original_count = len(items)
    limited_items = items[:QUERY_ITEMS_SOFT_LIMIT]
    if len(limited_items) < original_count:
        notes.append(f"items:{original_count}->{len(limited_items)}")
    trimmed["items"] = [_lightweight_item(item) for item in limited_items]
    return trimmed


def _trim_query_narrative(payload: dict, notes: list[str]) -> dict:
    if not isinstance(payload.get("narrative"), dict):
        return payload
    trimmed = dict(payload)
    trimmed["narrative"] = {"truncated": True}
    notes.append("narrative")
    return trimmed


def _trim_query_plan(payload: dict, notes: list[str]) -> dict:
    plan = payload.get("plan")
    if not isinstance(plan, dict):
        return payload

    clusters = plan.get("clusters")
    if not isinstance(clusters, list) or len(clusters) <= 100:
        return payload

    compact_plan = dict(plan)
    compact_plan["clusters"] = clusters[:100]
    compact_plan["clusters_truncated"] = True
    trimmed = dict(payload)
    trimmed["plan"] = compact_plan
    notes.append("plan.clusters")
    return trimmed


def _annotate_query_truncation(payload: dict, notes: list[str], *, max_bytes: int) -> dict:
    if not notes:
        return payload

    trimmed = dict(payload)
    meta = trimmed.get("query_truncated")
    if not isinstance(meta, dict):
        meta = {}
    meta["max_bytes"] = max_bytes
    meta["actual_bytes"] = _payload_size_bytes(trimmed)
    meta["applied"] = notes
    trimmed["query_truncated"] = meta
    return trimmed


def _enforce_payload_budget(
    payload: dict,
    *,
    max_bytes: int | None = None,
) -> tuple[dict, list[str]]:
    """Bound payload size with deterministic truncation steps."""
    budget = QUERY_PAYLOAD_MAX_BYTES if max_bytes is None else max_bytes
    if not _payload_over_budget(payload, max_bytes=budget):
        return payload, []

    notes: list[str] = []
    trimmed = _trim_query_items(payload, notes)

    if _payload_over_budget(trimmed, max_bytes=budget):
        trimmed = _trim_query_narrative(trimmed, notes)

    if _payload_over_budget(trimmed, max_bytes=budget):
        trimmed = _trim_query_plan(trimmed, notes)

    if _payload_over_budget(trimmed, max_bytes=budget):
        trimmed = _minimal_payload(trimmed, max_bytes=budget)
        notes.append("minimal")

    trimmed = _annotate_query_truncation(trimmed, notes, max_bytes=budget)
    return trimmed, notes


def write_query(data: dict, *, query_file: Path) -> OutputResult:
    """Write structured query payloads with config context and graceful fallback."""
    payload = dict(data)
    if "config" not in payload:
        try:
            payload["config"] = config_for_query(load_config())
        except (OSError, ValueError, json.JSONDecodeError) as exc:
            payload["config_error"] = str(exc)
            logger.debug("Skipping config injection into query payload: %s", exc)

    payload, truncation_notes = _enforce_payload_budget(payload)
    try:
        safe_write_text(query_file, json.dumps(payload, indent=2, default=json_default) + "\n")
        print("  → query.json updated", file=sys.stderr)
        if truncation_notes:
            print(
                "  ⚠ query.json payload exceeded budget; wrote truncated artifact.",
                file=sys.stderr,
            )
        return OutputResult(
            ok=True,
            status="written",
            message=f"query payload written to {query_file}",
        )
    except OSError as exc:
        payload["query_write_error"] = str(exc)
        print(f"  ⚠ Could not write query.json: {exc}", file=sys.stderr)
        return OutputResult(
            ok=False,
            status="error",
            message=str(exc),
            error_kind="query_write_error",
        )


__all__ = ["write_query"]
