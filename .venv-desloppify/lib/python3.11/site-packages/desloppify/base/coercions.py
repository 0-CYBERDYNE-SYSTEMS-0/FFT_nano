"""Pure coercion helpers for CLI/config input parsing."""

from __future__ import annotations


def coerce_positive_int(value: object, *, default: int, minimum: int = 1) -> int:
    """Parse positive integer CLI/config inputs with a safe default."""
    if value is None:
        return default
    if not isinstance(value, int | float | str):
        return default
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    return parsed if parsed >= minimum else default


def coerce_positive_float(value: object, *, default: float, minimum: float = 0.1) -> float:
    """Parse positive float CLI/config inputs with a safe default."""
    if value is None:
        return default
    if not isinstance(value, int | float | str):
        return default
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return default
    return parsed if parsed >= minimum else default


def coerce_non_negative_float(value: object, *, default: float) -> float:
    """Parse non-negative float CLI/config inputs with a safe default."""
    if value is None:
        return default
    if not isinstance(value, int | float | str):
        return default
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return default
    return parsed if parsed >= 0.0 else default


def coerce_non_negative_int(value: object, *, default: int) -> int:
    """Parse non-negative integer CLI/config inputs with a safe default."""
    if value is None:
        return default
    if not isinstance(value, int | float | str):
        return default
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    return parsed if parsed >= 0 else default


def coerce_confidence(value: object, *, default: float = 1.0) -> float:
    """Coerce a value to a confidence float clamped to [0.0, 1.0]."""
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return default
    return max(0.0, min(1.0, parsed))


def coerce_optional_str(value: object) -> str | None:
    """Coerce a value to *str* or *None* if empty/None."""
    if value is None:
        return None
    s = str(value).strip()
    return s if s else None


__all__ = [
    "coerce_confidence",
    "coerce_non_negative_float",
    "coerce_non_negative_int",
    "coerce_optional_str",
    "coerce_positive_float",
    "coerce_positive_int",
]
