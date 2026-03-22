"""Detect enum classes with zero external imports."""

from __future__ import annotations

import ast
import logging
from pathlib import Path

from desloppify.base.discovery.file_paths import rel

from desloppify.base.discovery.source import find_py_files

logger = logging.getLogger(__name__)

_ENUM_BASES = {"StrEnum", "IntEnum", "Enum"}


def detect_unused_enums(path: Path) -> tuple[list[dict], int]:
    """Find enum classes that are never imported by any other file.

    Returns ``(entries, total_files_checked)``.
    Each entry has: file, name, line, member_count.
    """
    # Phase 1: collect enum definitions per file.
    files = find_py_files(path)
    enum_defs: dict[str, list[dict]] = {}  # filepath → [{name, line, member_count}]
    imports_by_file: dict[str, set[str]] = {}  # filepath → {imported names}

    for filepath in files:
        try:
            p = Path(filepath) if Path(filepath).is_absolute() else path / filepath
            content = p.read_text()
        except (OSError, UnicodeDecodeError) as exc:
            logger.debug("Skipping unreadable python source %s: %s", filepath, exc)
            continue
        try:
            tree = ast.parse(content, filename=filepath)
        except SyntaxError as exc:
            logger.debug("Skipping unparsable python source %s: %s", filepath, exc)
            continue

        # Collect enum definitions in this file.
        file_enums: list[dict] = []
        for node in ast.walk(tree):
            if not isinstance(node, ast.ClassDef):
                continue
            is_enum = any(
                (isinstance(b, ast.Name) and b.id in _ENUM_BASES)
                or (isinstance(b, ast.Attribute) and b.attr in _ENUM_BASES)
                for b in node.bases
            )
            if not is_enum:
                continue
            member_count = sum(
                1
                for child in node.body
                if isinstance(child, ast.Assign)
                and any(isinstance(t, ast.Name) for t in child.targets)
            )
            file_enums.append({
                "name": node.name,
                "line": node.lineno,
                "member_count": member_count,
            })

        if file_enums:
            enum_defs[filepath] = file_enums

        # Collect all imported names from this file.
        imported: set[str] = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom):
                for alias in node.names:
                    imported.add(alias.name)
            elif isinstance(node, ast.Import):
                for alias in node.names:
                    imported.add(alias.name.split(".")[-1])
        imports_by_file[filepath] = imported

    if not enum_defs:
        return [], len(files)

    # Phase 2: check which enums are imported by at least one *other* file.
    all_enum_names: dict[str, list[str]] = {}  # enum_name → [defining_files]
    for filepath, defs in enum_defs.items():
        for d in defs:
            all_enum_names.setdefault(d["name"], []).append(filepath)

    externally_imported: set[str] = set()
    for filepath, imported in imports_by_file.items():
        for name in imported:
            if name in all_enum_names and filepath not in all_enum_names[name]:
                externally_imported.add(name)

    # Phase 3: report enums with zero external imports.
    entries: list[dict] = []
    for filepath, defs in enum_defs.items():
        rpath = rel(filepath)
        for d in defs:
            if d["name"] not in externally_imported:
                entries.append({
                    "file": rpath,
                    "name": d["name"],
                    "line": d["line"],
                    "member_count": d["member_count"],
                })

    return entries, len(files)


__all__ = ["detect_unused_enums"]
