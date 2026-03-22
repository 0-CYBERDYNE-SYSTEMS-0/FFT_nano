"""Pattern census and anomaly analysis for TypeScript codebases."""

from __future__ import annotations

import logging
import re
from collections import defaultdict
from pathlib import Path

from desloppify.base.discovery.file_paths import rel, resolve_path
from desloppify.base.discovery.paths import get_area
from desloppify.base.discovery.source import find_ts_and_tsx_files
from desloppify.base.output.fallbacks import log_best_effort_failure
from desloppify.languages.typescript.detectors.contracts import DetectorResult
from .catalog import PATTERN_FAMILIES

logger = logging.getLogger(__name__)


def _build_census(
    path: Path,
) -> tuple[dict[str, dict[str, set[str]]], dict[str, dict[str, dict[str, list[dict]]]]]:
    """Build matrix: area -> family -> set(pattern names), with file/line evidence."""
    files = find_ts_and_tsx_files(path)
    census: dict[str, dict[str, set[str]]] = defaultdict(lambda: defaultdict(set))
    evidence: dict[str, dict[str, dict[str, list[dict]]]] = defaultdict(
        lambda: defaultdict(lambda: defaultdict(list))
    )

    compiled: dict[str, dict[str, re.Pattern]] = {
        family_name: {
            name: re.compile(regex)
            for name, regex in family["patterns"].items()
        }
        for family_name, family in PATTERN_FAMILIES.items()
    }

    for filepath in files:
        try:
            area = get_area(filepath)
            p = Path(filepath) if Path(filepath).is_absolute() else Path(resolve_path(filepath))
            content = p.read_text()
        except (OSError, UnicodeDecodeError) as exc:
            log_best_effort_failure(logger, f"read TypeScript pattern candidate {filepath}", exc)
            continue

        for family_name, patterns in compiled.items():
            for name, regex in patterns.items():
                match = regex.search(content)
                if not match:
                    continue
                census[area][family_name].add(name)
                line = content[:match.start()].count("\n") + 1
                evidence[area][family_name][name].append(
                    {"file": rel(filepath), "line": line}
                )

    return dict(census), {
        area: {
            family: {pat: entries for pat, entries in pats.items()}
            for family, pats in families.items()
        }
        for area, families in evidence.items()
    }


def detect_pattern_anomalies(path: Path) -> DetectorResult[dict]:
    """Detect areas with competing pattern fragmentation."""
    census, evidence = _build_census(path)
    if not census:
        return DetectorResult(entries=[], population_kind="areas", population_size=0)

    total_areas = len(census)
    if total_areas < 5:
        return DetectorResult(entries=[], population_kind="areas", population_size=total_areas)

    competing_families = {
        name: fam
        for name, fam in PATTERN_FAMILIES.items()
        if fam["type"] == "competing"
    }

    pattern_adoption: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for families in census.values():
        for family_name in competing_families:
            for pattern in families.get(family_name, set()):
                pattern_adoption[family_name][pattern] += 1

    anomalies = []
    for area, families in census.items():
        for family_name, family_config in competing_families.items():
            patterns = families.get(family_name, set())
            if not patterns:
                continue

            threshold = family_config["fragmentation_threshold"]
            reasons = []

            if len(patterns) >= threshold:
                sorted_patterns = sorted(patterns)
                reasons.append(
                    f"{len(patterns)} competing {family_name} approaches: "
                    f"{', '.join(sorted_patterns)}. "
                    "Review: can this area standardize on one?"
                )

            for pattern in patterns:
                adoption_count = pattern_adoption[family_name][pattern]
                adoption_rate = adoption_count / total_areas
                if adoption_rate < 0.10:
                    reasons.append(
                        f"Rare approach: {pattern} used here but only in "
                        f"{adoption_count}/{total_areas} areas"
                    )

            if not reasons:
                continue

            confidence = "medium" if len(patterns) >= threshold else "low"
            family_evidence = (
                evidence.get(area, {}).get(family_name, {})
                if isinstance(evidence, dict)
                else {}
            )
            anomalies.append(
                {
                    "area": area,
                    "family": family_name,
                    "patterns_used": sorted(patterns),
                    "pattern_count": len(patterns),
                    "pattern_evidence": {
                        pattern_name: list(entries)
                        for pattern_name, entries in family_evidence.items()
                        if pattern_name in patterns and isinstance(entries, list)
                    },
                    "confidence": confidence,
                    "review": " | ".join(reasons),
                }
            )

    return DetectorResult(
        entries=sorted(anomalies, key=lambda a: (-a["pattern_count"], a["area"], a["family"])),
        population_kind="areas",
        population_size=total_areas,
    )


__all__ = [
    "_build_census",
    "detect_pattern_anomalies",
]
