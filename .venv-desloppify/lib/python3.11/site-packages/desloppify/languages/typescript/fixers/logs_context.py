"""Logger-wrapper context detection for the TypeScript logs fixer."""

from __future__ import annotations

import re

_LOGGER_WRAPPER_NAMES = frozenset(
    {
        "log",
        "logger",
        "info",
        "warn",
        "warning",
        "error",
        "debug",
        "trace",
        "fatal",
        "notice",
    }
)

_INLINE_WRAPPER_PATTERNS = (
    re.compile(
        r"""
        ^\s*(?P<name>[A-Za-z_$][\w$]*|['"][^'"]+['"])
        \s*:\s*
        (?:async\s*)?
        (?:\([^)]*\)|[A-Za-z_$][\w$]*)
        \s*=>\s*
        console\.(?:log|warn|info|debug|error)\s*\(
        """,
        re.VERBOSE,
    ),
    re.compile(
        r"""
        ^\s*(?:const|let|var)\s+(?P<name>[A-Za-z_$][\w$]*)
        \s*=\s*
        (?:async\s*)?
        (?:\([^)]*\)|[A-Za-z_$][\w$]*)
        \s*=>\s*
        console\.(?:log|warn|info|debug|error)\s*\(
        """,
        re.VERBOSE,
    ),
    re.compile(
        r"""
        ^\s*(?:public|private|protected|readonly|static|async\s+)*
        (?P<name>[A-Za-z_$][\w$]*)
        \s*\([^)]*\)\s*\{\s*
        console\.(?:log|warn|info|debug|error)\s*\(
        """,
        re.VERBOSE,
    ),
)

_PREV_LINE_HEADER_PATTERNS = (
    re.compile(
        r"""
        ^\s*(?P<name>[A-Za-z_$][\w$]*|['"][^'"]+['"])
        \s*:\s*
        (?:async\s*)?
        (?:\([^)]*\)|[A-Za-z_$][\w$]*)
        \s*=>\s*$
        """,
        re.VERBOSE,
    ),
    re.compile(
        r"""
        ^\s*(?:const|let|var)\s+(?P<name>[A-Za-z_$][\w$]*)
        \s*=\s*
        (?:async\s*)?
        (?:\([^)]*\)|[A-Za-z_$][\w$]*)
        \s*=>\s*$
        """,
        re.VERBOSE,
    ),
    re.compile(
        r"""
        ^\s*(?:public|private|protected|readonly|static|async\s+)*
        (?P<name>[A-Za-z_$][\w$]*)
        \s*\([^)]*\)\s*\{\s*$
        """,
        re.VERBOSE,
    ),
)

_CONTROL_FLOW_NAMES = frozenset(
    {
        "if",
        "for",
        "while",
        "switch",
        "catch",
        "function",
    }
)


def _normalize_wrapper_name(raw: str | None) -> str:
    if not raw:
        return ""
    return raw.strip().strip("'\"").lower()


def _is_logger_wrapper_name(raw: str | None) -> bool:
    return _normalize_wrapper_name(raw) in _LOGGER_WRAPPER_NAMES


def _line_logger_wrapper_name(line: str, patterns: tuple[re.Pattern[str], ...]) -> str | None:
    for pattern in patterns:
        match = pattern.match(line)
        if match:
            name = _normalize_wrapper_name(match.group("name"))
            if name and name not in _CONTROL_FLOW_NAMES:
                return name
    return None


def _previous_non_empty_line(lines: list[str], idx: int) -> str | None:
    j = idx - 1
    while j >= 0:
        stripped = lines[j].strip()
        if stripped:
            return stripped
        j -= 1
    return None


def is_logger_wrapper_context(lines: list[str], start: int) -> bool:
    """Return True when console logging is part of a named logger wrapper."""
    current = lines[start].strip()
    inline_name = _line_logger_wrapper_name(current, _INLINE_WRAPPER_PATTERNS)
    if _is_logger_wrapper_name(inline_name):
        return True

    if not re.search(r"\bconsole\.(?:log|warn|info|debug|error)\s*\(", current):
        return False

    prev = _previous_non_empty_line(lines, start)
    if prev is None:
        return False
    prev_name = _line_logger_wrapper_name(prev, _PREV_LINE_HEADER_PATTERNS)
    return _is_logger_wrapper_name(prev_name)


__all__ = ["is_logger_wrapper_context"]
