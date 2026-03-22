"""React Context provider nesting detector."""

from __future__ import annotations

import logging
import re
from pathlib import Path

from desloppify.base.discovery.paths import get_project_root
from desloppify.base.discovery.source import find_tsx_files

logger = logging.getLogger(__name__)


def detect_context_nesting(path: Path) -> tuple[list[dict], int]:
    """Find deeply nested React Context provider trees (>5 levels in one file)."""
    entries = []
    total_files = 0
    provider_open = re.compile(r"<(\w+Provider)\b(?!.*/>)")
    provider_close = re.compile(r"</(\w+Provider)\s*>")

    for filepath in find_tsx_files(path):
        total_files += 1
        try:
            p = Path(filepath) if Path(filepath).is_absolute() else get_project_root() / filepath
            content = p.read_text()
            lines = content.splitlines()
        except (OSError, UnicodeDecodeError) as exc:
            logger.debug(
                "Skipping unreadable TSX file %s in context-nesting pass: %s",
                filepath,
                exc,
            )
            continue

        depth = 0
        max_depth = 0
        providers_at_max: list[str] = []
        provider_stack: list[str] = []

        for line in lines:
            for match in provider_open.finditer(line):
                depth += 1
                provider_stack.append(match.group(1))
                if depth > max_depth:
                    max_depth = depth
                    providers_at_max = list(provider_stack)

            for match in provider_close.finditer(line):
                if provider_stack and provider_stack[-1] == match.group(1):
                    provider_stack.pop()
                    depth -= 1

        if max_depth > 5:
            entries.append({"file": filepath, "depth": max_depth, "providers": providers_at_max})

    return sorted(entries, key=lambda e: -e["depth"]), total_files


__all__ = ["detect_context_nesting"]
