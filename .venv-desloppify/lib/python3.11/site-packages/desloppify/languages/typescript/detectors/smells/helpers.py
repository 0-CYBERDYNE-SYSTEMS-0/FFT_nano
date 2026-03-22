"""TypeScript smell helper utilities — block parsing, line-state, code projection."""

from __future__ import annotations

from typing import NamedTuple

from desloppify.base.text_utils import strip_c_style_comments
from desloppify.languages.typescript.syntax.scanner import scan_code


# ---------------------------------------------------------------------------
# Data types
# ---------------------------------------------------------------------------


class _FileContext(NamedTuple):
    """Per-file data bundle passed to all smell detectors."""

    filepath: str
    content: str
    lines: list[str]
    line_state: dict[int, str]


# ---------------------------------------------------------------------------
# Comment / string helpers
# ---------------------------------------------------------------------------


def _strip_ts_comments(text: str) -> str:
    """Strip // and /* */ comments while preserving strings."""
    return strip_c_style_comments(text)


def _ts_match_is_in_string(line: str, match_start: int) -> bool:
    """Check if a match position falls inside a string literal/comment on one line."""
    i = 0
    in_str = None

    while i < len(line):
        if i == match_start:
            return in_str is not None

        ch = line[i]

        if in_str and ch == "\\" and i + 1 < len(line):
            i += 2
            continue

        if in_str:
            if ch == in_str:
                in_str = None
            i += 1
            continue

        if ch == "/" and i + 1 < len(line) and line[i + 1] == "/":
            return match_start > i

        if ch in ("'", '"', "`"):
            in_str = ch
            i += 1
            continue

        i += 1

    return False


# ---------------------------------------------------------------------------
# Block parsing helpers (formerly _smell_helpers_blocks.py)
# ---------------------------------------------------------------------------


def _track_brace_body(
    lines: list[str], start_line: int, *, max_scan: int = 2000
) -> int | None:
    """Find the closing brace matching the first opening brace from start_line."""
    depth = 0
    found_open = False
    for line_idx in range(start_line, min(start_line + max_scan, len(lines))):
        for _, ch, in_string in scan_code(lines[line_idx]):
            if in_string:
                continue
            if ch == "{":
                depth += 1
                found_open = True
            elif ch == "}":
                depth -= 1
                if found_open and depth == 0:
                    return line_idx
    return None


def _find_block_end(content: str, brace_start: int, max_scan: int = 5000) -> int | None:
    """Find the closing brace position in a content string from an opening brace."""
    depth = 0
    for ci, ch, in_s in scan_code(
        content, brace_start, min(brace_start + max_scan, len(content))
    ):
        if in_s:
            continue
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return ci
    return None


def _extract_block_body(
    content: str, brace_start: int, max_scan: int = 5000
) -> str | None:
    """Return text between ``{`` at brace_start and its matching ``}``."""
    end = _find_block_end(content, brace_start, max_scan)
    if end is None:
        return None
    return content[brace_start + 1 : end]


def _content_line_info(content: str, pos: int) -> tuple[int, str]:
    """Return ``(line_no, stripped snippet[:100])`` for a position in content."""
    line_no = content[:pos].count("\n") + 1
    line_start = content.rfind("\n", 0, pos) + 1
    line_end = content.find("\n", pos)
    if line_end == -1:
        line_end = len(content)
    return line_no, content[line_start:line_end].strip()[:100]


def _code_text(text: str) -> str:
    """Blank string literals and ``//`` comments to spaces, preserving positions."""
    out = list(text)
    in_line_comment = False
    prev_code_idx = -2
    prev_code_ch = ""
    for i, ch, in_s in scan_code(text):
        if ch == "\n":
            in_line_comment = False
            prev_code_ch = ""
            continue
        if in_line_comment:
            out[i] = " "
            continue
        if in_s:
            out[i] = " "
            continue
        if ch == "/" and prev_code_ch == "/" and prev_code_idx == i - 1:
            out[prev_code_idx] = " "
            out[i] = " "
            in_line_comment = True
            prev_code_ch = ""
            continue
        prev_code_idx = i
        prev_code_ch = ch
    return "".join(out)


# ---------------------------------------------------------------------------
# Line-state scanners (formerly _smell_helpers_line_state.py)
# ---------------------------------------------------------------------------


def _scan_template_content(
    line: str, start: int, brace_depth: int = 0
) -> tuple[int, bool, int]:
    """Scan template literal content from *start* in *line*."""
    j = start
    while j < len(line):
        ch = line[j]
        if ch == "\\" and j + 1 < len(line):
            j += 2
            continue
        if ch == "$" and j + 1 < len(line) and line[j + 1] == "{":
            brace_depth += 1
            j += 2
            continue
        if ch == "}" and brace_depth > 0:
            brace_depth -= 1
            j += 1
            continue
        if ch == "`" and brace_depth == 0:
            return (j + 1, True, brace_depth)
        j += 1
    return (j, False, brace_depth)


def _scan_code_line(line: str) -> tuple[bool, bool, int]:
    """Scan a normal code line for block comment or template literal start."""
    j = 0
    in_str = None
    while j < len(line):
        ch = line[j]

        if in_str and ch == "\\" and j + 1 < len(line):
            j += 2
            continue

        if in_str:
            if ch == in_str:
                in_str = None
            j += 1
            continue

        if ch == "/" and j + 1 < len(line) and line[j + 1] == "/":
            break

        if ch == "/" and j + 1 < len(line) and line[j + 1] == "*":
            close = line.find("*/", j + 2)
            if close != -1:
                j = close + 2
                continue
            return (True, False, 0)

        if ch == "`":
            end_pos, found_close, depth = _scan_template_content(line, j + 1)
            if found_close:
                j = end_pos
                continue
            return (False, True, depth)

        if ch in ("'", '"'):
            in_str = ch
            j += 1
            continue

        j += 1

    return (False, False, 0)


def _build_ts_line_state(lines: list[str]) -> dict[int, str]:
    """Build a map of lines inside block comments or template literals."""
    state: dict[int, str] = {}
    in_block_comment = False
    in_template = False
    template_brace_depth = 0

    for i, line in enumerate(lines):
        if in_block_comment:
            state[i] = "block_comment"
            if "*/" in line:
                in_block_comment = False
            continue

        if in_template:
            state[i] = "template_literal"
            _, found_close, template_brace_depth = _scan_template_content(
                line, 0, template_brace_depth
            )
            if found_close:
                in_template = False
            continue

        in_block_comment, in_template, depth = _scan_code_line(line)
        if in_template:
            template_brace_depth = depth

    return state


__all__ = [
    "_FileContext",
    "_build_ts_line_state",
    "_code_text",
    "_content_line_info",
    "_extract_block_body",
    "_find_block_end",
    "_scan_code_line",
    "_scan_template_content",
    "_strip_ts_comments",
    "_track_brace_body",
    "_ts_match_is_in_string",
    "scan_code",
]
