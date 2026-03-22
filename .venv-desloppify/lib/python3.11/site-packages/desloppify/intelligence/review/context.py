"""Context building for review: ReviewContext, shared helpers, heuristic signals."""

from __future__ import annotations

from collections.abc import Mapping
from pathlib import Path
from typing import Any

from desloppify.base.discovery.file_paths import rel, resolve_path
from desloppify.base.discovery.source import (
    disable_file_cache,
    enable_file_cache,
    is_file_cache_enabled,
    read_file_text,
)
from desloppify.engine._state.schema import StateModel
from desloppify.intelligence.review._context.models import ReviewContext
from desloppify.intelligence.review._context.patterns import (
    CLASS_NAME_RE,
    ERROR_PATTERNS,
    FUNC_NAME_RE,
    NAME_PREFIX_RE,
    default_review_module_patterns,
)
from desloppify.intelligence.review.context_signals.ai import gather_ai_debt_signals
from desloppify.intelligence.review.context_signals.auth import gather_auth_context
from desloppify.intelligence.review.context_signals.migration import (
    classify_error_strategy,
)
from desloppify.intelligence.review.context_builder import (
    ReviewContextBuildServices,
    build_review_context_inner,
)

# ── Shared helpers ────────────────────────────────────────────────


def abs_path(filepath: str) -> str:
    """Resolve filepath to absolute using resolve_path."""
    return resolve_path(filepath)


def file_excerpt(filepath: str, max_lines: int = 30) -> str | None:
    """Read first *max_lines* of a file, returning the text or None."""
    content = read_file_text(abs_path(filepath))
    if content is None:
        return None
    lines = content.splitlines(keepends=True)
    if len(lines) <= max_lines:
        return content
    return "".join(lines[:max_lines]) + f"\n... ({len(lines) - max_lines} more lines)"


def dep_graph_lookup(
    graph: dict[str, dict[str, Any]], filepath: str
) -> dict[str, Any]:
    """Look up a file in the dep graph, trying absolute and relative keys."""
    resolved = resolve_path(filepath)
    entry = graph.get(resolved)
    if entry is not None:
        return entry
    # Try relative path
    rpath = rel(filepath)
    entry = graph.get(rpath)
    if entry is not None:
        return entry
    return {}


def importer_count(entry: dict[str, Any]) -> int:
    """Extract importer count from a dep graph entry."""
    importers = entry.get("importers", set())
    if isinstance(importers, set):
        return len(importers)
    return entry.get("importer_count", 0)


# ── Per-file review context builder ──────────────────────────────


def build_review_context(
    path: Path,
    lang: object,
    state: StateModel,
    files: list[str] | None = None,
) -> ReviewContext:
    """Gather codebase conventions for contextual evaluation.

    If *files* is provided, skip file_finder (avoids redundant filesystem walks).
    """
    if files is None:
        files = lang.file_finder(path) if lang.file_finder else []
    ctx = ReviewContext()

    if not files:
        return ctx

    already_cached = is_file_cache_enabled()
    if not already_cached:
        enable_file_cache()
    try:
        return build_review_context_inner(
            files,
            lang,
            state,
            ctx,
            ReviewContextBuildServices(
                read_file_text=read_file_text,
                abs_path=abs_path,
                rel_path=rel,
                importer_count=importer_count,
                default_review_module_patterns=default_review_module_patterns,
                gather_ai_debt_signals=gather_ai_debt_signals,
                gather_auth_context=gather_auth_context,
                classify_error_strategy=classify_error_strategy,
                func_name_re=FUNC_NAME_RE,
                class_name_re=CLASS_NAME_RE,
                name_prefix_re=NAME_PREFIX_RE,
                error_patterns=ERROR_PATTERNS,
            ),
        )
    finally:
        if not already_cached:
            disable_file_cache()


def serialize_context(ctx: ReviewContext) -> dict[str, Any]:
    """Convert ReviewContext to a JSON-serializable dict."""
    def _section_dict(value: Any) -> dict[str, Any]:
        if isinstance(value, Mapping):
            return dict(value)
        return {}

    metrics = ("total_files", "total_loc", "avg_file_loc")
    codebase_stats = _section_dict(ctx.codebase_stats)
    out = {
        "naming_vocabulary": _section_dict(ctx.naming_vocabulary),
        "error_conventions": _section_dict(ctx.error_conventions),
        "module_patterns": _section_dict(ctx.module_patterns),
        "import_graph_summary": _section_dict(ctx.import_graph_summary),
        "zone_distribution": _section_dict(ctx.zone_distribution),
        "existing_issues": _section_dict(ctx.existing_issues),
        "codebase_stats": {
            key: int(codebase_stats.get(key, 0))
            for key in metrics
        },
        "sibling_conventions": _section_dict(ctx.sibling_conventions),
    }
    if ctx.ai_debt_signals:
        out["ai_debt_signals"] = _section_dict(ctx.ai_debt_signals)
    if ctx.auth_patterns:
        out["auth_patterns"] = _section_dict(ctx.auth_patterns)
    if ctx.error_strategies:
        out["error_strategies"] = _section_dict(ctx.error_strategies)
    return out


__all__ = [
    "ReviewContext",
    "abs_path",
    "build_review_context",
    "file_excerpt",
    "dep_graph_lookup",
    "importer_count",
    "serialize_context",
]
