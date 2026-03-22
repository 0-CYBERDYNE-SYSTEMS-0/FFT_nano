"""Dict key flow analysis — detect dead writes, phantom reads, typos, and schema drift."""

from __future__ import annotations

from .flow import detect_dict_key_flow
from .schema import detect_schema_drift
from .shared import (
    TrackedDict,
    _BULK_READ_METHODS,
    _CONFIG_NAMES,
    _READ_METHODS,
    _WRITE_METHODS,
    _get_name,
    _get_str_key,
    _is_singular_plural,
    _levenshtein,
)


__all__ = [
    "TrackedDict",
    "detect_dict_key_flow",
    "detect_schema_drift",
]
