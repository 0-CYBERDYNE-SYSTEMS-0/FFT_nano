"""Flat directory detection facade.

The implementation is split across ``desloppify.engine.detectors._flat_dirs``
modules to keep this public module small while preserving the existing import
surface.
"""

from __future__ import annotations

from ._flat_dirs.config import (
    THIN_WRAPPER_NAMES,
    FlatDirDetectionConfig,
)
from ._flat_dirs.detect import detect_flat_dirs
from ._flat_dirs.entries import (
    format_flat_dir_summary,
)

__all__ = [
    "FlatDirDetectionConfig",
    "THIN_WRAPPER_NAMES",
    "detect_flat_dirs",
    "format_flat_dir_summary",
]
