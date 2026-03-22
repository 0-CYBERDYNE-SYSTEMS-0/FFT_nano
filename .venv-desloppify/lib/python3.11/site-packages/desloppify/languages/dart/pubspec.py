"""Shared Dart pubspec helpers."""

from __future__ import annotations

import re
from pathlib import Path

PUBSPEC_NAME_RE = re.compile(r"(?m)^\s*name\s*:\s*([A-Za-z_][\w-]*)\s*$")


def read_package_name(project_root: Path) -> str | None:
    """Read package name from ``pubspec.yaml`` if present."""
    pubspec = project_root / "pubspec.yaml"
    if not pubspec.is_file():
        return None
    try:
        content = pubspec.read_text(errors="replace")
    except OSError:
        return None
    match = PUBSPEC_NAME_RE.search(content)
    return match.group(1) if match else None


__all__ = ["PUBSPEC_NAME_RE", "read_package_name"]
