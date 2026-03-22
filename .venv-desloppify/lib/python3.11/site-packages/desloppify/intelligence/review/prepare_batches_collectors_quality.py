"""Collector helpers for architecture/conventions/abstractions/testing dimensions."""

from __future__ import annotations

from desloppify.intelligence.review._context.models import HolisticContext

from .prepare_batches_core import _collect_unique_files, _representative_files_for_directory


def _arch_coupling_files(
    ctx: HolisticContext,
    *,
    max_files: int | None = None,
) -> list[str]:
    """Files relevant to architecture/coupling dimensions."""
    return _collect_unique_files(
        [
            ctx.architecture.get("god_modules", []),
            ctx.coupling.get("module_level_io", []),
            ctx.coupling.get("boundary_violations", []),
            ctx.dependencies.get("deferred_import_density", []),
        ],
        max_files=max_files,
    )


def _conventions_files(
    ctx: HolisticContext,
    *,
    max_files: int | None = None,
) -> list[str]:
    """Files relevant to conventions/errors dimensions."""
    sibling = ctx.conventions.get("sibling_behavior", {})
    outlier_files = [
        {"file": outlier["file"]}
        for dim_info in sibling.values()
        for outlier in dim_info.get("outliers", [])
    ]
    error_dirs = ctx.errors.get("strategy_by_directory", {})
    mixed_dir_files: list[dict[str, str]] = []
    for directory, strategies in error_dirs.items():
        if not isinstance(strategies, dict) or len(strategies) < 3:
            continue
        for filepath in _representative_files_for_directory(ctx, directory):
            mixed_dir_files.append({"file": filepath})

    exception_files = [
        {"file": item.get("file", "")}
        for item in ctx.errors.get("exception_hotspots", [])
        if isinstance(item, dict)
    ]
    dupe_files = [
        {"file": item.get("files", [""])[0]}
        for item in ctx.conventions.get("duplicate_clusters", [])
        if isinstance(item, dict) and item.get("files")
    ]
    naming_drift_files: list[dict[str, str]] = []
    for entry in ctx.conventions.get("naming_drift", []):
        if not isinstance(entry, dict):
            continue
        directory = entry.get("directory", "")
        for filepath in _representative_files_for_directory(ctx, directory):
            naming_drift_files.append({"file": filepath})

    return _collect_unique_files(
        [
            outlier_files,
            mixed_dir_files,
            exception_files,
            dupe_files,
            naming_drift_files,
        ],
        max_files=max_files,
    )


def _abstractions_files(
    ctx: HolisticContext,
    *,
    max_files: int | None = None,
) -> list[str]:
    """Files relevant to abstractions/dependencies dimensions."""
    util_files = ctx.abstractions.get("util_files", [])
    wrapper_files = [
        {"file": item.get("file", "")}
        for item in ctx.abstractions.get("pass_through_wrappers", [])
        if isinstance(item, dict)
    ]
    indirection_files = [
        {"file": item.get("file", "")}
        for item in ctx.abstractions.get("indirection_hotspots", [])
        if isinstance(item, dict)
    ]
    param_bag_files = [
        {"file": item.get("file", "")}
        for item in ctx.abstractions.get("wide_param_bags", [])
        if isinstance(item, dict)
    ]
    interface_files: list[dict[str, str]] = []
    for item in ctx.abstractions.get("one_impl_interfaces", []):
        if not isinstance(item, dict):
            continue
        for group in ("declared_in", "implemented_in"):
            for filepath in item.get(group, []):
                interface_files.append({"file": filepath})

    delegation_files = [
        {"file": item.get("file", "")}
        for item in ctx.abstractions.get("delegation_heavy_classes", [])
        if isinstance(item, dict)
    ]
    facade_files = [
        {"file": item.get("file", "")}
        for item in ctx.abstractions.get("facade_modules", [])
        if isinstance(item, dict)
    ]
    type_violation_files = [
        {"file": item.get("file", "")}
        for item in ctx.abstractions.get("typed_dict_violations", [])
        if isinstance(item, dict)
    ]
    complexity_files = [
        {"file": item.get("file", "")}
        for item in ctx.abstractions.get("complexity_hotspots", [])
        if isinstance(item, dict)
    ]
    cycle_files: list[dict] = []
    for summary in ctx.dependencies.get("cycle_summaries", []):
        for token in summary.split():
            if "/" in token and "." in token:
                cycle_files.append({"file": token.strip(",\'\"")})

    return _collect_unique_files(
        [
            util_files,
            wrapper_files,
            indirection_files,
            param_bag_files,
            interface_files,
            delegation_files,
            facade_files,
            type_violation_files,
            complexity_files,
            cycle_files,
        ],
        max_files=max_files,
    )


def _testing_api_files(
    ctx: HolisticContext,
    *,
    max_files: int | None = None,
) -> list[str]:
    """Files relevant to testing/API dimensions."""
    critical = ctx.testing.get("critical_untested", [])
    sync_async = [{"file": filepath} for filepath in ctx.api_surface.get("sync_async_mix", [])]
    return _collect_unique_files([critical, sync_async], max_files=max_files)


def _workflow_seam_files(
    ctx: HolisticContext,
    *,
    max_files: int | None = None,
) -> list[str]:
    """Files relevant to cross-module handoff and seam choreography."""
    boundary_files = [
        {"file": item.get("file", "")}
        for item in ctx.coupling.get("boundary_violations", [])
        if isinstance(item, dict)
    ]
    handoff_files = [
        {"file": item.get("file", "")}
        for item in ctx.coupling.get("module_level_io", [])
        if isinstance(item, dict)
    ]
    wrapper_files = [
        {"file": item.get("file", "")}
        for item in ctx.abstractions.get("pass_through_wrappers", [])
        if isinstance(item, dict)
    ]
    interface_files: list[dict[str, str]] = []
    for item in ctx.abstractions.get("one_impl_interfaces", []):
        if not isinstance(item, dict):
            continue
        for group in ("declared_in", "implemented_in"):
            for filepath in item.get(group, []):
                interface_files.append({"file": filepath})
    sync_async = [{"file": filepath} for filepath in ctx.api_surface.get("sync_async_mix", [])]
    return _collect_unique_files(
        [boundary_files, handoff_files, wrapper_files, interface_files, sync_async],
        max_files=max_files,
    )


__all__ = [
    "_abstractions_files",
    "_arch_coupling_files",
    "_conventions_files",
    "_testing_api_files",
    "_workflow_seam_files",
]
