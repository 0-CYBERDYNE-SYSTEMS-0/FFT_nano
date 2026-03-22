"""Shared regex patterns for GDScript source parsing."""

from __future__ import annotations

import re

LOAD_PATH_RE = re.compile(
    r"""(?:preload|load)\(\s*['"](?P<path>res://[^'"]+\.gd)['"]\s*\)"""
)
EXTENDS_RE = re.compile(r"""(?m)^\s*extends\s+['"](?P<path>res://[^'"]+\.gd)['"]""")

__all__ = ["EXTENDS_RE", "LOAD_PATH_RE"]
