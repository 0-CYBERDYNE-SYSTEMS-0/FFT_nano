"""Structural validation for language plugin package layout."""

from __future__ import annotations

from pathlib import Path

from desloppify.languages._framework.policy import REQUIRED_DIRS, REQUIRED_FILES


def validate_lang_structure(lang_dir: Path, name: str) -> None:
    """Validate that a language plugin has all required files and directories."""
    errors: list[str] = []

    for filename in REQUIRED_FILES:
        if not (lang_dir / filename).is_file():
            errors.append(f"missing required file: {filename}")

    for dirname in REQUIRED_DIRS:
        target = lang_dir / dirname
        if not target.is_dir():
            errors.append(f"missing required directory: {dirname}/")
            continue
        if not (target / "__init__.py").is_file():
            errors.append(f"missing {dirname}/__init__.py")
        if dirname == "tests" and not any(target.glob("test_*.py")):
            errors.append("tests directory must contain at least one test_*.py file")

    if errors:
        raise ValueError(
            f"Language plugin '{name}' ({lang_dir.name}/) has structural issues:\n"
            + "\n".join(f"  - {e}" for e in errors)
        )
