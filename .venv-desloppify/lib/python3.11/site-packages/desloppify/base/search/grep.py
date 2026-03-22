"""Cross-platform grep-style helpers."""

from __future__ import annotations

import os
import re
from typing import TypedDict

from desloppify.base.discovery.source import read_file_text as _read_file_text
from desloppify.base.discovery.paths import get_project_root
from desloppify.base.runtime_state import current_runtime_context


class ReadDiagnostic(TypedDict):
    filepath: str
    abs_path: str
    error_kind: str


def _record_unreadable_file(
    diagnostics: list[ReadDiagnostic] | None,
    *,
    filepath: str,
    abs_path: str,
) -> None:
    if diagnostics is None:
        return
    runtime = current_runtime_context()
    error_kind = runtime.file_text_cache.last_error_kind(abs_path) or "unknown"
    diagnostics.append(
        {
            "filepath": filepath,
            "abs_path": abs_path,
            "error_kind": error_kind,
        }
    )


def grep_files(
    pattern: str,
    file_list: list[str],
    *,
    flags: int = 0,
    diagnostics: list[ReadDiagnostic] | None = None,
) -> list[tuple[str, int, str]]:
    """Search files for a regex pattern. Returns (filepath, lineno, line_text)."""
    compiled = re.compile(pattern, flags)
    results: list[tuple[str, int, str]] = []
    for filepath in file_list:
        abs_path = filepath if os.path.isabs(filepath) else str(get_project_root() / filepath)
        content = _read_file_text(abs_path)
        if content is None:
            _record_unreadable_file(
                diagnostics,
                filepath=filepath,
                abs_path=abs_path,
            )
            continue
        for lineno, line in enumerate(content.splitlines(), 1):
            if compiled.search(line):
                results.append((filepath, lineno, line))
    return results


def grep_files_containing(
    names: set[str],
    file_list: list[str],
    *,
    word_boundary: bool = True,
    diagnostics: list[ReadDiagnostic] | None = None,
) -> dict[str, set[str]]:
    r"""Find which files contain which names. Returns {name: set(filepaths)}."""
    if not names:
        return {}
    names_by_length = sorted(names, key=len, reverse=True)
    if word_boundary:
        combined = re.compile(
            r"\b(?:" + "|".join(re.escape(n) for n in names_by_length) + r")\b"
        )
    else:
        combined = re.compile("|".join(re.escape(n) for n in names_by_length))

    name_to_files: dict[str, set[str]] = {}
    for filepath in file_list:
        abs_path = filepath if os.path.isabs(filepath) else str(get_project_root() / filepath)
        content = _read_file_text(abs_path)
        if content is None:
            _record_unreadable_file(
                diagnostics,
                filepath=filepath,
                abs_path=abs_path,
            )
            continue
        found = set(combined.findall(content))
        for name in found & names:
            name_to_files.setdefault(name, set()).add(filepath)
    return name_to_files


def grep_count_files(
    name: str,
    file_list: list[str],
    *,
    word_boundary: bool = True,
    diagnostics: list[ReadDiagnostic] | None = None,
) -> list[str]:
    """Return list of files containing name."""
    if word_boundary:
        pat = re.compile(r"\b" + re.escape(name) + r"\b")
    else:
        pat = re.compile(re.escape(name))
    matching: list[str] = []
    for filepath in file_list:
        abs_path = filepath if os.path.isabs(filepath) else str(get_project_root() / filepath)
        content = _read_file_text(abs_path)
        if content is None:
            _record_unreadable_file(
                diagnostics,
                filepath=filepath,
                abs_path=abs_path,
            )
            continue
        if pat.search(content):
            matching.append(filepath)
    return matching


__all__ = [
    "ReadDiagnostic",
    "grep_count_files",
    "grep_files",
    "grep_files_containing",
]
