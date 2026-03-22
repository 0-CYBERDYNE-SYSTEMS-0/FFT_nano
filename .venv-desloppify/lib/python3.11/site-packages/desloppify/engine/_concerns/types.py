"""Shared concern datatypes."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, TypedDict


@dataclass(frozen=True)
class Concern:
    """A potential design problem surfaced by mechanical signals."""

    type: str
    file: str
    summary: str
    evidence: tuple[str, ...]
    question: str
    fingerprint: str
    source_issues: tuple[str, ...]


class ConcernSignals(TypedDict, total=False):
    """Typed signal payload extracted from mechanical issues."""

    max_params: float
    max_nesting: float
    loc: float
    function_count: float
    monster_loc: float
    monster_funcs: list[str]


SignalKey = Literal[
    "max_params",
    "max_nesting",
    "loc",
    "function_count",
    "monster_loc",
]

__all__ = ["Concern", "ConcernSignals", "SignalKey"]
