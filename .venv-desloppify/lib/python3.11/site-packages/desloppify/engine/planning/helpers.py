"""Shared plan constants and helpers."""

from __future__ import annotations

CONFIDENCE_ORDER = {"high": 0, "medium": 1, "low": 2}


def is_subjective_phase(phase) -> bool:
    """Return True when a phase is subjective/review oriented."""
    label = (phase.label or "").lower()
    run_name = getattr(phase.run, "__name__", "").lower()
    return (
        "subjective" in label
        or "review" in label
        or run_name == "phase_subjective_review"
    )
