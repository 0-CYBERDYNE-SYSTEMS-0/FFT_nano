"""State-path and scan-gating helpers for command modules."""

from __future__ import annotations
import argparse
from pathlib import Path

from desloppify.app.commands.helpers.lang import auto_detect_lang_name
from desloppify.base.output.terminal import colorize
from desloppify.base.discovery.paths import get_project_root
from desloppify.engine._state.schema import (
    scan_inventory_available,
    scan_metrics_available,
)


def _sole_existing_lang_state_file() -> Path | None:
    """Return the only existing language-specific state file, if unambiguous."""
    state_dir = get_project_root() / ".desloppify"
    if not state_dir.exists():
        return None
    candidates = sorted(path for path in state_dir.glob("state-*.json") if path.is_file())
    if len(candidates) == 1:
        return candidates[0]
    return None


def _allow_lang_state_fallback(args: argparse.Namespace) -> bool:
    """Whether command can safely fallback to the sole existing lang state file."""
    # Scan should always honor detected/explicit language mapping to avoid cross-lang merges.
    return getattr(args, "command", None) != "scan"


def state_path(args: argparse.Namespace) -> Path | None:
    """Get state file path from args, or None for default."""
    path_arg = getattr(args, "state", None)
    if path_arg:
        return Path(path_arg)
    lang_name = getattr(args, "lang", None)
    if not lang_name:
        lang_name = auto_detect_lang_name(args)
    if lang_name:
        resolved = get_project_root() / ".desloppify" / f"state-{lang_name}.json"
        if resolved.exists() or not _allow_lang_state_fallback(args):
            return resolved
        fallback = _sole_existing_lang_state_file()
        if fallback is not None:
            return fallback
        return resolved

    if _allow_lang_state_fallback(args):
        fallback = _sole_existing_lang_state_file()
        if fallback is not None:
            return fallback
    return None


def require_issue_inventory(state: dict) -> bool:
    """Return True when command consumers can rely on the issue inventory."""
    if not scan_inventory_available(state):
        print(colorize("No scans yet. Run: desloppify scan", "yellow"))
        return False
    return True


def require_scan_metrics(state: dict) -> bool:
    """Return True when real scan-derived metrics are available."""
    if not scan_metrics_available(state):
        print(colorize("No completed scan metrics yet. Run: desloppify scan", "yellow"))
        return False
    return True


__all__ = [
    "require_issue_inventory",
    "require_scan_metrics",
    "state_path",
]
