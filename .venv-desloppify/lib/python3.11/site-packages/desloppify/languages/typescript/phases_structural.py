"""Structural TypeScript phase helpers and runner."""

from __future__ import annotations

from pathlib import Path

from desloppify.base.output.terminal import log
from desloppify.engine.detectors import complexity as complexity_detector_mod
from desloppify.engine.detectors import flat_dirs as flat_dirs_detector_mod
from desloppify.engine.detectors import gods as gods_detector_mod
from desloppify.engine.detectors import large as large_detector_mod
from desloppify.engine._state.filtering import make_issue
from desloppify.engine.policy.zones import adjust_potential
from desloppify.languages._framework.base.structural import (
    add_structural_signal,
    merge_structural_signals,
)
from desloppify.languages._framework.base.types import LangRuntimeContract
import desloppify.languages.typescript.detectors.concerns as concerns_detector_mod
import desloppify.languages.typescript.detectors.props as props_detector_mod
from desloppify.languages.typescript.extractors_components import (
    detect_passthrough_components,
    extract_ts_components,
)
from desloppify.languages.typescript.phases_config import (
    TS_COMPLEXITY_SIGNALS,
    TS_GOD_RULES,
)
from desloppify.state_io import Issue


def _detect_structural_signals(
    path: Path, lang: LangRuntimeContract
) -> tuple[list[Issue], int]:
    """Detect large files, complexity, god components, and mixed concerns."""
    structural: dict[str, dict] = {}

    large_entries, file_count = large_detector_mod.detect_large_files(
        path,
        file_finder=lang.file_finder,
        threshold=lang.large_threshold,
    )
    for entry in large_entries:
        add_structural_signal(
            structural, entry["file"], f"large ({entry['loc']} LOC)", {"loc": entry["loc"]}
        )

    complexity_entries, _ = complexity_detector_mod.detect_complexity(
        path,
        signals=TS_COMPLEXITY_SIGNALS,
        file_finder=lang.file_finder,
        threshold=lang.complexity_threshold,
    )
    for entry in complexity_entries:
        add_structural_signal(
            structural,
            entry["file"],
            f"complexity score {entry['score']}",
            {"complexity_score": entry["score"], "complexity_signals": entry["signals"]},
        )
        lang.complexity_map[entry["file"]] = entry["score"]

    god_entries, _ = gods_detector_mod.detect_gods(
        extract_ts_components(path), TS_GOD_RULES, min_reasons=2
    )
    for entry in god_entries:
        add_structural_signal(
            structural,
            entry["file"],
            f"{entry['detail'].get('hook_total', 0)} hooks ({', '.join(entry['reasons'][:2])})",
            {
                "hook_total": entry["detail"].get("hook_total", 0),
                "hook_reasons": entry["reasons"],
            },
        )

    concern_entries, _ = concerns_detector_mod.detect_mixed_concerns(path)
    for entry in concern_entries:
        add_structural_signal(
            structural,
            entry["file"],
            f"mixed: {', '.join(entry['concerns'][:3])}",
            {"concerns": entry["concerns"]},
        )

    results = merge_structural_signals(structural, log)
    return results, file_count


def _detect_flat_dirs(path: Path, lang: LangRuntimeContract) -> tuple[list[Issue], int]:
    """Detect flat directories with too many files or missing sub-organization."""
    results: list[Issue] = []
    flat_entries, dir_count = flat_dirs_detector_mod.detect_flat_dirs(
        path,
        file_finder=lang.file_finder,
        config=flat_dirs_detector_mod.FlatDirDetectionConfig(),
    )
    for entry in flat_entries:
        child_dir_count = int(entry.get("child_dir_count", 0))
        combined_score = int(entry.get("combined_score", entry.get("file_count", 0)))
        results.append(
            make_issue(
                "flat_dirs",
                entry["directory"],
                "",
                tier=3,
                confidence="medium",
                summary=flat_dirs_detector_mod.format_flat_dir_summary(entry),
                detail={
                    "file_count": entry["file_count"],
                    "child_dir_count": child_dir_count,
                    "combined_score": combined_score,
                    "kind": entry.get("kind", "overload"),
                    "parent_sibling_count": int(entry.get("parent_sibling_count", 0)),
                    "wrapper_item_count": int(entry.get("wrapper_item_count", 0)),
                    "sparse_child_count": int(entry.get("sparse_child_count", 0)),
                    "sparse_child_ratio": float(entry.get("sparse_child_ratio", 0.0)),
                    "sparse_child_file_threshold": int(
                        entry.get("sparse_child_file_threshold", 0)
                    ),
                },
            )
        )
    if flat_entries:
        log(
            f"         flat dirs: {len(flat_entries)} overloaded directories "
            "(files/subdirs/combined)"
        )
    return results, dir_count


def _detect_props_bloat(path: Path, lang: LangRuntimeContract) -> tuple[list[Issue], int]:
    """Detect bloated prop interfaces in TypeScript files."""
    results: list[Issue] = []
    props_thresh = lang.props_threshold
    prop_entries, prop_count = props_detector_mod.detect_prop_interface_bloat(
        path, threshold=props_thresh
    )
    for entry in prop_entries:
        prop_count_value = entry["prop_count"]
        if prop_count_value >= 50:
            confidence, tier = "high", 4
        elif prop_count_value >= 30:
            confidence, tier = "medium", 3
        else:
            confidence, tier = "low", 3
        results.append(
            make_issue(
                "props",
                entry["file"],
                entry["interface"],
                tier=tier,
                confidence=confidence,
                summary=(
                    f"Bloated {entry.get('kind', 'props')}: {entry['interface']} "
                    f"({prop_count_value} fields)"
                ),
                detail={
                    "prop_count": prop_count_value,
                    "line": entry["line"],
                    "kind": entry.get("kind", "props"),
                },
            )
        )
    return results, prop_count


def _detect_passthrough(path: Path) -> list[Issue]:
    """Detect passthrough components that forward most props unchanged."""
    results: list[Issue] = []
    passthrough_entries = detect_passthrough_components(path)
    for entry in passthrough_entries:
        results.append(
            make_issue(
                "props",
                entry["file"],
                f"passthrough::{entry['component']}",
                tier=entry["tier"],
                confidence=entry["confidence"],
                summary=(
                    f"Passthrough component: {entry['component']} "
                    f"({entry['passthrough']}/{entry['total_props']} props forwarded, "
                    f"{entry['ratio']:.0%})"
                ),
                detail={
                    "passthrough": entry["passthrough"],
                    "total_props": entry["total_props"],
                    "ratio": entry["ratio"],
                    "line": entry["line"],
                    "passthrough_props": entry["passthrough_props"],
                    "direct_props": entry["direct_props"],
                },
            )
        )
    return results


def phase_structural(
    path: Path, lang: LangRuntimeContract
) -> tuple[list[Issue], dict[str, int]]:
    structural_results, file_count = _detect_structural_signals(path, lang)
    flat_results, dir_count = _detect_flat_dirs(path, lang)
    props_results, prop_count = _detect_props_bloat(path, lang)
    passthrough_results = _detect_passthrough(path)

    results = structural_results + flat_results + props_results + passthrough_results
    potentials = {
        "structural": adjust_potential(lang.zone_map, file_count),
        "flat_dirs": dir_count,
        "props": max(prop_count, len(passthrough_results)) if prop_count else len(passthrough_results),
    }
    return results, potentials


__all__ = [
    "_detect_flat_dirs",
    "_detect_passthrough",
    "_detect_props_bloat",
    "_detect_structural_signals",
    "phase_structural",
]
