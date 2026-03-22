"""Basic TypeScript detector phase runners."""

from __future__ import annotations

from collections import defaultdict
from pathlib import Path

from desloppify.base.output.terminal import log
from desloppify.engine._state.filtering import make_issue
from desloppify.engine.policy.zones import adjust_potential
from desloppify.languages._framework.base.types import LangRuntimeContract
from desloppify.languages._framework.issue_factories import make_unused_issues
import desloppify.languages.typescript.detectors.deprecated as deprecated_detector_mod
import desloppify.languages.typescript.detectors.exports as exports_detector_mod
import desloppify.languages.typescript.detectors.logs as logs_detector_mod
import desloppify.languages.typescript.detectors.unused as unused_detector_mod
from desloppify.state_io import Issue


def phase_logs(path: Path, lang: LangRuntimeContract) -> tuple[list[Issue], dict[str, int]]:
    log_result = logs_detector_mod.detect_logs(path)
    log_entries = log_result.entries
    total_files = log_result.population_size
    log_groups: dict[tuple, list] = defaultdict(list)
    for entry in log_entries:
        log_groups[(entry["file"], entry["tag"])].append(entry)

    results = []
    for (file, tag), entries in log_groups.items():
        results.append(
            make_issue(
                "logs",
                file,
                tag,
                tier=1,
                confidence="high",
                summary=f"{len(entries)} tagged logs [{tag}]",
                detail={
                    "count": len(entries),
                    "lines": [entry["line"] for entry in entries[:20]],
                },
            )
        )
    log(f"         {len(log_entries)} instances → {len(results)} issues")
    return results, {"logs": adjust_potential(lang.zone_map, total_files)}


def phase_unused(path: Path, lang: LangRuntimeContract) -> tuple[list[Issue], dict[str, int]]:
    entries, total_files = unused_detector_mod.detect_unused(path)
    return make_unused_issues(entries, log), {
        "unused": adjust_potential(lang.zone_map, total_files),
    }


def phase_exports(path: Path, lang: LangRuntimeContract) -> tuple[list[Issue], dict[str, int]]:
    export_entries, total_exports = exports_detector_mod.detect_dead_exports(path)
    results = []
    for entry in export_entries:
        results.append(
            make_issue(
                "exports",
                entry["file"],
                entry["name"],
                tier=2,
                confidence="high",
                summary=f"Dead export: {entry['name']}",
                detail={"line": entry.get("line"), "kind": entry.get("kind")},
            )
        )
    log(f"         {len(export_entries)} instances → {len(results)} issues")
    return results, {"exports": total_exports}


def phase_deprecated(
    path: Path, lang: LangRuntimeContract
) -> tuple[list[Issue], dict[str, int]]:
    dep_result = deprecated_detector_mod.detect_deprecated_result(path)
    dep_entries = dep_result.entries
    total_deprecated = dep_result.population_size
    results = []
    for entry in dep_entries:
        if entry["kind"] == "property":
            continue
        tier = 1 if entry["importers"] == 0 else 3
        results.append(
            make_issue(
                "deprecated",
                entry["file"],
                entry["symbol"],
                tier=tier,
                confidence="high",
                summary=f"Deprecated: {entry['symbol']} ({entry['importers']} importers)"
                + (" → safe to delete" if entry["importers"] == 0 else ""),
                detail={"importers": entry["importers"], "line": entry["line"]},
            )
        )
    log(
        f"         {len(dep_entries)} instances → {len(results)} issues (properties suppressed)"
    )
    return results, {"deprecated": total_deprecated}


__all__ = [
    "phase_deprecated",
    "phase_exports",
    "phase_logs",
    "phase_unused",
]
