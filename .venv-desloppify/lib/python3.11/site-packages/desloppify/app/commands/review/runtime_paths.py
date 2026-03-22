"""Shared runtime path resolution for review command flows.

All override hooks live here so tests patch a single module instead of
per-command boilerplate.
"""

from __future__ import annotations

from pathlib import Path

from desloppify.base.discovery.paths import get_project_root

# ── Test override hooks (monkeypatch these in tests) ──────────────
PROJECT_ROOT: Path | None = None
REVIEW_PACKET_DIR: Path | None = None
SUBAGENT_RUNS_DIR: Path | None = None
EXTERNAL_SESSION_ROOT: Path | None = None


def runtime_project_root(*, project_root_override: Path | None = None) -> Path:
    """Resolve project root with optional test override hook."""
    override = project_root_override if project_root_override is not None else PROJECT_ROOT
    if isinstance(override, Path):
        return override
    return get_project_root()


def review_packet_dir(
    *,
    project_root_override: Path | None = None,
    review_packet_dir_override: Path | None = None,
) -> Path:
    """Resolve `.desloppify/review_packets` with optional override."""
    override = review_packet_dir_override if review_packet_dir_override is not None else REVIEW_PACKET_DIR
    if isinstance(override, Path):
        return override
    return runtime_project_root(project_root_override=project_root_override) / ".desloppify" / "review_packets"


def blind_packet_path(
    *,
    project_root_override: Path | None = None,
    stamp: str | None = None,
) -> Path:
    """Resolve blind packet path under `.desloppify`.

    When ``stamp`` is provided, return a run-scoped blind packet path to avoid
    cross-run write races.
    """
    if isinstance(stamp, str) and stamp.strip():
        packet_dir = review_packet_dir(project_root_override=project_root_override)
        return packet_dir / f"review_packet_blind_{stamp.strip()}.json"
    return runtime_project_root(project_root_override=project_root_override) / ".desloppify" / "review_packet_blind.json"


def subagent_runs_dir(
    *,
    project_root_override: Path | None = None,
    subagent_runs_dir_override: Path | None = None,
) -> Path:
    """Resolve subagent run artifact directory with optional override."""
    override = subagent_runs_dir_override if subagent_runs_dir_override is not None else SUBAGENT_RUNS_DIR
    if isinstance(override, Path):
        return override
    return runtime_project_root(project_root_override=project_root_override) / ".desloppify" / "subagents" / "runs"


def external_session_root(
    *,
    project_root_override: Path | None = None,
    external_session_root_override: Path | None = None,
) -> Path:
    """Resolve external review session root with optional override."""
    override = external_session_root_override if external_session_root_override is not None else EXTERNAL_SESSION_ROOT
    if isinstance(override, Path):
        return override
    return runtime_project_root(project_root_override=project_root_override) / ".desloppify" / "external_review_sessions"


__all__ = [
    "blind_packet_path",
    "external_session_root",
    "review_packet_dir",
    "runtime_project_root",
    "subagent_runs_dir",
]
