"""Fixer registry assembly for Rust."""

from __future__ import annotations

from pathlib import Path

from desloppify.base.discovery.file_paths import rel, resolve_path, safe_write_text
from desloppify.languages._framework.base.types import FixResult, FixerConfig
from desloppify.languages.rust.detectors.api import (
    detect_import_hygiene,
    replace_same_crate_imports,
)
from desloppify.languages.rust.detectors.cargo_policy import (
    add_missing_features_to_manifest,
    detect_doctest_hygiene,
    detect_feature_hygiene,
    ensure_readme_doctest_harness,
)


def _detect_crate_imports(path: Path) -> list[dict]:
    return detect_import_hygiene(path)[0]


def _detect_missing_features(path: Path) -> list[dict]:
    return detect_feature_hygiene(path)[0]


def _detect_missing_readme_doctests(path: Path) -> list[dict]:
    return detect_doctest_hygiene(path)[0]


def fix_crate_imports(entries: list[dict], *, dry_run: bool = False) -> FixResult:
    """Rewrite same-crate imports to `crate::...`."""
    results: list[dict] = []
    seen_files: set[str] = set()
    for entry in entries:
        filepath = entry["file"]
        if filepath in seen_files:
            continue
        seen_files.add(filepath)
        updated, replacements = replace_same_crate_imports(filepath)
        if replacements == 0:
            continue
        absolute = Path(resolve_path(filepath))
        if not dry_run:
            safe_write_text(absolute, updated)
        results.append(
            {
                "file": rel(absolute),
                "removed": [
                    candidate["name"]
                    for candidate in entries
                    if candidate["file"] == filepath
                ],
                "lines_removed": replacements,
            }
        )
    return FixResult(entries=results)


def fix_missing_features(entries: list[dict], *, dry_run: bool = False) -> FixResult:
    """Add missing `[features]` declarations to Cargo.toml."""
    grouped: dict[str, set[str]] = {}
    for entry in entries:
        detail = entry.get("detail", {})
        manifest = detail.get("manifest", entry["file"])
        feature = detail.get("feature")
        if feature:
            grouped.setdefault(manifest, set()).add(feature)

    results: list[dict] = []
    for manifest, features in grouped.items():
        absolute = Path(resolve_path(manifest))
        updated = add_missing_features_to_manifest(manifest, sorted(features))
        if not dry_run:
            safe_write_text(absolute, updated)
        results.append(
            {
                "file": rel(absolute),
                "removed": [
                    entry["name"] for entry in entries if entry.get("detail", {}).get("manifest") == manifest
                ],
                "lines_removed": len(features),
            }
        )
    return FixResult(entries=results)


def fix_readme_doctests(entries: list[dict], *, dry_run: bool = False) -> FixResult:
    """Append README doctest harnesses to `src/lib.rs` files."""
    results: list[dict] = []
    seen_files: set[str] = set()
    for entry in entries:
        filepath = entry["file"]
        if filepath in seen_files:
            continue
        seen_files.add(filepath)
        absolute = Path(resolve_path(filepath))
        updated = ensure_readme_doctest_harness(filepath)
        current = absolute.read_text(errors="replace")
        if updated == current:
            continue
        if not dry_run:
            safe_write_text(absolute, updated)
        results.append(
            {
                "file": rel(absolute),
                "removed": [
                    candidate["name"]
                    for candidate in entries
                    if candidate["file"] == filepath
                ],
                "lines_removed": 3,
            }
        )
    return FixResult(entries=results)


def get_rust_fixers() -> dict[str, FixerConfig]:
    """Build the Rust fixer registry."""
    return {
        "crate-imports": FixerConfig(
            "same-crate imports",
            _detect_crate_imports,
            fix_crate_imports,
            "rust_import_hygiene",
            "Rewrote",
            "Would rewrite",
        ),
        "cargo-features": FixerConfig(
            "missing Cargo features",
            _detect_missing_features,
            fix_missing_features,
            "rust_feature_hygiene",
            "Added",
            "Would add",
        ),
        "readme-doctests": FixerConfig(
            "README doctest harnesses",
            _detect_missing_readme_doctests,
            fix_readme_doctests,
            "rust_doctest",
            "Added",
            "Would add",
        ),
    }


__all__ = [
    "fix_crate_imports",
    "fix_missing_features",
    "fix_readme_doctests",
    "get_rust_fixers",
]
