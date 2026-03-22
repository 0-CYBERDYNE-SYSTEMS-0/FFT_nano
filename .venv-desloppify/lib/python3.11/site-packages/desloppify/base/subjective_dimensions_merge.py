"""Metadata merge helpers for subjective dimension payloads."""

from __future__ import annotations

from desloppify.base.subjective_dimensions_constants import normalize_dimension_name
from desloppify.base.text_utils import is_numeric


def extract_prompt_meta(entry: object) -> dict[str, object]:
    """Extract optional metadata fields from a prompt payload entry."""
    if not isinstance(entry, dict):
        return {}
    meta = entry.get("meta")
    if not isinstance(meta, dict):
        return {}

    out: dict[str, object] = {}
    display_name = meta.get("display_name")
    if isinstance(display_name, str) and display_name.strip():
        out["display_name"] = display_name.strip()

    weight = meta.get("weight")
    if is_numeric(weight):
        out["weight"] = max(0.0, float(weight))

    enabled = meta.get("enabled_by_default")
    if isinstance(enabled, bool):
        out["enabled_by_default"] = enabled

    reset_on_scan = meta.get("reset_on_scan")
    if isinstance(reset_on_scan, bool):
        out["reset_on_scan"] = reset_on_scan

    return out


def merge_prompt_display_and_weights(
    payload: dict[str, object],
    *,
    prompt_meta: dict[str, object],
    override_existing: bool,
) -> None:
    if "display_name" in prompt_meta and (
        override_existing or "display_name" not in payload
    ):
        payload["display_name"] = prompt_meta["display_name"]
    if "weight" in prompt_meta and (override_existing or "weight" not in payload):
        payload["weight"] = prompt_meta["weight"]
    if "reset_on_scan" in prompt_meta and (
        override_existing or "reset_on_scan" not in payload
    ):
        payload["reset_on_scan"] = prompt_meta["reset_on_scan"]


def merge_enabled_by_default_flag(
    payload: dict[str, object],
    *,
    prompt_meta: dict[str, object],
    override_existing: bool,
    default_enabled: bool,
) -> None:
    if default_enabled:
        payload["enabled_by_default"] = True
    if "enabled_by_default" not in prompt_meta:
        return
    prompt_enabled = bool(prompt_meta["enabled_by_default"])
    if override_existing:
        payload["enabled_by_default"] = prompt_enabled
        return
    payload["enabled_by_default"] = bool(
        payload.get("enabled_by_default", False) or prompt_enabled
    )


def normalized_default_dimensions(dimensions: list[str]) -> set[str]:
    return {
        normalize_dimension_name(dim)
        for dim in dimensions
        if isinstance(dim, str) and dim.strip()
    }


def merge_dimension_meta(
    target: dict[str, dict[str, object]],
    *,
    dimensions: list[str],
    prompts: dict[str, dict[str, object]],
    override_existing: bool = False,
) -> None:
    defaults = normalized_default_dimensions(dimensions)

    for raw_dim, entry in prompts.items():
        dim = normalize_dimension_name(raw_dim)
        if not dim:
            continue

        payload = target.setdefault(dim, {})
        prompt_meta = extract_prompt_meta(entry)
        merge_prompt_display_and_weights(
            payload,
            prompt_meta=prompt_meta,
            override_existing=override_existing,
        )
        merge_enabled_by_default_flag(
            payload,
            prompt_meta=prompt_meta,
            override_existing=override_existing,
            default_enabled=dim in defaults,
        )


__all__ = [
    "merge_dimension_meta",
]
