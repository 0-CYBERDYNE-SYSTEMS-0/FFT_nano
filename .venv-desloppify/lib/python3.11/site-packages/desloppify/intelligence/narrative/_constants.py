"""Shared constants for the narrative package.

Separate module to avoid import cycles — submodules import from here
instead of from __init__.py.
"""

from __future__ import annotations

from desloppify.base.registry import (
    detector_tools as _detector_tools,
)
from desloppify.base.registry import (
    on_detector_registered,
)

DETECTOR_TOOLS = _detector_tools()


def _refresh_detector_tools() -> None:
    """Rebuild DETECTOR_TOOLS from current DETECTORS."""
    DETECTOR_TOOLS.clear()
    DETECTOR_TOOLS.update(_detector_tools())


# Auto-refresh when new detectors are registered at runtime.
on_detector_registered(_refresh_detector_tools)


# Structural sub-detectors that merge under "structural"
STRUCTURAL_MERGE = {"large", "complexity", "gods", "concerns"}

# Detector-level cascade: fixing one detector may auto-resolve issues in another.
_DETECTOR_CASCADE = {
    "logs": ["unused"],
    "smells": ["unused"],
}

_REMINDER_DECAY_THRESHOLD = 3  # Suppress after this many occurrences

_FEEDBACK_URL = "https://github.com/peteromalley/desloppify/issues"


def _history_strict(entry: dict) -> float | None:
    """Strict score from history entry."""
    return entry.get("strict_score")
