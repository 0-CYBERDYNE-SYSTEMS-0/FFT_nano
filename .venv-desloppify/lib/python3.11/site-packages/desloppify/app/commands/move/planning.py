"""Planning helpers for move command operations."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

Replacement = tuple[str, str]
ReplacementList = list[Replacement]
ReplacementMap = dict[str, ReplacementList]


def dedup_replacements(replacements: ReplacementList) -> ReplacementList:
    """Deduplicate replacement tuples while preserving order."""
    seen: set[Replacement] = set()
    result: ReplacementList = []
    for pair in replacements:
        if pair not in seen:
            seen.add(pair)
            result.append(pair)
    return result


def resolve_dest(source: str, dest_raw: str, resolve_path_fn) -> str:
    """Resolve destination path, keeping source filename if dest is a directory."""
    dest_path = Path(dest_raw)
    if dest_path.is_dir() or dest_raw.endswith("/"):
        dest_path = dest_path / Path(source).name
    return resolve_path_fn(str(dest_path))


def compute_replacements(
    move_mod,
    source_abs: str,
    dest_abs: str,
    graph: dict,
) -> tuple[ReplacementMap, ReplacementList]:
    """Compute importer/self replacements via language move module."""
    return (
        move_mod.find_replacements(source_abs, dest_abs, graph),
        move_mod.find_self_replacements(source_abs, dest_abs, graph),
    )


def collect_source_files(source_path: Path, extensions: list[str]) -> list[str]:
    """Collect files under a directory for the target language extensions."""
    source_files: list[Path] = []
    for ext in extensions:
        source_files.extend(source_path.rglob(f"*{ext}"))
    return sorted(
        str(filepath.resolve()) for filepath in source_files if filepath.is_file()
    )


def _merge_unique_changes(
    target: ReplacementMap,
    filepath: str,
    replacements: ReplacementList,
) -> None:
    """Merge replacement tuples into ``target`` without duplicating entries."""
    if not replacements:
        return
    if filepath in target:
        existing = set(target[filepath])
        target[filepath].extend(repl for repl in replacements if repl not in existing)
        return
    target[filepath] = list(replacements)


@dataclass
class DirectoryMovePlan:
    """Planned directory move operations and grouped replacement sets."""

    file_moves: list[tuple[str, str]]
    external_changes: ReplacementMap
    intra_package_changes: ReplacementMap
    self_changes: ReplacementMap


def build_directory_move_plan(
    source_abs: str,
    source_path: Path,
    dest_abs: str,
    source_files: list[str],
    move_mod,
    graph: dict,
) -> DirectoryMovePlan:
    """Build file move mapping and import replacement groups for directory moves."""
    file_moves: list[tuple[str, str]] = []
    for src_file in source_files:
        rel_in_dir = Path(src_file).relative_to(source_path)
        dst_file = str(Path(dest_abs) / rel_in_dir)
        file_moves.append((src_file, dst_file))

    moving_files = {src for src, _ in file_moves}

    all_importer_changes: ReplacementMap = {}
    intra_pkg_changes: ReplacementMap = {}
    all_self_changes: ReplacementMap = {}

    intra_filter = getattr(
        move_mod,
        "filter_intra_package_importer_changes",
        lambda _source, replacements, _moving: replacements,
    )
    self_filter = getattr(
        move_mod,
        "filter_directory_self_changes",
        lambda _source, replacements, _moving: replacements,
    )

    for src_file, dst_file in file_moves:
        importer_changes, self_changes = compute_replacements(
            move_mod, src_file, dst_file, graph
        )

        for filepath, replacements in importer_changes.items():
            if filepath in moving_files:
                filtered = intra_filter(src_file, replacements, moving_files)
                _merge_unique_changes(intra_pkg_changes, filepath, filtered)
            else:
                _merge_unique_changes(all_importer_changes, filepath, replacements)

        if self_changes:
            filtered_self = self_filter(src_file, self_changes, moving_files)
            if filtered_self:
                all_self_changes[src_file] = filtered_self

    source_prefix = source_abs + os.sep
    external_changes = {
        filepath: replacements
        for filepath, replacements in all_importer_changes.items()
        if not filepath.startswith(source_prefix)
    }

    return DirectoryMovePlan(
        file_moves=file_moves,
        external_changes=external_changes,
        intra_package_changes=intra_pkg_changes,
        self_changes=all_self_changes,
    )


def build_internal_directory_changes(plan: DirectoryMovePlan) -> ReplacementMap:
    """Return replacement map for moved files themselves after directory rename."""
    all_internal_changes: ReplacementMap = {}
    for src_file, changes in plan.self_changes.items():
        all_internal_changes.setdefault(src_file, []).extend(changes)
    for src_file, changes in plan.intra_package_changes.items():
        all_internal_changes.setdefault(src_file, []).extend(changes)
    return all_internal_changes


def summarize_directory_plan(plan: DirectoryMovePlan) -> tuple[int, int]:
    """Return (total_changed_files, total_replacement_count) for directory plan."""
    total_changes = (
        len(plan.external_changes)
        + len(plan.intra_package_changes)
        + len(plan.self_changes)
    )
    total_replacements = (
        sum(len(v) for v in plan.external_changes.values())
        + sum(len(v) for v in plan.intra_package_changes.values())
        + sum(len(v) for v in plan.self_changes.values())
    )
    return total_changes, total_replacements


__all__ = [
    "DirectoryMovePlan",
    "build_directory_move_plan",
    "build_internal_directory_changes",
    "collect_source_files",
    "compute_replacements",
    "dedup_replacements",
    "resolve_dest",
    "summarize_directory_plan",
]
