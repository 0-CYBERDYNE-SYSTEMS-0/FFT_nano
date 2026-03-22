"""Compatibility entrypoint for the TypeScript unused-import fixer."""

from __future__ import annotations

from collections import defaultdict

from desloppify.languages._framework.base.types import FixResult

from .fixer_io import apply_fixer
from .import_rewrite import process_unused_import_lines


def fix_unused_imports(entries: list[dict], *, dry_run: bool = False) -> FixResult:
    """Remove unused imports from source files."""
    import_entries = [entry for entry in entries if entry.get("category") == "imports"]

    def transform(lines: list[str], file_entries: list[dict[str, object]]) -> tuple[list[str], list[str]]:
        unused_symbols = {str(entry["name"]) for entry in file_entries if "name" in entry}
        unused_by_line: dict[int, list[str]] = defaultdict(list)
        for entry in file_entries:
            line = entry.get("line")
            name = entry.get("name")
            if isinstance(line, int) and name is not None:
                unused_by_line[line].append(str(name))

        new_lines, removed_symbols = process_unused_import_lines(lines, unused_symbols, unused_by_line)
        removed: list[str] = []
        for entry in file_entries:
            name = str(entry.get("name", ""))
            if name in removed_symbols and name not in removed:
                removed.append(name)
        return new_lines, removed

    return FixResult(entries=apply_fixer(import_entries, transform, dry_run=dry_run))


__all__ = ["fix_unused_imports"]
