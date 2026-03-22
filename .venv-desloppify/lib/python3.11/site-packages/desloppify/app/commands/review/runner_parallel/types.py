"""Typed payloads for review batch parallel execution."""

from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from ..batch.core_models import (
    BatchDimensionJudgmentPayload,
    BatchDimensionNotePayload,
    BatchIssuePayload,
    BatchQualityPayload,
    BatchResultPayload,
)

BatchTask = Callable[[], int]


@dataclass(frozen=True)
class BatchProgressEvent:
    """Typed progress event emitted by batch runner execution."""

    batch_index: int
    event: str
    code: int | None = None
    details: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class BatchExecutionOptions:
    """Runtime options for serial/parallel batch execution."""

    run_parallel: bool
    max_parallel_workers: int | None = None
    heartbeat_seconds: float | None = 15.0
    clock_fn: Callable[[], float] = time.monotonic


@dataclass(frozen=True)
class BatchResult:
    """Typed normalized batch payload passed to merge/import stages."""

    batch_index: int
    assessments: dict[str, float]
    dimension_notes: dict[str, BatchDimensionNotePayload]
    dimension_judgment: dict[str, BatchDimensionJudgmentPayload] = field(default_factory=dict)
    issues: list[BatchIssuePayload] = field(default_factory=list)
    quality: BatchQualityPayload = field(default_factory=dict)
    context_updates: dict[str, dict[str, object]] = field(default_factory=dict)

    def to_dict(self) -> BatchResultPayload:
        payload: BatchResultPayload = {
            "assessments": self.assessments,
            "dimension_notes": self.dimension_notes,
            "issues": self.issues,
            "quality": self.quality,
            "dimension_judgment": self.dimension_judgment,
        }
        payload["batch_index"] = self.batch_index
        if self.context_updates:
            payload["context_updates"] = self.context_updates
        return payload


__all__ = [
    "BatchExecutionOptions",
    "BatchProgressEvent",
    "BatchResult",
    "BatchTask",
]
