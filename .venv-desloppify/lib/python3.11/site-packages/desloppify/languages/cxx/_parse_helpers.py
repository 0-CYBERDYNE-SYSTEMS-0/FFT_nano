"""Local parsing helpers for C/C++ extractor routines."""

from __future__ import annotations


def find_matching_brace(content: str, open_pos: int) -> int | None:
    """Return index of matching '}' for a '{' at ``open_pos``."""
    depth = 0
    in_string: str | None = None
    escape = False
    for i in range(open_pos, len(content)):
        ch = content[i]
        if in_string:
            if escape:
                escape = False
                continue
            if ch == "\\":
                escape = True
                continue
            if ch == in_string:
                in_string = None
            continue
        if ch in ("'", '"'):
            in_string = ch
            continue
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return i
    return None


__all__ = ["find_matching_brace"]
