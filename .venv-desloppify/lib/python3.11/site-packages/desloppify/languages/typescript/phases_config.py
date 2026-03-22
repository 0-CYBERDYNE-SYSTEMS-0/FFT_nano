"""Shared TypeScript phase configuration values."""

from __future__ import annotations

import re

from desloppify.engine.detectors.base import ComplexitySignal, GodRule


def _compute_ts_destructure_props(content, lines):
    long_destructures = re.findall(r"\{\s*(\w+(?:\s*,\s*\w+){8,})\s*\}", content)
    if not long_destructures:
        return None
    max_props = max(len(d.split(",")) for d in long_destructures)
    return max_props, f"destructure w/{max_props} props"


def _compute_ts_inline_types(content, lines):
    inline_types = len(
        re.findall(r"^(?:export\s+)?(?:type|interface)\s+\w+", content, re.MULTILINE)
    )
    if inline_types > 3:
        return inline_types, f"{inline_types} inline types"
    return None


TS_COMPLEXITY_SIGNALS = [
    ComplexitySignal("imports", r"^import\s", weight=1, threshold=15),
    ComplexitySignal(
        "destructured props",
        None,
        weight=1,
        threshold=8,
        compute=_compute_ts_destructure_props,
    ),
    ComplexitySignal("useEffects", r"useEffect\s*\(", weight=3, threshold=3),
    ComplexitySignal(
        "inline types", None, weight=1, threshold=3, compute=_compute_ts_inline_types
    ),
    ComplexitySignal("TODOs", r"//\s*(?:TODO|FIXME|HACK|XXX)", weight=2, threshold=0),
    ComplexitySignal(
        "nested ternaries", r"[^?]\?[^?.:\n][^:\n]*[^?]\?[^?.]", weight=3, threshold=2
    ),
    ComplexitySignal("useRefs", r"\buseRef\s*[<(]", weight=2, threshold=6),
]

TS_GOD_RULES = [
    GodRule("context_hooks", "context hooks", lambda c: c.metrics.get("context_hooks", 0), 3),
    GodRule("use_effects", "useEffects", lambda c: c.metrics.get("use_effects", 0), 4),
    GodRule("use_states", "useStates", lambda c: c.metrics.get("use_states", 0), 5),
    GodRule("custom_hooks", "custom hooks", lambda c: c.metrics.get("custom_hooks", 0), 8),
    GodRule("hook_total", "total hooks", lambda c: c.metrics.get("hook_total", 0), 10),
]

TS_SKIP_NAMES = {
    "index.ts",
    "index.tsx",
    "types.ts",
    "types.tsx",
    "constants.ts",
    "constants.tsx",
    "utils.ts",
    "utils.tsx",
    "helpers.ts",
    "helpers.tsx",
    "settings.ts",
    "settings.tsx",
    "main.ts",
    "main.tsx",
    "App.tsx",
    "vite-env.d.ts",
}

TS_SKIP_DIRS = {"src/shared/components/ui"}


__all__ = [
    "TS_COMPLEXITY_SIGNALS",
    "TS_GOD_RULES",
    "TS_SKIP_DIRS",
    "TS_SKIP_NAMES",
]
