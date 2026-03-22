"""Shared detector output contract for TypeScript detector entrypoints."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Generic, TypeVar

TEntry = TypeVar("TEntry")


@dataclass(frozen=True)
class DetectorResult(Generic[TEntry]):
    """Normalized detector output with explicit population semantics."""

    entries: list[TEntry]
    population_kind: str
    population_size: int


__all__ = ["DetectorResult"]
