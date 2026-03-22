"""Concern classification and text construction helpers."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from .constants import ELEVATED_MAX_NESTING, ELEVATED_MAX_PARAMS, MIN_DETECTORS_FOR_MIXED
from .types import ConcernSignals


def _classify(detectors: set[str], signals: ConcernSignals) -> str:
    """Pick the most specific concern type from what's present."""
    if len(detectors) >= MIN_DETECTORS_FOR_MIXED:
        return "mixed_responsibilities"
    if "dupes" in detectors or "boilerplate_duplication" in detectors:
        return "duplication_design"
    if signals.get("monster_loc", 0) > 0:
        return "structural_complexity"
    if "coupling" in detectors:
        return "coupling_design"
    if signals.get("max_params", 0) >= ELEVATED_MAX_PARAMS:
        return "interface_design"
    if signals.get("max_nesting", 0) >= ELEVATED_MAX_NESTING:
        return "structural_complexity"
    if "responsibility_cohesion" in detectors:
        return "mixed_responsibilities"
    return "design_concern"


_SUMMARY_TEMPLATES: dict[str, str] = {
    "mixed_responsibilities": (
        "Issues from {detector_count} detectors — may have too many responsibilities"
    ),
    "duplication_design": "Duplication pattern — assess if extraction is warranted",
    "coupling_design": "Coupling pattern — assess if boundaries need adjustment",
    "interface_design": "Interface complexity: {max_params} parameters",
}
_DEFAULT_SUMMARY_TEMPLATE = "Design signals from {detector_list}"


def _summary_context(detectors: set[str], signals: ConcernSignals) -> dict[str, object]:
    return {
        "detector_count": len(detectors),
        "detector_list": ", ".join(sorted(detectors)),
        "max_params": int(signals.get("max_params", 0)),
    }


def _build_structural_summary(signals: ConcernSignals) -> str:
    parts: list[str] = []
    monster_loc = signals.get("monster_loc", 0)
    if monster_loc:
        funcs = signals.get("monster_funcs", [])
        label = f" ({', '.join(funcs[:3])})" if funcs else ""
        parts.append(f"monster function{label}: {int(monster_loc)} lines")
    nesting = signals.get("max_nesting", 0)
    if nesting >= ELEVATED_MAX_NESTING:
        parts.append(f"nesting depth {int(nesting)}")
    params = signals.get("max_params", 0)
    if params >= ELEVATED_MAX_PARAMS:
        parts.append(f"{int(params)} parameters")
    return f"Structural complexity: {', '.join(parts) or 'elevated signals'}"


def _build_summary(
    concern_type: str,
    detectors: set[str],
    signals: ConcernSignals,
) -> str:
    """Build a one-line concern summary."""
    if concern_type == "structural_complexity":
        return _build_structural_summary(signals)
    template = _SUMMARY_TEMPLATES.get(concern_type, _DEFAULT_SUMMARY_TEMPLATE)
    return template.format(**_summary_context(detectors, signals))


def _build_evidence(
    issues: list[dict[str, Any]],
    signals: ConcernSignals,
) -> tuple[str, ...]:
    """Build evidence tuple from all issues and extracted signals."""
    evidence: list[str] = []

    detectors = sorted({finding.get("detector", "") for finding in issues})
    evidence.append(f"Flagged by: {', '.join(detectors)}")

    loc = signals.get("loc")
    if loc:
        evidence.append(f"File size: {int(loc)} lines")
    params = signals.get("max_params")
    if params and params >= ELEVATED_MAX_PARAMS:
        evidence.append(f"Max parameters: {int(params)}")
    nesting = signals.get("max_nesting")
    if nesting and nesting >= ELEVATED_MAX_NESTING:
        evidence.append(f"Max nesting depth: {int(nesting)}")
    monster_loc = signals.get("monster_loc")
    if monster_loc:
        funcs = signals.get("monster_funcs", [])
        label = f" ({', '.join(funcs[:3])})" if funcs else ""
        evidence.append(f"Monster function{label}: {int(monster_loc)} lines")

    for finding in issues[:10]:
        summary = finding.get("summary", "")
        if summary:
            evidence.append(f"[{finding.get('detector', '')}] {summary}")

    return tuple(evidence)


def _build_question(detectors: set[str], signals: ConcernSignals) -> str:
    """Build a targeted question from dominant detector and signal patterns."""
    funcs = signals.get("monster_funcs", [])
    context = {
        "detector_count": len(detectors),
        "detector_list": ", ".join(sorted(detectors)),
        "first_monster_func": funcs[0] if funcs else "",
    }

    question_rules: tuple[
        tuple[Callable[[set[str], ConcernSignals], bool], str],
        ...,
    ] = (
        (
            lambda dets, _signals: len(dets) >= MIN_DETECTORS_FOR_MIXED,
            (
                "This file has issues across {detector_count} dimensions "
                "({detector_list}). Is it trying to do too many things, "
                "or is this complexity inherent to its domain?"
            ),
        ),
        (
            lambda _dets, sig: bool(sig.get("monster_funcs")),
            (
                "What are the distinct responsibilities in {first_monster_func}()? "
                "Should it be decomposed into focused functions?"
            ),
        ),
        (
            lambda _dets, sig: sig.get("max_params", 0) >= ELEVATED_MAX_PARAMS,
            (
                "Should the parameters be grouped into a config/context object? "
                "Which ones belong together?"
            ),
        ),
        (
            lambda _dets, sig: sig.get("max_nesting", 0) >= ELEVATED_MAX_NESTING,
            (
                "Can the nesting be reduced with early returns, guard clauses, "
                "or extraction into helper functions?"
            ),
        ),
        (
            lambda dets, _signals: "dupes" in dets or "boilerplate_duplication" in dets,
            (
                "Is the duplication worth extracting into a shared utility, "
                "or is it intentional variation?"
            ),
        ),
        (
            lambda dets, _signals: "coupling" in dets,
            (
                "Is the coupling intentional or does it indicate a missing "
                "abstraction boundary?"
            ),
        ),
        (
            lambda dets, _signals: "orphaned" in dets,
            (
                "Is this file truly dead, or is it used via a non-import mechanism "
                "(dynamic import, CLI entry point, plugin)?"
            ),
        ),
        (
            lambda dets, _signals: "responsibility_cohesion" in dets,
            (
                "What are the distinct responsibilities? Would splitting "
                "produce modules with multiple independent consumers, or "
                "would extracted files only be imported by the parent? "
                "Only split if the extracted code would be reused."
            ),
        ),
    )
    parts = [
        template.format(**context)
        for predicate, template in question_rules
        if predicate(detectors, signals)
    ]
    if parts:
        return " ".join(parts)

    return (
        "Review the flagged patterns — are they design problems that "
        "need addressing, or acceptable given the file's role?"
    )


__all__ = [
    "_build_evidence",
    "_build_question",
    "_build_summary",
    "_classify",
]
