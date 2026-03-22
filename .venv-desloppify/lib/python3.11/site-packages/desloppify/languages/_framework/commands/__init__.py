"""Canonical command-factory subpackage for language framework helpers."""

from .base import (
    make_cmd_complexity,
    make_cmd_facade,
    make_cmd_large,
    make_cmd_naming,
    make_cmd_passthrough,
    make_cmd_single_use,
)
from .registry import (
    build_composed_detect_registry,
    build_standard_detect_registry,
    compose_detect_registry,
    make_cmd_cycles,
    make_cmd_deps,
    make_cmd_dupes,
    make_cmd_orphaned,
)
from .scaffold import (
    SCAFFOLD_HOLISTIC_REVIEW_DIMENSIONS,
    SCAFFOLD_VERIFY_HINT,
    scaffold_find_replacements,
    scaffold_find_self_replacements,
    scaffold_verify_hint,
)

__all__ = [
    "SCAFFOLD_HOLISTIC_REVIEW_DIMENSIONS",
    "SCAFFOLD_VERIFY_HINT",
    "build_composed_detect_registry",
    "build_standard_detect_registry",
    "compose_detect_registry",
    "make_cmd_complexity",
    "make_cmd_cycles",
    "make_cmd_deps",
    "make_cmd_dupes",
    "make_cmd_facade",
    "make_cmd_large",
    "make_cmd_naming",
    "make_cmd_orphaned",
    "make_cmd_passthrough",
    "make_cmd_single_use",
    "scaffold_find_replacements",
    "scaffold_find_self_replacements",
    "scaffold_verify_hint",
]
