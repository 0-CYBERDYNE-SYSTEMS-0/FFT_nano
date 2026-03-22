"""Concern generators bridging mechanical findings to holistic review cues."""

from __future__ import annotations

from collections import defaultdict
from typing import Any

from desloppify.base.registry import JUDGMENT_DETECTORS
from desloppify.engine._state.schema import StateModel

from .constants import MIN_FILES_FOR_SMELL_PATTERN, MIN_FILES_FOR_SYSTEMIC
from .signals import _extract_signals, _has_elevated_signals
from .state import _group_by_file, _open_issues
from .text import _build_evidence, _build_question, _build_summary, _classify
from .types import Concern
from .utils import _fingerprint, _is_dismissed


def _try_make_concern(
    *,
    concern_type: str,
    file: str,
    fp_keys: tuple[str, ...],
    all_ids: tuple[str, ...],
    dismissals: dict[str, Any],
    summary: str,
    evidence: tuple[str, ...],
    question: str,
    fp_file: str | None = None,
) -> Concern | None:
    """Create a concern unless a matching dismissal exists."""
    fp = _fingerprint(concern_type, fp_file if fp_file is not None else file, fp_keys)
    if _is_dismissed(dismissals, fp, all_ids):
        return None
    return Concern(
        type=concern_type,
        file=file,
        summary=summary,
        evidence=evidence,
        question=question,
        fingerprint=fp,
        source_issues=all_ids,
    )


def _file_concerns(state: StateModel, dismissals: dict[str, Any]) -> list[Concern]:
    """Build per-file concerns from aggregated judgment detector signals."""
    by_file = _group_by_file(state)
    concerns: list[Concern] = []

    for file, all_issues in by_file.items():
        judgment = [
            finding
            for finding in all_issues
            if finding.get("detector", "") in JUDGMENT_DETECTORS
        ]
        if not judgment:
            continue

        judgment_dets = {finding.get("detector", "") for finding in judgment}
        elevated = _has_elevated_signals(judgment)

        mechanical_count = len(all_issues)
        if len(judgment_dets) < 2 and not elevated:
            if not (len(judgment_dets) >= 1 and mechanical_count >= 3):
                continue

        signals = _extract_signals(judgment)
        concern_type = _classify(judgment_dets, signals)
        all_ids = tuple(sorted(finding.get("id", "") for finding in judgment))
        fp_keys = tuple(sorted(judgment_dets))

        concern = _try_make_concern(
            concern_type=concern_type,
            file=file,
            fp_keys=fp_keys,
            all_ids=all_ids,
            dismissals=dismissals,
            summary=_build_summary(concern_type, judgment_dets, signals),
            evidence=_build_evidence(judgment, signals),
            question=_build_question(judgment_dets, signals),
        )
        if concern is not None:
            concerns.append(concern)

    return concerns


def _cross_file_patterns(state: StateModel, dismissals: dict[str, Any]) -> list[Concern]:
    """Build systemic concerns for detector-combo patterns across files."""
    by_file = _group_by_file(state)

    profile_to_files: dict[frozenset[str], list[str]] = defaultdict(list)
    for file, issues in by_file.items():
        detectors = frozenset(
            finding.get("detector", "")
            for finding in issues
            if finding.get("detector", "") in JUDGMENT_DETECTORS
        )
        if len(detectors) >= 2:
            profile_to_files[detectors].append(file)

    concerns: list[Concern] = []
    for det_combo, files in profile_to_files.items():
        if len(files) < MIN_FILES_FOR_SYSTEMIC:
            continue

        sorted_files = sorted(files)
        combo_names = tuple(sorted(det_combo))
        all_ids = tuple(
            sorted(
                finding.get("id", "")
                for file in sorted_files
                for finding in by_file[file]
                if finding.get("detector", "") in det_combo
            )
        )
        concern = _try_make_concern(
            concern_type="systemic_pattern",
            file=sorted_files[0],
            fp_file=",".join(sorted_files[:5]),
            fp_keys=combo_names,
            all_ids=all_ids,
            dismissals=dismissals,
            summary=(
                f"{len(files)} files share the same problem pattern "
                f"({', '.join(combo_names)})"
            ),
            evidence=(
                f"Affected files: {', '.join(sorted_files[:10])}",
                f"Shared detectors: {', '.join(combo_names)}",
                f"Total files: {len(files)}",
            ),
            question=(
                f"These {len(files)} files all have the same combination "
                f"of issues ({', '.join(combo_names)}). Is this a systemic "
                "pattern that should be addressed at the architecture level "
                "(shared base class, framework change, lint rule), or are "
                "these independent issues that happen to look similar?"
            ),
        )
        if concern is not None:
            concerns.append(concern)

    return concerns


def _systemic_smell_patterns(
    state: StateModel,
    dismissals: dict[str, Any],
) -> list[Concern]:
    """Build systemic concerns when a single smell appears across many files."""
    smell_files: dict[str, list[str]] = defaultdict(list)
    smell_ids_map: dict[str, list[str]] = defaultdict(list)

    for finding in _open_issues(state):
        if finding.get("detector") != "smells":
            continue
        detail = finding.get("detail", {})
        smell_id = detail.get("smell_id", "") if isinstance(detail, dict) else ""
        filepath = finding.get("file", "")
        if smell_id and filepath and filepath != ".":
            smell_files[smell_id].append(filepath)
            smell_ids_map[smell_id].append(finding.get("id", ""))

    concerns: list[Concern] = []
    for smell_id, files in smell_files.items():
        unique_files = sorted(set(files))
        if len(unique_files) < MIN_FILES_FOR_SMELL_PATTERN:
            continue

        all_ids = tuple(sorted(smell_ids_map[smell_id]))
        concern = _try_make_concern(
            concern_type="systemic_smell",
            file=unique_files[0],
            fp_file=smell_id,
            fp_keys=(smell_id,),
            all_ids=all_ids,
            dismissals=dismissals,
            summary=(
                f"'{smell_id}' appears in {len(unique_files)} files — "
                "likely a systemic pattern"
            ),
            evidence=(
                f"Smell: {smell_id}",
                f"Affected files ({len(unique_files)}): {', '.join(unique_files[:10])}",
            ),
            question=(
                f"The smell '{smell_id}' appears across {len(unique_files)} files. "
                "Is this a codebase-wide convention that should be addressed "
                "systemically (lint rule, shared utility, architecture change), "
                "or are these independent occurrences?"
            ),
        )
        if concern is not None:
            concerns.append(concern)

    return concerns


_GENERATORS = [_file_concerns, _cross_file_patterns, _systemic_smell_patterns]


def generate_concerns(state: StateModel) -> list[Concern]:
    """Run all concern generators against current state."""
    dismissals = state.get("concern_dismissals", {})
    concerns: list[Concern] = []
    seen_fingerprints: set[str] = set()

    for generator in _GENERATORS:
        for concern in generator(state, dismissals):
            if concern.fingerprint not in seen_fingerprints:
                seen_fingerprints.add(concern.fingerprint)
                concerns.append(concern)

    concerns.sort(key=lambda concern: (concern.type, concern.file))
    return concerns


def cleanup_stale_dismissals(state: StateModel) -> int:
    """Remove concern dismissals whose source issues all disappeared."""
    dismissals = state.get("concern_dismissals", {})
    if not dismissals:
        return 0
    open_ids = {finding.get("id", "") for finding in _open_issues(state)}
    stale_fingerprints = [
        fingerprint
        for fingerprint, entry in dismissals.items()
        if entry.get("source_issue_ids")
        and not any(source_id in open_ids for source_id in entry["source_issue_ids"])
    ]
    for fingerprint in stale_fingerprints:
        del dismissals[fingerprint]
    return len(stale_fingerprints)


__all__ = [
    "_cross_file_patterns",
    "_file_concerns",
    "cleanup_stale_dismissals",
    "generate_concerns",
]
