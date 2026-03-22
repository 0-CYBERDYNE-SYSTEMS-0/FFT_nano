"""Rust detector package."""

from .api import (
    detect_error_boundaries,
    detect_future_proofing,
    detect_import_hygiene,
    detect_public_api_conventions,
    detect_thread_safety_contracts,
)
from .cargo_policy import (
    detect_doctest_hygiene,
    detect_feature_hygiene,
)
from .safety import (
    detect_async_locking,
    detect_drop_safety,
    detect_unsafe_api_usage,
)
from .smells import detect_smells
from .deps import build_dep_graph

__all__ = [
    "build_dep_graph",
    "detect_async_locking",
    "detect_doctest_hygiene",
    "detect_drop_safety",
    "detect_error_boundaries",
    "detect_feature_hygiene",
    "detect_future_proofing",
    "detect_import_hygiene",
    "detect_public_api_conventions",
    "detect_thread_safety_contracts",
    "detect_unsafe_api_usage",
    "detect_smells",
]
