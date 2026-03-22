"""Configuration model and defaults for flat-directory detection."""

from __future__ import annotations

from dataclasses import dataclass

THIN_WRAPPER_NAMES = frozenset(
    {
        "components",
        "hooks",
        "utils",
        "services",
        "state",
        "contexts",
        "contracts",
        "types",
        "models",
        "adapters",
        "helpers",
        "core",
        "common",
    }
)
DEFAULT_THIN_WRAPPER_NAMES = (
    "components",
    "hooks",
    "utils",
    "services",
    "state",
    "contexts",
    "contracts",
    "types",
    "models",
    "adapters",
    "helpers",
    "core",
    "common",
)


@dataclass(frozen=True)
class FlatDirDetectionConfig:
    """Thresholds and heuristics for flat directory detection."""

    threshold: int = 20
    child_dir_threshold: int = 10
    child_dir_weight: int = 3
    combined_threshold: int = 30
    sparse_parent_child_threshold: int = 8
    sparse_child_file_threshold: int = 1
    sparse_child_count_threshold: int = 6
    sparse_child_ratio_threshold: float = 0.7
    thin_wrapper_parent_sibling_threshold: int = 10
    thin_wrapper_max_file_count: int = 1
    thin_wrapper_max_child_dir_count: int = 1
    thin_wrapper_names: tuple[str, ...] = DEFAULT_THIN_WRAPPER_NAMES


def resolve_detection_settings(
    *,
    threshold: int,
    config: FlatDirDetectionConfig | None,
    child_dir_threshold: int,
    child_dir_weight: int,
    combined_threshold: int,
    sparse_parent_child_threshold: int,
    sparse_child_file_threshold: int,
    sparse_child_count_threshold: int,
    sparse_child_ratio_threshold: float,
    thin_wrapper_parent_sibling_threshold: int,
    thin_wrapper_max_file_count: int,
    thin_wrapper_max_child_dir_count: int,
    thin_wrapper_names: tuple[str, ...],
) -> FlatDirDetectionConfig:
    """Return explicit settings, preferring an already-built config object."""
    if config is not None:
        return config

    normalized_names = tuple(
        dict.fromkeys(
            name.strip().lower()
            for name in thin_wrapper_names
            if isinstance(name, str) and name.strip()
        )
    )
    if not normalized_names:
        normalized_names = DEFAULT_THIN_WRAPPER_NAMES

    normalized_threshold = max(1, int(threshold))
    normalized_child_threshold = max(1, int(child_dir_threshold))
    normalized_child_weight = max(1, int(child_dir_weight))
    normalized_combined_threshold = max(1, int(combined_threshold))
    normalized_sparse_parent_threshold = max(1, int(sparse_parent_child_threshold))
    normalized_sparse_child_file = max(0, int(sparse_child_file_threshold))
    normalized_sparse_child_count = max(1, int(sparse_child_count_threshold))
    normalized_sparse_ratio = max(0.0, min(1.0, float(sparse_child_ratio_threshold)))
    normalized_wrapper_parent_sibling = max(
        1,
        int(thin_wrapper_parent_sibling_threshold),
    )
    normalized_wrapper_file_count = max(0, int(thin_wrapper_max_file_count))
    normalized_wrapper_child_count = max(0, int(thin_wrapper_max_child_dir_count))

    return FlatDirDetectionConfig(
        threshold=normalized_threshold,
        child_dir_threshold=normalized_child_threshold,
        child_dir_weight=normalized_child_weight,
        combined_threshold=normalized_combined_threshold,
        sparse_parent_child_threshold=normalized_sparse_parent_threshold,
        sparse_child_file_threshold=normalized_sparse_child_file,
        sparse_child_count_threshold=normalized_sparse_child_count,
        sparse_child_ratio_threshold=normalized_sparse_ratio,
        thin_wrapper_parent_sibling_threshold=normalized_wrapper_parent_sibling,
        thin_wrapper_max_file_count=normalized_wrapper_file_count,
        thin_wrapper_max_child_dir_count=normalized_wrapper_child_count,
        thin_wrapper_names=normalized_names,
    )


__all__ = [
    "DEFAULT_THIN_WRAPPER_NAMES",
    "FlatDirDetectionConfig",
    "THIN_WRAPPER_NAMES",
    "resolve_detection_settings",
]
