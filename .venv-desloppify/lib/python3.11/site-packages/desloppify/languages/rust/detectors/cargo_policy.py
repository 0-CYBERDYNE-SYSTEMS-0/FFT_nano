"""Rust manifest and doctest policy detectors."""

from __future__ import annotations

from pathlib import Path

from desloppify.base.discovery.file_paths import rel, resolve_path
from desloppify.languages.rust.support import find_rust_files, read_text_or_none, strip_rust_comments

from ._shared import (
    _FEATURE_REF_RE,
    _README_RUST_FENCE_RE,
    _declared_features,
    _entry,
    _group_files_by_manifest,
    _has_inline_rust_doc_examples,
    _has_readme_doctest_harness,
    _line_number,
)


def detect_feature_hygiene(path: Path) -> tuple[list[dict], int]:
    """Flag referenced cfg features that are missing from Cargo.toml."""
    entries: list[dict] = []
    by_manifest = _group_files_by_manifest(path)
    for manifest_dir, files in by_manifest.items():
        manifest_path = manifest_dir / "Cargo.toml"
        declared = _declared_features(manifest_path)
        seen: set[str] = set()
        for filepath in files:
            absolute = Path(resolve_path(filepath))
            content = read_text_or_none(absolute)
            if content is None:
                continue
            stripped = strip_rust_comments(content, preserve_lines=True)
            for match in _FEATURE_REF_RE.finditer(stripped):
                feature = match.group(1).strip()
                if not feature or feature in declared or feature in seen:
                    continue
                seen.add(feature)
                entries.append(
                    _entry(
                        manifest_path,
                        line=1,
                        name=feature,
                        summary=(
                            f"Feature `{feature}` is referenced in Rust cfgs but not declared in Cargo.toml"
                        ),
                        tier=2,
                        confidence="high",
                        detail=dict(
                            feature=feature,
                            manifest=rel(manifest_path),
                            source_file=rel(absolute),
                            source_line=_line_number(stripped, match.start()),
                        ),
                    )
                )
    return entries, len(find_rust_files(path))


def detect_doctest_hygiene(path: Path) -> tuple[list[dict], int]:
    """Flag library crates whose README examples are not wired into doctests."""
    entries: list[dict] = []
    by_manifest = _group_files_by_manifest(path)
    for manifest_dir in by_manifest:
        lib_rs = manifest_dir / "src" / "lib.rs"
        readme = manifest_dir / "README.md"
        if not lib_rs.is_file() or not readme.is_file():
            continue
        readme_text = read_text_or_none(readme)
        lib_text = read_text_or_none(lib_rs)
        if readme_text is None or lib_text is None:
            continue
        if not _README_RUST_FENCE_RE.search(readme_text):
            continue
        if _has_readme_doctest_harness(lib_text):
            continue
        if _has_inline_rust_doc_examples(lib_text):
            continue
        entries.append(
            _entry(
                lib_rs,
                line=1,
                name="readme_doctests",
                summary="README Rust examples are not included in crate doctests",
                tier=2,
                confidence="high",
                detail=dict(
                    manifest=rel(manifest_dir / "Cargo.toml"),
                    readme=rel(readme),
                ),
            )
        )
    return entries, len(find_rust_files(path))


def iter_missing_features(path: Path) -> dict[str, list[str]]:
    """Return manifest-relative missing feature declarations grouped by manifest."""
    entries, _ = detect_feature_hygiene(path)
    grouped: dict[str, set[str]] = {}
    for entry in entries:
        manifest = entry["detail"]["manifest"]
        grouped.setdefault(manifest, set()).add(entry["detail"]["feature"])
    return {manifest: sorted(features) for manifest, features in grouped.items()}


def missing_readme_doctest_harnesses(path: Path) -> list[str]:
    """Return library crate roots that need a README doctest harness."""
    entries, _ = detect_doctest_hygiene(path)
    return [entry["file"] for entry in entries]


def add_missing_features_to_manifest(manifest_path: str, missing_features: list[str]) -> str:
    """Insert missing feature declarations into a Cargo.toml manifest."""
    absolute = Path(resolve_path(manifest_path))
    raw = absolute.read_text(errors="replace")
    missing = [feature for feature in missing_features if feature]
    if not missing:
        return raw

    lines = raw.splitlines()
    feature_section_index = None
    for index, line in enumerate(lines):
        if line.strip() == "[features]":
            feature_section_index = index
            break

    additions = [f"{feature} = []" for feature in missing]
    if feature_section_index is None:
        suffix = "\n" if raw.endswith("\n") else "\n\n"
        block = "[features]\n" + "\n".join(additions) + "\n"
        return raw + suffix + block

    insert_at = len(lines)
    for index in range(feature_section_index + 1, len(lines)):
        stripped = lines[index].strip()
        if stripped.startswith("[") and stripped.endswith("]"):
            insert_at = index
            break
    updated = lines[:insert_at] + additions + lines[insert_at:]
    return "\n".join(updated) + ("\n" if raw.endswith("\n") or updated else "")


def ensure_readme_doctest_harness(lib_path: str) -> str:
    """Append the standard README doctest harness to `src/lib.rs` if needed."""
    absolute = Path(resolve_path(lib_path))
    content = absolute.read_text(errors="replace")
    if _has_readme_doctest_harness(content):
        return content
    snippet = (
        "\n\n#[cfg(doctest)]\n"
        "#[doc = include_str!(\"../README.md\")]\n"
        "mod readme_doctests {}\n"
    )
    return content.rstrip() + snippet


__all__ = [
    "add_missing_features_to_manifest",
    "detect_doctest_hygiene",
    "detect_feature_hygiene",
    "ensure_readme_doctest_harness",
    "iter_missing_features",
    "missing_readme_doctest_harnesses",
]
