"""Catalog metadata for TypeScript smell checks."""

from __future__ import annotations

TS_SMELL_CHECKS = [
    {
        "id": "empty_catch",
        "label": "Empty catch blocks",
        "pattern": r"catch\s*\([^)]*\)\s*\{\s*\}",
        "severity": "high",
    },
    {
        "id": "any_type",
        "label": "Explicit `any` types",
        "pattern": r":\s*any\b|<\s*any\b|,\s*any\b(?=\s*(?:,|>))",
        "severity": "medium",
    },
    {
        "id": "ts_ignore",
        "label": "@ts-ignore / @ts-expect-error",
        "pattern": r"//\s*@ts-(?:ignore|expect-error)",
        "severity": "medium",
    },
    {
        "id": "ts_nocheck",
        "label": "@ts-nocheck disables all type checking",
        "pattern": r"^\s*//\s*@ts-nocheck",
        "severity": "high",
    },
    {
        "id": "non_null_assert",
        "label": "Non-null assertions (!.)",
        "pattern": r"\w+!\.",
        "severity": "low",
    },
    {
        "id": "hardcoded_color",
        "label": "Hardcoded color values",
        "pattern": r"""(?:color|background|border|fill|stroke)\s*[:=]\s*['"]#[0-9a-fA-F]{3,8}['"]""",
        "severity": "medium",
    },
    {
        "id": "hardcoded_rgb",
        "label": "Hardcoded rgb/rgba",
        "pattern": r"rgba?\(\s*\d+",
        "severity": "medium",
    },
    {
        "id": "async_no_await",
        "label": "Async functions without await",
        "pattern": None,
        "severity": "medium",
    },
    {
        "id": "magic_number",
        "label": "Magic numbers (>1000 in logic)",
        "pattern": r"(?:===?|!==?|>=?|<=?|[+\-*/])\s*\d{4,}",
        "severity": "low",
    },
    {
        "id": "console_error_no_throw",
        "label": "console.error without throw/return",
        "pattern": None,
        "severity": "medium",
    },
    {
        "id": "empty_if_chain",
        "label": "Empty if/else chains",
        "pattern": None,
        "severity": "high",
    },
    {
        "id": "dead_useeffect",
        "label": "useEffect with empty body",
        "pattern": None,
        "severity": "high",
    },
    {
        "id": "swallowed_error",
        "label": "Catch blocks that only log (swallowed errors)",
        "pattern": None,
        "severity": "medium",
    },
    {
        "id": "hardcoded_url",
        "label": "Hardcoded URL in source code",
        "pattern": r"""(?:['\"])https?://[^\s'\"]+(?:['\"])""",
        "severity": "medium",
    },
    {
        "id": "todo_fixme",
        "label": "TODO/FIXME/HACK comments",
        "pattern": r"//\s*(?:TODO|FIXME|HACK|XXX)",
        "severity": "low",
    },
    {
        "id": "debug_tag",
        "label": "Vestigial debug tag in log/print",
        "pattern": r"""(?:['"`])\[([A-Z][A-Z0-9_]{2,})\]\s""",
        "severity": "low",
    },
    {
        "id": "monster_function",
        "label": "Monster function (>150 LOC)",
        "pattern": None,
        "severity": "high",
    },
    {
        "id": "stub_function",
        "label": "Stub function (body is empty/return-only)",
        "pattern": None,
        "severity": "low",
    },
    {
        "id": "voided_symbol",
        "label": "Dead internal code (void-suppressed unused symbol)",
        "pattern": r"^\s*void\s+[a-zA-Z_]\w*\s*;?\s*$",
        "severity": "medium",
    },
    {
        "id": "window_global",
        "label": "Window global escape hatch (window.__*)",
        "pattern": None,
        "severity": "medium",
    },
    {
        "id": "workaround_tag",
        "label": "Workaround tag in comment ([PascalCaseTag])",
        "pattern": r"//.*\[([A-Z][a-z]+(?:[A-Z][a-z]+)+)\]",
        "severity": "low",
    },
    {
        "id": "catch_return_default",
        "label": "Catch block returns default object (silent failure)",
        "pattern": None,
        "severity": "high",
    },
    {
        "id": "as_any_cast",
        "label": "`as any` type casts",
        "pattern": r"\bas\s+any\b",
        "severity": "medium",
    },
    {
        "id": "sort_no_comparator",
        "label": ".sort() without comparator function",
        "pattern": r"\.sort\(\s*\)",
        "severity": "medium",
    },
    {
        "id": "switch_no_default",
        "label": "Switch without default case",
        "pattern": None,
        "severity": "low",
    },
    {
        "id": "nested_closure",
        "label": "Deeply nested closures — extract to module level",
        "pattern": None,
        "severity": "medium",
    },
    {
        "id": "high_cyclomatic_complexity",
        "label": "High cyclomatic complexity (>15 branches)",
        "pattern": None,
        "severity": "medium",
    },
    {
        "id": "css_monolith",
        "label": "Large stylesheet file (300+ LOC)",
        "pattern": None,
        "severity": "medium",
    },
    {
        "id": "css_important_overuse",
        "label": "Heavy !important usage in stylesheet",
        "pattern": None,
        "severity": "low",
    },
    {
        "id": "docs_scripts_drift",
        "label": "README missing key package scripts",
        "pattern": None,
        "severity": "low",
    },
]

SEVERITY_ORDER = {"high": 0, "medium": 1, "low": 2}

__all__ = ["SEVERITY_ORDER", "TS_SMELL_CHECKS"]
