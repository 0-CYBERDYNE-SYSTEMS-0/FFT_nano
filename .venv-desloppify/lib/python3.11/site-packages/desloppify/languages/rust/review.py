"""Rust-specific review heuristics and guidance."""

from __future__ import annotations

import re

from desloppify.languages.rust.support import USE_STATEMENT_RE

HOLISTIC_REVIEW_DIMENSIONS: list[str] = [
    "cross_module_architecture",
    "error_consistency",
    "abstraction_fitness",
    "test_strategy",
    "api_surface_coherence",
    "design_coherence",
]

REVIEW_GUIDANCE = {
    "patterns": [
        "Prefer explicit crate/module boundaries over broad prelude-style re-exports.",
        "Use domain-specific error types in library code; keep `anyhow` at application boundaries.",
        "Check trait abstractions for real leverage instead of one-implementation indirection.",
        "Watch for `unwrap`, `expect`, `panic!`, `todo!`, and `unimplemented!` in production paths.",
        "Ensure public structs/traits are documented and future-proofed against breaking changes.",
    ],
    "auth": [
        "Audit CLI/server entrypoints for permission checks before mutating external state.",
        "Check secret-bearing environment variables and token handling for accidental logging.",
    ],
    "naming": (
        "Rust public APIs should use idiomatic names: `as_*/to_*/into_*`, clear getter "
        "and iterator naming, and trait impls that match standard-library expectations."
    ),
}

MIGRATION_PATTERN_PAIRS = [
    (
        "thiserror→anyhow boundary drift",
        re.compile(r"\bthiserror::Error\b"),
        re.compile(r"\banyhow::(?:Error|Result|Context)\b"),
    ),
]

MIGRATION_MIXED_EXTENSIONS: set[str] = set()

LOW_VALUE_PATTERN = re.compile(
    r"(?m)^\s*(?:#!\[(?:allow|cfg_attr)|mod\s+tests\s*\{|use\s+super::\*)"
)

_PUB_TYPE_RE = re.compile(
    r"(?m)^\s*pub\s+(?:struct|enum|trait|type)\s+([A-Za-z_]\w*)"
)
_PUB_FN_RE = re.compile(r"(?m)^\s*pub\s+(?:async\s+)?fn\s+([A-Za-z_]\w*)\s*\(")
_IMPL_RE = re.compile(r"(?m)^\s*impl(?:<[^>]+>)?\s+([A-Za-z_]\w*)\s+for\s+([A-Za-z_]\w*)")


def module_patterns(content: str) -> list[str]:
    """Return Rust-specific review markers for a file."""
    stripped = content
    out: list[str] = []
    if USE_STATEMENT_RE.search(stripped):
        out.append("use_declarations")
    if re.search(r"(?m)^\s*pub(?:\([^)]*\))?\s+trait\s+", stripped):
        out.append("public_traits")
    if re.search(r"(?m)^\s*impl(?:<[^>]+>)?\s+(?:From|TryFrom|Into|Iterator)\b", stripped):
        out.append("std_trait_impls")
    if re.search(r"\b(?:unwrap|expect|panic!|todo!|unimplemented!)", stripped):
        out.append("panic_paths")
    return out


def api_surface(file_contents: dict[str, str]) -> dict[str, list[str]]:
    """Summarize public Rust API shape across scanned files."""
    public_types: set[str] = set()
    public_functions: set[str] = set()
    trait_impls: set[str] = set()

    for content in file_contents.values():
        for match in _PUB_TYPE_RE.finditer(content):
            public_types.add(match.group(1))
        for match in _PUB_FN_RE.finditer(content):
            public_functions.add(match.group(1))
        for match in _IMPL_RE.finditer(content):
            trait_impls.add(f"{match.group(2)}::{match.group(1)}")

    return {
        "public_types": sorted(public_types),
        "public_functions": sorted(public_functions),
        "trait_impls": sorted(trait_impls),
    }


__all__ = [
    "HOLISTIC_REVIEW_DIMENSIONS",
    "LOW_VALUE_PATTERN",
    "MIGRATION_MIXED_EXTENSIONS",
    "MIGRATION_PATTERN_PAIRS",
    "REVIEW_GUIDANCE",
    "api_surface",
    "module_patterns",
]
