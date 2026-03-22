"""C# move helpers."""

from __future__ import annotations

VERIFY_HINT = "dotnet build"


def find_replacements(
    source_abs: str,
    dest_abs: str,
    graph: dict,
) -> dict[str, list[tuple[str, str]]]:
    """C# import/namespace rewrites are not implemented yet."""
    del source_abs, dest_abs, graph
    return {}


def find_self_replacements(
    source_abs: str,
    dest_abs: str,
    graph: dict,
) -> list[tuple[str, str]]:
    """No self-import rewrites for C# at this time."""
    del source_abs, dest_abs, graph
    return []


def filter_intra_package_importer_changes(
    source_file: str,
    replacements: list[tuple[str, str]],
    moving_files: set[str],
) -> list[tuple[str, str]]:
    """Return replacements unchanged for C#."""
    del source_file, moving_files
    return replacements


def filter_directory_self_changes(
    source_file: str,
    self_changes: list[tuple[str, str]],
    moving_files: set[str],
) -> list[tuple[str, str]]:
    """Return self changes unchanged for C#."""
    del source_file, moving_files
    return self_changes
