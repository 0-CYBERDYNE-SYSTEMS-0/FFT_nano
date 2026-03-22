"""Error-handling and global-state TypeScript smell detectors."""

from __future__ import annotations

import re

from .detector_core import (
    _CATCH_DEFAULT_FIELD_THRESHOLD,
    _MAX_CATCH_BODY,
    _MAX_SWITCH_BODY_SCAN,
    _SWITCH_CASE_MINIMUM,
    _emit,
)
from .helpers import (
    _content_line_info,
    _extract_block_body,
    _strip_ts_comments,
    _ts_match_is_in_string,
)


def _detect_catch_return_default(ctx, smell_counts: dict[str, list[dict]]) -> None:
    """Find catch blocks that return default/no-op object literals."""
    catch_re = re.compile(r"catch\s*\([^)]*\)\s*\{")
    for match in catch_re.finditer(ctx.content):
        body = _extract_block_body(ctx.content, match.end() - 1, _MAX_CATCH_BODY)
        if body is None:
            continue

        return_obj = re.search(r"\breturn\s*\{", body)
        if not return_obj:
            continue

        obj_start = body.find("{", return_obj.start())
        obj_content = _extract_block_body(body, obj_start)
        if obj_content is None:
            continue

        noop_count = len(re.findall(r"\(\)\s*=>\s*\{\s*\}", obj_content))
        false_count = len(re.findall(r":\s*(?:false|null|undefined|0|''|\"\")\b", obj_content))
        if noop_count + false_count >= _CATCH_DEFAULT_FIELD_THRESHOLD:
            line_no, snippet = _content_line_info(ctx.content, match.start())
            _emit(smell_counts, "catch_return_default", ctx, line_no, snippet)


def _detect_dead_useeffects(ctx, smell_counts: dict[str, list[dict]]) -> None:
    """Find useEffect calls with empty/whitespace/comment-only bodies."""
    for line_no, line in enumerate(ctx.lines):
        stripped = line.strip()
        if not re.match(r"(?:React\.)?useEffect\s*\(\s*\(\s*\)\s*=>\s*\{", stripped):
            continue

        text = "\n".join(ctx.lines[line_no : line_no + 30])
        arrow_pos = text.find("=>")
        if arrow_pos == -1:
            continue
        brace_pos = text.find("{", arrow_pos)
        if brace_pos == -1:
            continue

        body = _extract_block_body(text, brace_pos)
        if body is None:
            continue

        if _strip_ts_comments(body).strip() == "":
            _emit(smell_counts, "dead_useeffect", ctx, line_no + 1, stripped[:100])


def _detect_swallowed_errors(ctx, smell_counts: dict[str, list[dict]]) -> None:
    """Find catch blocks whose only content is console.error/warn/log."""
    catch_re = re.compile(r"catch\s*\([^)]*\)\s*\{")
    for match in catch_re.finditer(ctx.content):
        body = _extract_block_body(ctx.content, match.end() - 1, 500)
        if body is None:
            continue

        body_clean = _strip_ts_comments(body).strip()
        if not body_clean:
            continue

        statements = [
            stmt.strip().rstrip(";")
            for stmt in re.split(r"[;\n]", body_clean)
            if stmt.strip()
        ]
        if not statements:
            continue

        all_console = all(
            re.match(r"console\.(error|warn|log)\s*\(", stmt) for stmt in statements
        )
        if all_console:
            line_no, snippet = _content_line_info(ctx.content, match.start())
            _emit(smell_counts, "swallowed_error", ctx, line_no, snippet)


def _detect_switch_no_default(ctx, smell_counts: dict[str, list[dict]]) -> None:
    """Flag switch statements that have no default case."""
    switch_re = re.compile(r"\bswitch\s*\([^)]*\)\s*\{")
    for match in switch_re.finditer(ctx.content):
        body = _extract_block_body(ctx.content, match.end() - 1, _MAX_SWITCH_BODY_SCAN)
        if body is None:
            continue

        case_count = len(re.findall(r"\bcase\s+", body))
        if case_count < _SWITCH_CASE_MINIMUM:
            continue
        if re.search(r"\bdefault\s*:", body):
            continue

        line_no, snippet = _content_line_info(ctx.content, match.start())
        _emit(smell_counts, "switch_no_default", ctx, line_no, snippet)


def _detect_window_globals(ctx, smell_counts: dict[str, list[dict]]) -> None:
    """Find ``window.__*`` assignments used as global escape hatches."""
    window_re = re.compile(
        r"""(?:"""
        r"""\(?\s*window\s+as\s+any\s*\)?\s*\.\s*(?:__\w+)"""
        r"""|window\s*\.\s*(?:__\w+)"""
        r"""|window\s*\[\s*['\"](?:__\w+)['\"]\s*\]"""
        r""")\s*=""",
    )
    for index, line in enumerate(ctx.lines):
        if index in ctx.line_state:
            continue
        match = window_re.search(line)
        if not match:
            continue
        if _ts_match_is_in_string(line, match.start()):
            continue
        _emit(smell_counts, "window_global", ctx, index + 1, line.strip()[:100])


__all__ = [
    "_detect_catch_return_default",
    "_detect_dead_useeffects",
    "_detect_swallowed_errors",
    "_detect_switch_no_default",
    "_detect_window_globals",
]
