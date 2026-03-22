"""Shared TypeScript detector file-boundary adapters."""

from __future__ import annotations

from pathlib import Path

from desloppify.base.discovery.paths import get_project_root
from desloppify.base.discovery.source import find_ts_and_tsx_files
from desloppify.languages.typescript.plugin_contract import TS_EXCLUSIONS


def should_skip_typescript_source(filepath: str) -> bool:
    """Return True when detector logic should skip this TypeScript path."""
    normalized = filepath.replace("\\", "/")
    for token in TS_EXCLUSIONS:
        if token.startswith("."):
            if normalized.endswith(token):
                return True
            continue
        if token in normalized:
            return True
    return False


def iter_typescript_sources(path: Path) -> list[str]:
    """Return normalized source candidates for TypeScript detectors."""
    return [
        filepath
        for filepath in find_ts_and_tsx_files(path)
        if not should_skip_typescript_source(filepath)
    ]


def resolve_typescript_source(filepath: str) -> Path:
    """Resolve a candidate file path to an absolute filesystem path."""
    if Path(filepath).is_absolute():
        return Path(filepath)
    return get_project_root() / filepath


__all__ = [
    "iter_typescript_sources",
    "resolve_typescript_source",
    "should_skip_typescript_source",
]
