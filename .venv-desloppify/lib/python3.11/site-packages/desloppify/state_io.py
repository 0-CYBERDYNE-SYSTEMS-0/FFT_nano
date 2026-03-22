"""State I/O and schema facade.

Prefer this module when callers need persistence and schema contracts.
Use ``desloppify.state_scoring`` for score-only access.
"""

from __future__ import annotations

from desloppify.engine._state.persistence import load_state, save_state, state_lock
from desloppify.engine._state.schema import (
    CURRENT_VERSION,
    ConcernDismissal,
    DimensionScore,
    Issue,
    ScanMetadataModel,
    StateModel,
    StateStats,
    SubjectiveAssessment,
    SubjectiveIntegrity,
    empty_state,
    ensure_state_defaults,
    get_state_dir,
    get_state_file,
    json_default,
    migrate_state_keys,
    scan_inventory_available,
    scan_metadata,
    scan_reconstructed_issue_count,
    scan_source,
    scan_metrics_available,
    utc_now,
    validate_state_invariants,
)

__all__ = [
    "ConcernDismissal",
    "CURRENT_VERSION",
    "DimensionScore",
    "Issue",
    "ScanMetadataModel",
    "StateModel",
    "StateStats",
    "SubjectiveAssessment",
    "SubjectiveIntegrity",
    "empty_state",
    "ensure_state_defaults",
    "get_state_dir",
    "get_state_file",
    "json_default",
    "load_state",
    "migrate_state_keys",
    "save_state",
    "scan_inventory_available",
    "scan_metadata",
    "scan_reconstructed_issue_count",
    "scan_source",
    "scan_metrics_available",
    "state_lock",
    "utc_now",
    "validate_state_invariants",
]
