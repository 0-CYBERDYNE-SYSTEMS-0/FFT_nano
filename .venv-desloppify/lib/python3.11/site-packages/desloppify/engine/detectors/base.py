"""Neutral detector datatypes shared across engine and language framework."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field


@dataclass
class FunctionInfo:
    """Extracted function/method info for cross-language analysis."""

    name: str
    file: str
    line: int
    end_line: int
    loc: int
    body: str
    normalized: str = ""
    body_hash: str = ""
    params: list[str] = field(default_factory=list)
    return_annotation: str | None = None


@dataclass
class ClassInfo:
    """Extracted class/component info for cross-language analysis."""

    name: str
    file: str
    line: int
    loc: int
    methods: list[FunctionInfo] = field(default_factory=list)
    attributes: list[str] = field(default_factory=list)
    base_classes: list[str] = field(default_factory=list)
    metrics: dict[str, int] = field(default_factory=dict)


@dataclass
class ComplexitySignal:
    """A complexity signal to detect in source files."""

    name: str
    pattern: str | None = None
    weight: int = 1
    threshold: int = 0
    compute: Callable | None = None


@dataclass
class GodRule:
    """A rule for detecting god classes/components."""

    name: str
    description: str
    extract: Callable
    threshold: int


ELEVATED_PARAMS_THRESHOLD = 8
ELEVATED_NESTING_THRESHOLD = 6
ELEVATED_LOC_THRESHOLD = 300


__all__ = [
    "ClassInfo",
    "ComplexitySignal",
    "ELEVATED_LOC_THRESHOLD",
    "ELEVATED_NESTING_THRESHOLD",
    "ELEVATED_PARAMS_THRESHOLD",
    "FunctionInfo",
    "GodRule",
]
