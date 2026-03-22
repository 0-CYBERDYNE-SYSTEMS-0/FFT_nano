"""Shared helpers for mechanical evidence cluster builders."""

from __future__ import annotations

from typing import Any


def _get_detail(issue: dict, key: str, default: Any = None) -> Any:
    detail = issue.get("detail", {})
    if not isinstance(detail, dict):
        return default
    return detail.get(key, default)


def _get_signals(issue: dict) -> dict:
    detail = issue.get("detail", {})
    if not isinstance(detail, dict):
        return {}
    signals = detail.get("signals")
    if isinstance(signals, dict):
        return signals
    return detail


def _safe_num(value: Any, default: float = 0.0) -> float:
    if isinstance(value, bool):
        return default
    if isinstance(value, int | float):
        return float(value)
    return default


__all__ = ["_get_detail", "_get_signals", "_safe_num"]
