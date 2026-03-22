"""File-scope filtering helpers for holistic review payload assembly."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from desloppify.base.discovery.file_paths import rel

_NON_PRODUCTION_ZONES = frozenset({"test", "config", "generated", "vendor"})
logger = logging.getLogger(__name__)


def collect_allowed_review_files(
    files: list[str],
    lang: object,
    *,
    base_path: Path | None = None,
) -> set[str]:
    """Return relative production-file paths allowed for holistic review batches."""
    allowed: set[str] = set()
    zone_map = getattr(lang, "zone_map", None)
    resolved_base = base_path.resolve() if isinstance(base_path, Path) else None
    for filepath in files:
        if not isinstance(filepath, str):
            continue
        normalized = filepath.strip().replace("\\", "/")
        if not normalized:
            continue
        if zone_map is not None:
            zone_get = getattr(zone_map, "get", None)
            zone = zone_get(filepath) if callable(zone_get) else None
            zone_value = getattr(zone, "value", zone)
            if zone_value is None:
                zone_value = "production"
            if not isinstance(zone_value, str):
                zone_value = str(zone_value)
            if zone_value in _NON_PRODUCTION_ZONES:
                continue
        allowed.add(normalized)
        allowed.add(rel(filepath))
        if resolved_base is not None:
            try:
                resolved_path = Path(filepath).resolve()
            except OSError as exc:
                logger.debug("Skipping invalid review file path %s: %s", filepath, exc)
                continue
            if resolved_path.is_relative_to(resolved_base):
                allowed.add(resolved_path.relative_to(resolved_base).as_posix())
    return allowed


def file_in_allowed_scope(filepath: object, allowed_files: set[str]) -> bool:
    """True when *filepath* resolves to a currently in-scope review file."""
    if not isinstance(filepath, str):
        return False
    normalized = filepath.strip().replace("\\", "/")
    if not normalized:
        return False
    if normalized in allowed_files:
        return True
    return rel(filepath) in allowed_files


def filter_issue_focus_to_scope(
    issue_focus: object,
    allowed_files: set[str],
) -> dict[str, object] | None:
    """Drop out-of-scope related_files from historical issue focus payload."""
    if not isinstance(issue_focus, dict):
        return None
    issues_raw = issue_focus.get("issues", [])
    issues: list[dict[str, object]] = []
    if isinstance(issues_raw, list):
        for raw_issue in issues_raw:
            if not isinstance(raw_issue, dict):
                continue
            issue = dict(raw_issue)
            related_raw = issue.get("related_files", [])
            if isinstance(related_raw, list):
                issue["related_files"] = [
                    path
                    for path in related_raw
                    if file_in_allowed_scope(path, allowed_files)
                ]
            issues.append(issue)
    scoped = dict(issue_focus)
    scoped["issues"] = issues
    scoped["selected_count"] = len(issues)
    return scoped


def filter_batches_to_file_scope(
    batches: list[dict[str, Any]],
    *,
    allowed_files: set[str],
) -> list[dict[str, Any]]:
    """Strip out-of-scope files/signals from review batches."""
    if not allowed_files:
        return []

    scoped_batches: list[dict[str, Any]] = []
    for raw_batch in batches:
        if not isinstance(raw_batch, dict):
            continue
        batch = dict(raw_batch)

        concern_signals = batch.get("concern_signals", [])
        if isinstance(concern_signals, list):
            batch["concern_signals"] = [
                signal
                for signal in concern_signals
                if isinstance(signal, dict)
                and file_in_allowed_scope(signal.get("file", ""), allowed_files)
            ]
            if "concern_signal_count" in batch:
                batch["concern_signal_count"] = len(batch["concern_signals"])

        issue_focus = filter_issue_focus_to_scope(
            batch.get("historical_issue_focus"),
            allowed_files,
        )
        if issue_focus is not None:
            batch["historical_issue_focus"] = issue_focus

        # Dimensions come from the original batch payload; this scope filter only trims
        # file-linked fields such as concern signals and historical issue focus.
        if raw_batch.get("dimensions"):
            scoped_batches.append(batch)
    return scoped_batches


__all__ = [
    "collect_allowed_review_files",
    "file_in_allowed_scope",
    "filter_batches_to_file_scope",
    "filter_issue_focus_to_scope",
]
