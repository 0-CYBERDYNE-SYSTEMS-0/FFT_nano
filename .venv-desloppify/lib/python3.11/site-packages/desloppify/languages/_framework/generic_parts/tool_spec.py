"""Typed tool spec contract for generic language plugin registration."""

from __future__ import annotations

from typing import Any, TypedDict


class ToolSpec(TypedDict):
    """Validated detector/fixer tool configuration."""

    label: str
    cmd: str
    fmt: str
    id: str
    tier: int
    fix_cmd: str | None


def normalize_tool_specs(
    raw_tools: list[dict[str, Any]],
    *,
    supported_formats: set[str],
) -> list[ToolSpec]:
    """Validate and normalize generic tool specs before plugin assembly."""
    normalized: list[ToolSpec] = []
    for idx, raw in enumerate(raw_tools):
        if not isinstance(raw, dict):
            raise ValueError(f"tools[{idx}] must be an object")

        label = str(raw.get("label", "")).strip()
        cmd = str(raw.get("cmd", "")).strip()
        fmt = str(raw.get("fmt", "")).strip()
        detector_id = str(raw.get("id", "")).strip()
        tier_raw = raw.get("tier")

        if not label:
            raise ValueError(f"tools[{idx}].label must be a non-empty string")
        if not cmd:
            raise ValueError(f"tools[{idx}].cmd must be a non-empty string")
        if not fmt:
            raise ValueError(f"tools[{idx}].fmt must be a non-empty string")
        if fmt not in supported_formats:
            allowed = ", ".join(sorted(supported_formats))
            raise ValueError(
                f"tools[{idx}].fmt '{fmt}' is unsupported (expected one of: {allowed})"
            )
        if not detector_id:
            raise ValueError(f"tools[{idx}].id must be a non-empty string")
        if isinstance(tier_raw, bool) or not isinstance(tier_raw, int):
            raise ValueError(f"tools[{idx}].tier must be an integer")
        if tier_raw < 1 or tier_raw > 4:
            raise ValueError(f"tools[{idx}].tier must be in range 1..4")

        fix_cmd_raw = raw.get("fix_cmd")
        fix_cmd: str | None = None
        if fix_cmd_raw is not None:
            fix_cmd = str(fix_cmd_raw).strip()
            if not fix_cmd:
                raise ValueError(
                    f"tools[{idx}].fix_cmd must be a non-empty string when provided"
                )

        normalized.append(
            ToolSpec(
                label=label,
                cmd=cmd,
                fmt=fmt,
                id=detector_id,
                tier=tier_raw,
                fix_cmd=fix_cmd,
            )
        )
    return normalized


__all__ = ["ToolSpec", "normalize_tool_specs"]
