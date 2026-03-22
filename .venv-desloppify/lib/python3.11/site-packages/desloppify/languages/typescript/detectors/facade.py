"""TypeScript facade detection helpers."""

from __future__ import annotations

import re
from pathlib import Path

from desloppify.languages._framework.facade_common import detect_reexport_facades_common


def is_ts_facade(filepath: str) -> dict | None:
    """Check if a TypeScript file is a pure re-export facade."""
    try:
        content = Path(filepath).read_text()
        lines = content.splitlines()
    except (OSError, UnicodeDecodeError):
        return None

    if not lines:
        return None

    imports_from: list[str] = []
    export_re = re.compile(r"""^export\s+(?:\{[^}]*\}|\*)\s+from\s+['"]([^'"]+)['"]""")
    reexport_re = re.compile(
        r"""^export\s+(?:type\s+)?\{[^}]*\}\s+from\s+['"]([^'"]+)['"]"""
    )

    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("//") or stripped.startswith("/*"):
            continue

        m = export_re.match(stripped) or reexport_re.match(stripped)
        if m:
            imports_from.append(m.group(1))
            continue

        return None

    if not imports_from:
        return None

    return {"imports_from": imports_from, "loc": len(lines)}


def detect_reexport_facades(
    graph: dict,
) -> tuple[list[dict], int]:
    """Detect TypeScript re-export facade files."""
    entries, total_checked = detect_reexport_facades_common(
        graph,
        is_facade_fn=is_ts_facade,
    )

    return sorted(
        entries, key=lambda e: (e["kind"], e["importers"], -e["loc"])
    ), total_checked
