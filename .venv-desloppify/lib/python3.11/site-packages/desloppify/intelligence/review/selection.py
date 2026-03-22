"""File selection and staleness tracking for review."""

from __future__ import annotations

import hashlib
import logging
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from desloppify.base.discovery.file_paths import rel

from desloppify.base.discovery.source import read_file_text
from desloppify.engine.policy.zones import (
    REVIEW_SELECTION_EXCLUDED_ZONES,
    zone_in,
)
from desloppify.intelligence.review.context import (
    abs_path,
    dep_graph_lookup,
    importer_count,
)
from desloppify.intelligence.review.selection_cache import (
    count_fresh,
    count_stale,
    get_file_issues,
)
from desloppify.languages.framework import get_lang

logger = logging.getLogger(__name__)


# Files with these name patterns have low subjective review value —
# they're mostly declarations (types, constants, enums) not logic.
LOW_VALUE_NAMES = re.compile(r"(?:^|/)(?:types|constants|enums|index)\.[a-z]+$")
# Minimum LOC to be worth a review slot.
MIN_REVIEW_LOC = 20


@dataclass(frozen=True)
class ReviewSelectionOptions:
    """Configuration for review file selection."""

    max_files: int | None = None
    max_age_days: int = 30
    force_refresh: bool = True
    files: list[str] | None = None


def hash_file(filepath: str) -> str:
    """Compute a content hash for a file."""
    try:
        content = Path(filepath).read_bytes()
        return hashlib.sha256(content).hexdigest()[:16]
    except OSError:
        return ""


def select_files_for_review(
    lang: Any,
    path: Path,
    state: dict,
    options: ReviewSelectionOptions | None = None,
) -> list[str]:
    """Select production files for review, priority-sorted.

    If *files* is provided, skip file_finder (avoids redundant filesystem walks).
    """
    resolved_options = options or ReviewSelectionOptions()

    files = resolved_options.files
    if files is None:
        files = lang.file_finder(path) if lang.file_finder else []

    cache = state.get("review_cache", {}).get("files", {})
    now = datetime.now(UTC)
    candidates = []

    for filepath in files:
        rpath = rel(filepath)

        # Skip non-production files
        if lang.zone_map is not None:
            zone = lang.zone_map.get(filepath)
            if zone_in(zone, REVIEW_SELECTION_EXCLUDED_ZONES):
                continue

        # Skip if cached, content unchanged, and not stale
        if not resolved_options.force_refresh:
            entry = cache.get(rpath)
            if entry:
                current_hash = hash_file(abs_path(filepath))
                if current_hash and current_hash == entry.get("content_hash"):
                    reviewed_at = entry.get("reviewed_at", "")
                    if reviewed_at:
                        try:
                            reviewed = datetime.fromisoformat(reviewed_at)
                            age_days = (now - reviewed).days
                            if age_days <= resolved_options.max_age_days:
                                continue  # Still fresh
                        except (ValueError, TypeError) as exc:
                            entry["reviewed_at"] = ""
                            logger.debug(
                                "Invalid reviewed_at value %r for %s: %s",
                                reviewed_at,
                                rpath,
                                exc,
                            )

        priority = _compute_review_priority(filepath, lang, state)
        if priority >= 0:  # Negative = filtered out (too small)
            candidates.append((filepath, priority))

    candidates.sort(key=lambda x: -x[1])
    selected = [f for f, _ in candidates]
    if resolved_options.max_files is None:
        return selected
    return selected[: resolved_options.max_files]


def _compute_review_priority(filepath: str, lang, state: dict) -> int:
    """Higher = more important to review.

    Prioritizes implementation files with high blast radius and existing issues.
    Deprioritizes types/constants files (low subjective review value).
    """
    score = 0
    rpath = rel(filepath)

    content = read_file_text(abs_path(filepath))
    loc = len(content.splitlines()) if content is not None else 0

    # Skip tiny files — not enough to review
    if loc < MIN_REVIEW_LOC:
        return -1

    # Low-value files: language-provided pattern or generic fallback.
    is_low_value = is_low_value_file(rpath, lang)

    # High blast radius (many importers)
    if lang.dep_graph:
        entry = dep_graph_lookup(lang.dep_graph, filepath)
        ic = importer_count(entry)
        if is_low_value:
            score += ic * 2
        else:
            score += ic * 10

    # Already has programmatic issues (compound value — review will be richer)
    issues = (state.get("work_items") or state.get("issues", {}))
    n_issues = sum(
        1 for f in issues.values() if f.get("file") == rpath and f["status"] == "open"
    )
    score += n_issues * 5

    # High-complexity files with wontfixed structural issues
    # (mechanical detector says "complex" but can't say why — subjective review can)
    n_wontfix_structural = sum(
        1
        for f in issues.values()
        if f.get("file") == rpath
        and f["status"] == "wontfix"
        and f.get("detector") in ("structural", "smells")
    )
    if n_wontfix_structural:
        score += n_wontfix_structural * 15  # Strong boost — these need human insight

    # Complexity score from mechanical detectors (if available)
    complexity_map = getattr(lang, "complexity_map", None)
    if isinstance(complexity_map, dict) and complexity_map.get(rpath, 0) > 100:
        score += 20  # Very complex files need subjective review most

    # Larger files have more to review
    score += loc // 50

    # Low-value penalty — push toward bottom but don't exclude entirely
    if is_low_value:
        score = score // 3

    return score


def low_value_pattern(lang_or_name: Any = None) -> re.Pattern[str]:
    """Return the low-value filename regex for a language, with generic fallback."""
    if lang_or_name is not None and hasattr(lang_or_name, "review_low_value_pattern"):
        pattern = getattr(lang_or_name, "review_low_value_pattern", None)
        if isinstance(pattern, re.Pattern):
            return pattern

    if isinstance(lang_or_name, str):
        try:
            pattern = getattr(
                get_lang(lang_or_name), "review_low_value_pattern", None
            )
            if isinstance(pattern, re.Pattern):
                return pattern
        except (ImportError, ValueError, TypeError, AttributeError) as exc:
            pattern = None
            logger.debug(
                "Unable to load low-value review pattern for %s: %s", lang_or_name, exc
            )

    return LOW_VALUE_NAMES


def is_low_value_file(filepath: str, lang_or_name=None) -> bool:
    """Whether a file path is low-value for subjective review."""
    pattern = low_value_pattern(lang_or_name)
    return bool(pattern.search(filepath))


__all__ = [
    "LOW_VALUE_NAMES",
    "MIN_REVIEW_LOC",
    "ReviewSelectionOptions",
    "count_fresh",
    "count_stale",
    "get_file_issues",
    "hash_file",
    "is_low_value_file",
    "low_value_pattern",
    "select_files_for_review",
]
