"""Rust code smell detection orchestration."""

from __future__ import annotations

import re
from pathlib import Path

from desloppify.base.discovery.file_paths import rel, resolve_path
from desloppify.languages.rust.support import (
    describe_rust_file,
    find_rust_files,
    read_text_or_none,
    strip_rust_comments,
)

from ._shared import (
    _UTF8_RATIONALE_RE,
    _has_local_safety_rationale,
    _is_runtime_source_file,
    _line_number,
    _looks_like_repr_transparent_cast,
)
from .smells_catalog import RUST_SMELL_CHECKS, SEVERITY_ORDER

_ALLOW_ATTR_RE = re.compile(r"(?m)^[ \t]*#\[\s*allow\s*\(")
_ALLOW_WORKAROUND_RE = re.compile(
    r"(?i)(clippy bug|rust-clippy/issues|false positive|intentional workaround)"
)
_ALLOW_ATTR_SMELL_ID = "allow_attr"
_UNSAFE_BLOCK_RE = re.compile(r"\bunsafe\s*\{")
_UNSAFE_IMPL_RE = re.compile(r"\bunsafe\s+impl\b")
_UNSAFE_SMELL_ID = "undocumented_unsafe"


def detect_smells(path: Path) -> tuple[list[dict], int]:
    """Detect Rust-specific code smell patterns across runtime source files."""
    smell_counts: dict[str, list[dict]] = {check["id"]: [] for check in RUST_SMELL_CHECKS}
    total_files = 0

    for filepath in find_rust_files(path):
        absolute = Path(resolve_path(filepath))
        context = describe_rust_file(absolute)
        if not _is_runtime_source_file(context):
            continue
        total_files += 1

        content = read_text_or_none(absolute)
        if content is None:
            continue
        stripped = strip_rust_comments(content, preserve_lines=True)
        normalized_file = rel(absolute)

        _scan_pattern_smells(normalized_file, content, stripped, smell_counts)
        _detect_allow_attrs(normalized_file, content, stripped, smell_counts)
        _detect_undocumented_unsafe(normalized_file, content, stripped, smell_counts)

    entries: list[dict] = []
    for check in RUST_SMELL_CHECKS:
        matches = smell_counts[check["id"]]
        if not matches:
            continue
        entries.append(
            {
                "id": check["id"],
                "label": check["label"],
                "severity": check["severity"],
                "count": len(matches),
                "files": len({match["file"] for match in matches}),
                "matches": matches[:50],
            }
        )
    entries.sort(key=lambda entry: (SEVERITY_ORDER.get(entry["severity"], 9), -entry["count"]))
    return entries, total_files


def _scan_pattern_smells(
    filepath: str,
    raw_content: str,
    stripped_content: str,
    smell_counts: dict[str, list[dict]],
) -> None:
    for check in RUST_SMELL_CHECKS:
        pattern = check.get("pattern")
        if pattern is None:
            continue
        for match in re.finditer(pattern, stripped_content):
            line = _line_number(stripped_content, match.start())
            smell_counts[check["id"]].append(
                {
                    "file": filepath,
                    "line": line,
                    "content": _line_preview(raw_content, line),
                }
            )


def _detect_undocumented_unsafe(
    filepath: str,
    raw_content: str,
    stripped_content: str,
    smell_counts: dict[str, list[dict]],
) -> None:
    if _UNSAFE_SMELL_ID not in smell_counts:
        return
    for pattern in (_UNSAFE_BLOCK_RE, _UNSAFE_IMPL_RE):
        for match in pattern.finditer(stripped_content):
            if _has_unsafe_justification(raw_content, match.start()):
                continue
            line = _line_number(stripped_content, match.start())
            smell_counts[_UNSAFE_SMELL_ID].append(
                {
                    "file": filepath,
                    "line": line,
                    "content": _line_preview(raw_content, line),
                }
            )


def _detect_allow_attrs(
    filepath: str,
    raw_content: str,
    stripped_content: str,
    smell_counts: dict[str, list[dict]],
) -> None:
    if _ALLOW_ATTR_SMELL_ID not in smell_counts:
        return
    del stripped_content
    for match in _ALLOW_ATTR_RE.finditer(raw_content):
        if _is_allow_attr_noise(raw_content, match.start()):
            continue
        line = _line_number(raw_content, match.start())
        smell_counts[_ALLOW_ATTR_SMELL_ID].append(
            {
                "file": filepath,
                "line": line,
                "content": _line_preview(raw_content, line),
            }
        )


def _has_unsafe_justification(content: str, offset: int) -> bool:
    if _has_local_safety_rationale(content, offset):
        return True
    if _has_inline_unsafe_rationale(content, offset):
        return True
    if _looks_like_repr_transparent_cast(content, offset):
        return True
    return False


def _has_inline_unsafe_rationale(content: str, offset: int) -> bool:
    comments = _following_comment_block(content, offset, max_lines=3)
    return bool(comments and _UTF8_RATIONALE_RE.search(comments))


def _is_allow_attr_noise(content: str, offset: int) -> bool:
    if _looks_like_import_allow_attr(content, offset):
        return True
    context = _allow_attr_context(content, offset)
    return bool(_ALLOW_WORKAROUND_RE.search(context))


def _allow_attr_context(content: str, offset: int) -> str:
    line_start = content.rfind("\n", 0, offset) + 1
    line_end = content.find("\n", offset)
    if line_end == -1:
        line_end = len(content)
    previous_lines = content[:line_start].splitlines()[-2:]
    current_line = content[line_start:line_end]
    return "\n".join([*previous_lines, current_line])


def _following_comment_block(content: str, offset: int, *, max_lines: int) -> str:
    line_end = content.find("\n", offset)
    if line_end == -1:
        return ""

    collected: list[str] = []
    for raw_line in content[line_end + 1 :].splitlines()[:max_lines]:
        stripped = raw_line.strip()
        if not stripped:
            if collected:
                break
            continue
        if stripped.startswith("//"):
            collected.append(stripped)
            continue
        break
    return "\n".join(collected)


def _looks_like_import_allow_attr(content: str, offset: int) -> bool:
    line_end = content.find("\n", offset)
    if line_end == -1:
        return False
    for raw_line in content[line_end + 1 :].splitlines():
        stripped = raw_line.strip()
        if not stripped:
            continue
        return stripped.startswith("use ")
    return False


def _line_preview(content: str, line_number: int) -> str:
    lines = content.splitlines()
    if 1 <= line_number <= len(lines):
        return lines[line_number - 1].strip()[:100]
    return ""


__all__ = ["detect_smells"]
