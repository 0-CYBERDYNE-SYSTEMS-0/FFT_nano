"""Shared TypeScript plugin contract values.

This module is the single source of truth for configuration values used by
both the language config surface and command wiring.
"""

from __future__ import annotations

TS_EXTENSIONS = [".ts", ".tsx"]
TS_EXCLUSIONS = ["node_modules", ".d.ts"]
TS_DEFAULT_SRC = "src"
TS_ENTRY_PATTERNS = [
    "/pages/",
    "/main.tsx",
    "/main.ts",
    "/App.tsx",
    "vite.config",
    "tailwind.config",
    "postcss.config",
    ".d.ts",
    "/settings.ts",
    "/__tests__/",
    ".test.",
    ".spec.",
    ".stories.",
]
TS_BARREL_NAMES = {"index.ts", "index.tsx"}
TS_LARGE_THRESHOLD = 500
TS_COMPLEXITY_THRESHOLD = 15

__all__ = [
    "TS_BARREL_NAMES",
    "TS_COMPLEXITY_THRESHOLD",
    "TS_DEFAULT_SRC",
    "TS_ENTRY_PATTERNS",
    "TS_EXCLUSIONS",
    "TS_EXTENSIONS",
    "TS_LARGE_THRESHOLD",
]
