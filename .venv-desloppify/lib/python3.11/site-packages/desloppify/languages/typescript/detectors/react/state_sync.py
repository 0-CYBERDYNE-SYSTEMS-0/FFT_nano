"""React useState/useEffect state-sync anti-pattern detector."""

from __future__ import annotations

import logging
import re
from pathlib import Path

from desloppify.base.discovery.paths import get_project_root
from desloppify.base.discovery.source import find_tsx_files
from desloppify.languages.typescript.detectors.smells.helpers import (
    _strip_ts_comments,
    scan_code,
)

MAX_EFFECT_BODY = 1000
logger = logging.getLogger(__name__)


def detect_state_sync(path: Path) -> tuple[list[dict], int]:
    """Find useEffect blocks whose only statements are useState setter calls."""
    entries = []
    total_effects = 0

    for filepath in find_tsx_files(path):
        try:
            p = Path(filepath) if Path(filepath).is_absolute() else get_project_root() / filepath
            content = p.read_text()
            lines = content.splitlines()
        except (OSError, UnicodeDecodeError) as exc:
            logger.debug("Skipping unreadable TSX file %s in state-sync pass: %s", filepath, exc)
            continue

        setters = {m.group(1) for m in re.finditer(r"const\s+\[\w+,\s*(set\w+)\]\s*=\s*useState", content)}
        if not setters:
            continue

        total_effects += len(re.findall(r"useEffect\s*\(", content))
        effect_re = re.compile(r"useEffect\s*\(\s*\(\s*\)\s*=>\s*\{")
        for match in effect_re.finditer(content):
            brace_start = match.end() - 1
            depth = 0
            body_end = None
            for ci, ch, in_s in scan_code(
                content,
                brace_start,
                min(brace_start + MAX_EFFECT_BODY, len(content)),
            ):
                if in_s:
                    continue
                if ch == "{":
                    depth += 1
                elif ch == "}":
                    depth -= 1
                    if depth == 0:
                        body_end = ci
                        break
            if body_end is None:
                continue

            body = content[brace_start + 1 : body_end]
            body_clean = _strip_ts_comments(body).strip()
            if not body_clean:
                continue

            statements = [
                s.strip().rstrip(";")
                for s in re.split(r"[;\n]", body_clean)
                if s.strip()
            ]
            if not statements:
                continue

            matched_setters = set()
            all_setters = True
            for stmt in statements:
                found = False
                for setter in setters:
                    if stmt.startswith(setter + "("):
                        found = True
                        matched_setters.add(setter)
                        break
                if not found:
                    all_setters = False
                    break

            if all_setters and matched_setters:
                line_no = content[: match.start()].count("\n") + 1
                entries.append(
                    {
                        "file": filepath,
                        "line": line_no,
                        "setters": sorted(matched_setters),
                        "content": lines[line_no - 1].strip()[:100] if line_no <= len(lines) else "",
                    }
                )

    return entries, total_effects


__all__ = ["MAX_EFFECT_BODY", "detect_state_sync"]
