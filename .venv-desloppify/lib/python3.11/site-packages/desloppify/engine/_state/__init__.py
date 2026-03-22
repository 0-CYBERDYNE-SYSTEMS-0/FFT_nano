"""State persistence, filtering, scoring, and merge internals.

This is the internal implementation of state management. External code
should use ``state.py`` (the root-level public facade) instead of
importing from this package directly.
"""

from __future__ import annotations

from desloppify.engine._state.schema import StateModel


def _recompute_stats(
    state: StateModel,
    scan_path: str | None = None,
    *,
    subjective_integrity_target: float | None = None,
) -> None:
    """Shared wrapper to avoid import-time cycles during state bootstrapping."""
    from desloppify.engine._scoring.state_integration import recompute_stats

    recompute_stats(
        state,
        scan_path=scan_path,
        subjective_integrity_target=subjective_integrity_target,
    )
