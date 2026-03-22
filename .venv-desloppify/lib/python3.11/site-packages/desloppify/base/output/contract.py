"""Shared result contract for non-critical command side effects."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class OutputResult:
    """Outcome for best-effort write/generation side-effects."""

    ok: bool
    status: str
    message: str | None = None
    error_kind: str | None = None


__all__ = ["OutputResult"]
