"""Small utility helpers for concern generation."""

from __future__ import annotations

import hashlib
from typing import Any

from .types import ConcernSignals, SignalKey


def _update_max_signal(signals: ConcernSignals, key: SignalKey, value: object) -> None:
    """Update numeric signal key with max(existing, value) when value is valid."""
    if isinstance(value, bool) or not isinstance(value, int | float) or value <= 0:
        return
    current = float(signals.get(key, 0.0))
    signals[key] = max(current, float(value))


def _fingerprint(concern_type: str, file: str, key_signals: tuple[str, ...]) -> str:
    """Stable hash of (type, file, sorted key signals)."""
    raw = f"{concern_type}::{file}::{','.join(sorted(key_signals))}"
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def _is_dismissed(
    dismissals: dict[str, Any], fingerprint: str, source_issue_ids: tuple[str, ...]
) -> bool:
    """Check if a concern was previously dismissed and source issues unchanged."""
    entry = dismissals.get(fingerprint)
    if not isinstance(entry, dict):
        return False
    prev_sources = set(entry.get("source_issue_ids", []))
    return prev_sources == set(source_issue_ids)


__all__ = ["_fingerprint", "_is_dismissed", "_update_max_signal"]
