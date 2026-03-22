"""Core queue option and result models."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TypedDict

from desloppify.engine._work_queue.context import QueueContext
from desloppify.engine._work_queue.types import WorkQueueItem


class _ScanPathFromState:
    """Sentinel type: resolve scan_path from state."""


_SCAN_PATH_FROM_STATE = _ScanPathFromState()
ScanPathOption = str | None | _ScanPathFromState


@dataclass(frozen=True)
class QueueBuildOptions:
    """Configuration for queue construction."""

    count: int | None = 1
    explain: bool = False
    scan_path: ScanPathOption = _SCAN_PATH_FROM_STATE
    scope: str | None = None
    status: str = "open"
    chronic: bool = False
    include_subjective: bool = True
    subjective_threshold: float = 100.0
    plan: dict | None = None
    include_skipped: bool = False
    context: QueueContext | None = None


class WorkQueueResult(TypedDict):
    """Typed shape of the dict returned by queue builders."""

    items: list[WorkQueueItem]
    total: int
    grouped: dict[str, list[WorkQueueItem]]
    new_ids: set[str]


class QueueVisibility:
    """Named queue visibility modes for internal queue assembly."""

    ALL = "all"
    EXECUTION = "execution"
    BACKLOG = "backlog"


__all__ = [
    "QueueBuildOptions",
    "QueueVisibility",
    "ScanPathOption",
    "WorkQueueResult",
]
