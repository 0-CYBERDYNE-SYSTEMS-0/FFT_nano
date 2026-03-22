"""Extracted heavy phase implementations for Python language pipeline."""

from __future__ import annotations

from pathlib import Path

from desloppify.engine.detectors import complexity as complexity_detector_mod
from desloppify.engine.detectors import flat_dirs as flat_dirs_detector_mod
from desloppify.engine.detectors import gods as gods_detector_mod
from desloppify.engine.detectors import graph as graph_detector_mod
from desloppify.engine.detectors import large as large_detector_mod
from desloppify.engine.detectors import orphaned as orphaned_detector_mod
from desloppify.engine.detectors import single_use as single_use_detector_mod
from desloppify.engine.detectors.base import ComplexitySignal, GodRule
from desloppify.engine._state.filtering import make_issue
from desloppify.engine.policy.zones import adjust_potential, filter_entries
from desloppify.languages._framework.base.structural import (
    add_structural_signal,
    merge_structural_signals,
)
from desloppify.languages._framework.issue_factories import (
    make_cycle_issues,
    make_facade_issues,
    make_orphaned_issues,
    make_passthrough_issues,
    make_single_use_issues,
)
from desloppify.languages._framework.runtime_support.runtime import LangRun
from desloppify.languages.python.detectors import (
    coupling_contracts as coupling_contracts_detector_mod,
)
from desloppify.languages.python.detectors import deps as deps_detector_mod
from desloppify.languages.python.detectors import facade as facade_detector_mod
from desloppify.languages.python.extractors import detect_passthrough_functions
from desloppify.languages.python.extractors_classes import extract_py_classes
from desloppify.state_io import Issue


def run_phase_structural(
    path: Path,
    lang: LangRun,
    *,
    complexity_signals: list[ComplexitySignal],
    god_rules: list[GodRule],
    log_fn,
) -> tuple[list[Issue], dict[str, int]]:
    """Merge large + complexity + god classes into structural issues."""
    structural: dict[str, dict] = {}

    large_entries, file_count = large_detector_mod.detect_large_files(
        path, file_finder=lang.file_finder, threshold=lang.large_threshold
    )
    for entry in large_entries:
        add_structural_signal(
            structural,
            entry["file"],
            f"large ({entry['loc']} LOC)",
            {"loc": entry["loc"]},
        )

    complexity_entries, _ = complexity_detector_mod.detect_complexity(
        path,
        signals=complexity_signals,
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

    god_entries, _ = gods_detector_mod.detect_gods(extract_py_classes(path), god_rules)
    for entry in god_entries:
        add_structural_signal(
            structural,
            entry["file"],
            entry["signal_text"],
            entry["detail"],
        )

    results = merge_structural_signals(structural, log_fn)

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
        log_fn(
            f"         flat dirs: {len(flat_entries)} overloaded directories "
            "(files/subdirs/combined)"
        )

    passthrough_entries = detect_passthrough_functions(path)
    results.extend(
        make_passthrough_issues(
            passthrough_entries,
            "function",
            "total_params",
            log_fn,
        )
    )

    potentials = {
        "structural": adjust_potential(lang.zone_map, file_count),
        "flat_dirs": dir_count,
        "props": len(passthrough_entries) if passthrough_entries else 0,
    }
    return results, potentials


def run_phase_coupling(path: Path, lang: LangRun, *, log_fn) -> tuple[list[Issue], dict[str, int]]:
    """Run coupling-related detectors and return issues/potentials."""
    graph = deps_detector_mod.build_dep_graph(path)
    lang.dep_graph = graph
    zone_map = lang.zone_map

    single_entries, single_candidates = (
        single_use_detector_mod.detect_single_use_abstractions(
            path, graph, barrel_names=lang.barrel_names
        )
    )
    single_entries = filter_entries(zone_map, single_entries, "single_use")
    results = make_single_use_issues(
        single_entries, lang.get_area, skip_dir_names={"commands"}, stderr_fn=log_fn
    )

    cycle_entries, _ = graph_detector_mod.detect_cycles(graph)
    cycle_entries = filter_entries(zone_map, cycle_entries, "cycles", file_key="files")
    results.extend(make_cycle_issues(cycle_entries, log_fn))

    orphan_entries, total_graph_files = orphaned_detector_mod.detect_orphaned_files(
        path,
        graph,
        extensions=lang.extensions,
        options=orphaned_detector_mod.OrphanedDetectionOptions(
            extra_entry_patterns=lang.entry_patterns,
            extra_barrel_names=lang.barrel_names,
            dynamic_import_finder=deps_detector_mod.find_python_dynamic_imports,
        ),
    )
    orphan_entries = filter_entries(zone_map, orphan_entries, "orphaned")
    results.extend(make_orphaned_issues(orphan_entries, log_fn))

    facade_entries, _ = facade_detector_mod.detect_reexport_facades(graph)
    facade_entries = filter_entries(zone_map, facade_entries, "facade")
    results.extend(make_facade_issues(facade_entries, log_fn))

    mixin_entries, coupling_candidates = (
        coupling_contracts_detector_mod.detect_implicit_mixin_contracts(path)
    )
    mixin_entries = filter_entries(zone_map, mixin_entries, "coupling")
    for entry in mixin_entries:
        attr_preview = ", ".join(entry["required_attrs"][:4])
        if len(entry["required_attrs"]) > 4:
            attr_preview += f", +{len(entry['required_attrs']) - 4} more"
        required_count = entry["required_count"]
        tier = 4 if required_count >= 6 else 3
        confidence = "high" if required_count >= 6 else "medium"
        results.append(
            make_issue(
                "coupling",
                entry["file"],
                entry["class"],
                tier=tier,
                confidence=confidence,
                summary=(
                    f"Implicit host contract: {entry['class']} depends on {required_count} "
                    f"undeclared self attrs ({attr_preview})"
                ),
                detail={
                    "subtype": "implicit_mixin_contract",
                    "required_attrs": entry["required_attrs"],
                    "required_count": required_count,
                    "line": entry.get("line"),
                },
            )
        )

    log_fn(f"         -> {len(results)} coupling/structural issues total")
    potentials = {
        "single_use": adjust_potential(zone_map, single_candidates),
        "cycles": adjust_potential(zone_map, total_graph_files),
        "orphaned": adjust_potential(zone_map, total_graph_files),
        "facade": adjust_potential(zone_map, total_graph_files),
        "coupling": adjust_potential(zone_map, coupling_candidates),
    }
    return results, potentials


__all__ = ["run_phase_coupling", "run_phase_structural"]
