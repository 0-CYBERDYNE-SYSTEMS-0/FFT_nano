"""Normalization helpers used by LangConfig runtime settings/options."""

from __future__ import annotations

import copy
from collections.abc import Mapping
from typing import Any

from .types_shared import LangValueSpec


def _is_numeric(value: object) -> bool:
    """Return True for int/float values, excluding bool."""
    return isinstance(value, int | float) and not isinstance(value, bool)


def clone_default(default: object) -> object:
    """Deep-copy a setting default to preserve mutability boundaries."""
    return copy.deepcopy(default)


def coerce_value(raw: object, expected: type, default: object) -> object:
    """Best-effort coercion for config/CLI values."""
    fallback = clone_default(default)
    if raw is None:
        return fallback

    if expected is bool:
        if isinstance(raw, bool):
            return raw
        if isinstance(raw, str):
            lowered = raw.strip().lower()
            if lowered in {"1", "true", "yes", "on"}:
                return True
            if lowered in {"0", "false", "no", "off"}:
                return False
            return fallback
        if _is_numeric(raw):
            return bool(raw)
        return fallback

    if expected is int:
        if isinstance(raw, bool):
            return fallback
        if _is_numeric(raw):
            return int(raw)
        try:
            return int(raw)
        except (TypeError, ValueError):
            return fallback

    if expected is float:
        if isinstance(raw, bool):
            return fallback
        if _is_numeric(raw):
            return float(raw)
        try:
            return float(raw)
        except (TypeError, ValueError):
            return fallback

    if expected is str:
        return raw if isinstance(raw, str) else str(raw)

    if expected is list:
        return raw if isinstance(raw, list) else fallback

    if expected is dict:
        return raw if isinstance(raw, dict) else fallback

    return raw if isinstance(raw, expected) else fallback


def normalize_spec_values(
    values: dict[str, object] | None,
    specs: Mapping[str, LangValueSpec],
    *,
    strict: bool = False,
    owner_name: str = "",
) -> dict[str, object]:
    """Normalize config/runtime values against a LangValueSpec mapping."""
    values = values if isinstance(values, dict) else {}
    if strict:
        unknown = sorted(set(values) - set(specs))
        if unknown:
            owner = owner_name or "language"
            raise KeyError(
                f"Unknown runtime option(s) for {owner}: {', '.join(unknown)}"
            )
    normalized: dict[str, object] = {}
    for key, spec in specs.items():
        raw = values.get(key, spec.default)
        normalized[key] = coerce_value(raw, spec.type, spec.default)
    return normalized


def runtime_value(
    runtime_defaults: dict[str, object],
    specs: Mapping[str, LangValueSpec],
    key: str,
    default: Any = None,
) -> Any:
    """Read runtime default for key, falling back to spec default or caller default."""
    if key in runtime_defaults:
        return copy.deepcopy(runtime_defaults[key])
    spec = specs.get(key)
    if spec:
        return copy.deepcopy(spec.default)
    return default


__all__ = [
    "clone_default",
    "coerce_value",
    "normalize_spec_values",
    "runtime_value",
]
