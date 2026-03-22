"""Small syntax helpers reused by TypeScript fixers."""

from __future__ import annotations

from desloppify.languages.typescript.detectors.smells.helpers import scan_code

_CHAR_DEPTH_DELTA: dict[str, tuple[str, int]] = {
    "(": ("parens", 1),
    ")": ("parens", -1),
    "{": ("braces", 1),
    "}": ("braces", -1),
    "[": ("brackets", 1),
    "]": ("brackets", -1),
}


def find_balanced_end(
    lines: list[str], start: int, *, track: str = "parens", max_lines: int = 80
) -> int | None:
    """Find the line where brackets opened at *start* balance to zero."""
    depths = {"parens": 0, "braces": 0, "brackets": 0}
    for idx in range(start, min(start + max_lines, len(lines))):
        for _, ch, in_s in scan_code(lines[idx]):
            if in_s:
                continue
            delta_spec = _CHAR_DEPTH_DELTA.get(ch)
            if delta_spec is None:
                continue
            key, delta = delta_spec
            depths[key] += delta
            if delta > 0:
                continue
            if track == "parens" and key == "parens" and depths["parens"] <= 0:
                return idx
            if track == "braces" and key == "braces" and depths["braces"] <= 0:
                return idx
            if track == "all" and key == "parens" and depths["parens"] <= 0:
                return idx
    return None


def extract_body_between_braces(text: str, search_after: str = "") -> str | None:
    """Extract content between the first ``{`` and its matching ``}``."""
    start_pos = 0
    if search_after:
        pos = text.find(search_after)
        if pos == -1:
            return None
        start_pos = pos + len(search_after)

    brace_pos = text.find("{", start_pos)
    if brace_pos == -1:
        return None

    depth = 0
    for i, ch, in_s in scan_code(text, brace_pos):
        if in_s:
            continue
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return text[brace_pos + 1 : i]
    return None


def collapse_blank_lines(
    lines: list[str], removed_indices: set[int] | None = None
) -> list[str]:
    """Filter removed lines and collapse repeated blank lines."""
    result = []
    prev_blank = False
    for idx, line in enumerate(lines):
        if removed_indices and idx in removed_indices:
            continue
        is_blank = line.strip() == ""
        if is_blank and prev_blank:
            continue
        result.append(line)
        prev_blank = is_blank
    return result


__all__ = [
    "collapse_blank_lines",
    "extract_body_between_braces",
    "find_balanced_end",
]
