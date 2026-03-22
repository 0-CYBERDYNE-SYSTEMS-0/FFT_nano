"""DetectorPhase builder helpers for shared framework phases."""

from __future__ import annotations

from functools import partial

from .shared_phases import (
    _detect_security_issues_default,
    phase_boilerplate_duplication,
    phase_dupes,
    phase_security,
    phase_signature,
    phase_subjective_review,
    phase_test_coverage,
)
from .types import DetectorPhase


def _make_detector_phase_factory(
    label: str,
    run_fn,
    *,
    slow: bool = False,
    exclusive_detector: str | None = None,
):
    """Return a phase factory with explicit label/run/slow semantics.

    *exclusive_detector*: if set, the detector module path that this phase owns.
    Language-specific phase files must not import that module directly.
    """
    def factory() -> DetectorPhase:
        return DetectorPhase(label, run_fn, slow=slow)
    factory.exclusive_detector = exclusive_detector
    return factory


SHARED_PHASE_FACTORIES = {
    "test_coverage": _make_detector_phase_factory(
        "Test coverage", phase_test_coverage,
        exclusive_detector="desloppify.engine.detectors.test_coverage",
    ),
    "security": _make_detector_phase_factory(
        "Security",
        partial(
            phase_security,
            detect_security_issues=_detect_security_issues_default,
        ),
        exclusive_detector="desloppify.engine.detectors.security",
    ),
    "signature": _make_detector_phase_factory(
        "Signature analysis", phase_signature,
        exclusive_detector="desloppify.engine.detectors.signature",
    ),
    "subjective_review": _make_detector_phase_factory(
        "Subjective review", phase_subjective_review,
        exclusive_detector="desloppify.engine.detectors.review_coverage",
    ),
    "duplicates": _make_detector_phase_factory(
        "Duplicates", phase_dupes, slow=True,
        exclusive_detector="desloppify.engine.detectors.dupes",
    ),
    "boilerplate_duplication": _make_detector_phase_factory(
        "Boilerplate duplication", phase_boilerplate_duplication, slow=True,
        exclusive_detector="desloppify.engine.detectors.jscpd_adapter",
    ),
}

EXCLUSIVE_DETECTOR_MODULES: frozenset[str] = frozenset(
    f.exclusive_detector
    for f in SHARED_PHASE_FACTORIES.values()
    if f.exclusive_detector is not None
)


detector_phase_test_coverage = SHARED_PHASE_FACTORIES["test_coverage"]
detector_phase_security = SHARED_PHASE_FACTORIES["security"]
detector_phase_signature = SHARED_PHASE_FACTORIES["signature"]
detector_phase_subjective_review = SHARED_PHASE_FACTORIES["subjective_review"]
detector_phase_duplicates = SHARED_PHASE_FACTORIES["duplicates"]
detector_phase_boilerplate_duplication = SHARED_PHASE_FACTORIES["boilerplate_duplication"]


def shared_subjective_duplicates_tail(
    *,
    pre_duplicates: list[DetectorPhase] | None = None,
) -> list[DetectorPhase]:
    """Shared review tail: subjective review, optional custom phases, then duplicates."""
    phases = [detector_phase_subjective_review()]
    if pre_duplicates:
        phases.extend(pre_duplicates)
    phases.append(detector_phase_boilerplate_duplication())
    phases.append(detector_phase_duplicates())
    return phases


__all__ = [
    "detector_phase_boilerplate_duplication",
    "detector_phase_duplicates",
    "detector_phase_security",
    "detector_phase_signature",
    "detector_phase_subjective_review",
    "detector_phase_test_coverage",
    "EXCLUSIVE_DETECTOR_MODULES",
    "SHARED_PHASE_FACTORIES",
    "shared_subjective_duplicates_tail",
]
