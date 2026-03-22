"""React custom-hook return-shape and boolean-state detectors."""

from __future__ import annotations

import logging
import re
from pathlib import Path

from desloppify.base.discovery.paths import get_project_root
from desloppify.base.discovery.source import find_tsx_files
from desloppify.languages.typescript.detectors.smells.helpers import scan_code

MAX_FUNC_SCAN = 2000
logger = logging.getLogger(__name__)


def detect_hook_return_bloat(path: Path) -> tuple[list[dict], int]:
    """Find custom hooks returning objects with too many fields (>12)."""
    entries = []
    total_hooks = 0
    hook_re = re.compile(r"(?:export\s+)?(?:function|const)\s+(use[A-Z]\w*)")

    for filepath in find_tsx_files(path):
        try:
            p = Path(filepath) if Path(filepath).is_absolute() else get_project_root() / filepath
            content = p.read_text()
            lines = content.splitlines()
        except (OSError, UnicodeDecodeError) as exc:
            logger.debug("Skipping unreadable TSX file %s in hook-bloat pass: %s", filepath, exc)
            continue

        for match in hook_re.finditer(content):
            hook_name = match.group(1)
            total_hooks += 1
            hook_start = content[: match.start()].count("\n")

            brace_line = None
            for idx in range(hook_start, min(hook_start + 5, len(lines))):
                if "{" in lines[idx]:
                    brace_line = idx
                    break
            if brace_line is None:
                continue

            depth = 0
            found_open = False
            func_end = None
            for line_idx in range(brace_line, min(brace_line + MAX_FUNC_SCAN, len(lines))):
                for _, ch, in_s in scan_code(lines[line_idx]):
                    if in_s:
                        continue
                    if ch == "{":
                        depth += 1
                        found_open = True
                    elif ch == "}":
                        depth -= 1
                        if found_open and depth == 0:
                            func_end = line_idx
                            break
                if func_end is not None:
                    break
            if func_end is None:
                continue

            func_body = "\n".join(lines[brace_line : func_end + 1])
            field_count = _count_return_fields(func_body)
            if field_count is not None and field_count > 12:
                entries.append(
                    {
                        "file": filepath,
                        "line": hook_start + 1,
                        "hook": hook_name,
                        "field_count": field_count,
                    }
                )

    return sorted(entries, key=lambda e: -e["field_count"]), total_hooks


def _count_return_fields(func_body: str) -> int | None:
    """Count fields in the last top-level ``return { ... }`` object."""
    lines = func_body.splitlines()
    depth = 0
    return_positions: list[int] = []

    for i, line in enumerate(lines):
        pre_depth = depth
        for _, ch, in_s in scan_code(line):
            if in_s:
                continue
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1

        stripped = line.strip()
        if pre_depth == 1 and stripped.startswith("return") and "{" in stripped:
            return_positions.append(i)

    if not return_positions:
        return None

    return_line = return_positions[-1]
    ret_text = "\n".join(lines[return_line:])
    brace_start = ret_text.find("{")
    if brace_start == -1:
        return None

    obj_depth = 0
    field_count = 0
    started = False

    for _, ch, in_s in scan_code(ret_text, brace_start):
        if in_s:
            continue
        if ch == "{":
            obj_depth += 1
            started = True
        elif ch == "}":
            obj_depth -= 1
            if started and obj_depth == 0:
                break
        elif ch == "," and obj_depth == 1:
            field_count += 1

    if field_count > 0:
        field_count += 1
    else:
        obj_content = ""
        d = 0
        for ch in ret_text[brace_start:]:
            if ch == "{":
                d += 1
            elif ch == "}":
                d -= 1
                if d == 0:
                    break
            elif d == 1:
                obj_content += ch
        if obj_content.strip():
            field_count = 1

    return field_count


def detect_boolean_state_explosion(path: Path) -> tuple[list[dict], int]:
    """Find components with 3+ boolean useState hooks suggesting state explosion."""
    entries = []
    total_components = 0
    bool_state_re = re.compile(
        r"const\s+\[(\w+),\s*(set\w+)\]\s*=\s*useState(?:<boolean>)?\s*\(\s*false\s*\)"
    )

    for filepath in find_tsx_files(path):
        try:
            p = Path(filepath) if Path(filepath).is_absolute() else get_project_root() / filepath
            content = p.read_text()
        except (OSError, UnicodeDecodeError) as exc:
            logger.debug(
                "Skipping unreadable TSX file %s in boolean-state pass: %s",
                filepath,
                exc,
            )
            continue

        matches = list(bool_state_re.finditer(content))
        if len(matches) < 3:
            continue

        total_components += 1
        states = [
            (m.group(1), m.group(2), content[: m.start()].count("\n") + 1)
            for m in matches
        ]

        prefixes: dict[str, list[tuple]] = {}
        for state_name, setter, line in states:
            bare = setter[3:]
            for k in range(2, len(bare)):
                if bare[k].isupper():
                    prefix = "set" + bare[:k]
                    prefixes.setdefault(prefix, []).append((state_name, setter, line))
                    break

        for prefix, group in prefixes.items():
            if len(group) >= 3:
                entries.append(
                    {
                        "file": filepath,
                        "line": group[0][2],
                        "count": len(group),
                        "setters": [g[1] for g in group],
                        "states": [g[0] for g in group],
                        "prefix": prefix,
                    }
                )
                break

        if not any(e["file"] == filepath for e in entries) and len(states) >= 4:
            entries.append(
                {
                    "file": filepath,
                    "line": states[0][2],
                    "count": len(states),
                    "setters": [s[1] for s in states],
                    "states": [s[0] for s in states],
                    "prefix": "(mixed)",
                }
            )

    return sorted(entries, key=lambda e: -e["count"]), total_components


__all__ = [
    "MAX_FUNC_SCAN",
    "_count_return_fields",
    "detect_boolean_state_explosion",
    "detect_hook_return_bloat",
]
