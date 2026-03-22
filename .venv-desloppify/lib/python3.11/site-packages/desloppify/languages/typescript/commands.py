"""Canonical TypeScript detector CLI and command-registry surface."""

from __future__ import annotations

import argparse
import json
from collections.abc import Callable
from pathlib import Path

from desloppify.base.discovery.file_paths import rel
from desloppify.base.discovery.paths import get_src_path
from desloppify.base.discovery.source import find_ts_and_tsx_files
from desloppify.base.output.terminal import colorize, display_entries, print_table
from desloppify.engine.detectors import coupling as coupling_detector_mod
from desloppify.engine.detectors import dupes as dupes_detector_mod
from desloppify.engine.detectors import gods as gods_detector_mod
from desloppify.engine.detectors import orphaned as orphaned_detector_mod
from desloppify.languages._framework.commands.base import (
    make_cmd_complexity,
    make_cmd_facade,
    make_cmd_large,
    make_cmd_naming,
    make_cmd_passthrough,
    make_cmd_single_use,
    make_cmd_smells,
)
from desloppify.languages._framework.commands.registry import (
    build_standard_detect_registry,
    compose_detect_registry,
)
from desloppify.languages.typescript.detectors.deps import (
    build_dep_graph,
    build_dynamic_import_targets,
    ts_alias_resolver,
)
from desloppify.languages.typescript.detectors.facade import detect_reexport_facades
from desloppify.languages.typescript.detectors.smells import detect_smells
from desloppify.languages.typescript.detectors.concerns import cmd_concerns
from desloppify.languages.typescript.detectors.deprecated import cmd_deprecated
from desloppify.languages.typescript.detectors.deps import cmd_cycles, cmd_deps
from desloppify.languages.typescript.detectors.exports import cmd_exports
from desloppify.languages.typescript.detectors.logs import cmd_logs
from desloppify.languages.typescript.detectors.patterns.cli import cmd_patterns
from desloppify.languages.typescript.detectors.props import cmd_props
from desloppify.languages.typescript.detectors.react.cli import cmd_react
from desloppify.languages.typescript.detectors.unused import cmd_unused
from desloppify.languages.typescript.extractors_components import (
    detect_passthrough_components,
    extract_ts_components,
)
from desloppify.languages.typescript.extractors_functions import extract_ts_functions
from desloppify.languages.typescript.phases_config import (
    TS_COMPLEXITY_SIGNALS,
    TS_GOD_RULES,
    TS_SKIP_DIRS,
    TS_SKIP_NAMES,
)
from desloppify.languages.typescript.plugin_contract import TS_BARREL_NAMES, TS_LARGE_THRESHOLD


cmd_large = make_cmd_large(
    find_ts_and_tsx_files,
    default_threshold=TS_LARGE_THRESHOLD,
    module_name=__name__,
)
cmd_complexity = make_cmd_complexity(
    find_ts_and_tsx_files,
    TS_COMPLEXITY_SIGNALS,
    module_name=__name__,
)
cmd_single_use = make_cmd_single_use(
    build_dep_graph,
    barrel_names=TS_BARREL_NAMES,
    module_name=__name__,
)
cmd_passthrough = make_cmd_passthrough(
    detect_passthrough_components,
    noun="component",
    name_key="component",
    total_key="total_props",
    module_name=__name__,
)
cmd_naming = make_cmd_naming(
    find_ts_and_tsx_files,
    skip_names=TS_SKIP_NAMES,
    skip_dirs=TS_SKIP_DIRS,
    module_name=__name__,
)
cmd_smells = make_cmd_smells(
    detect_smells,
    module_name=__name__,
)
cmd_facade = make_cmd_facade(
    build_dep_graph,
    detect_facades_fn=detect_reexport_facades,
    module_name=__name__,
)


def cmd_gods(args: argparse.Namespace) -> None:
    entries, _ = gods_detector_mod.detect_gods(
        extract_ts_components(Path(args.path)), TS_GOD_RULES
    )
    display_entries(
        args,
        entries,
        label="God components",
        empty_msg="No god components found.",
        columns=["File", "LOC", "Hooks", "Why"],
        widths=[55, 5, 6, 45],
        row_fn=lambda e: [
            rel(e["file"]),
            str(e["loc"]),
            str(e["detail"].get("hook_total", 0)),
            ", ".join(e["reasons"]),
        ],
    )


def cmd_orphaned(args: argparse.Namespace) -> None:
    graph = build_dep_graph(Path(args.path))
    entries, _ = orphaned_detector_mod.detect_orphaned_files(
        Path(args.path),
        graph,
        extensions=[".ts", ".tsx"],
        options=orphaned_detector_mod.OrphanedDetectionOptions(
            dynamic_import_finder=build_dynamic_import_targets,
            alias_resolver=ts_alias_resolver,
        ),
    )
    if getattr(args, "json", False):
        print(
            json.dumps(
                {
                    "count": len(entries),
                    "entries": [
                        {"file": rel(e["file"]), "loc": e["loc"]} for e in entries
                    ],
                },
                indent=2,
            )
        )
        return
    if not entries:
        print(colorize("\nNo orphaned files found.", "green"))
        return
    total_loc = sum(e["loc"] for e in entries)
    print(colorize(f"\nOrphaned files: {len(entries)} files, {total_loc} LOC\n", "bold"))
    top = getattr(args, "top", 20)
    rows = [[rel(e["file"]), str(e["loc"])] for e in entries[:top]]
    print_table(["File", "LOC"], rows, [80, 6])
    if len(entries) > top:
        print(f"\n  ... and {len(entries) - top} more")


def cmd_dupes(args: argparse.Namespace) -> None:
    functions = []
    for filepath in find_ts_and_tsx_files(Path(args.path)):
        if "node_modules" in filepath or ".d.ts" in filepath:
            continue
        functions.extend(extract_ts_functions(filepath))
    entries, _ = dupes_detector_mod.detect_duplicates(
        functions, threshold=getattr(args, "threshold", None) or 0.8
    )
    if getattr(args, "json", False):
        print(json.dumps({"count": len(entries), "entries": entries}, indent=2))
        return
    if not entries:
        print(colorize("No duplicate functions found.", "green"))
        return
    exact = [e for e in entries if e["kind"] == "exact"]
    near = [e for e in entries if e["kind"] == "near-duplicate"]
    if exact:
        print(colorize(f"\nExact duplicates: {len(exact)} pairs\n", "bold"))
        rows = []
        for entry in exact[: getattr(args, "top", 20)]:
            fn_a, fn_b = entry["fn_a"], entry["fn_b"]
            rows.append(
                [
                    f"{fn_a['name']} ({rel(fn_a['file'])}:{fn_a['line']})",
                    f"{fn_b['name']} ({rel(fn_b['file'])}:{fn_b['line']})",
                    str(fn_a["loc"]),
                ]
            )
        print_table(["Function A", "Function B", "LOC"], rows, [50, 50, 5])
    if near:
        print(
            colorize(
                f"\nNear-duplicates (>={getattr(args, 'threshold', 0.8):.0%} similar): {len(near)} pairs\n",
                "bold",
            )
        )
        rows = []
        for entry in near[: getattr(args, "top", 20)]:
            fn_a, fn_b = entry["fn_a"], entry["fn_b"]
            rows.append(
                [
                    f"{fn_a['name']} ({rel(fn_a['file'])}:{fn_a['line']})",
                    f"{fn_b['name']} ({rel(fn_b['file'])}:{fn_b['line']})",
                    f"{entry['similarity']:.0%}",
                ]
            )
        print_table(["Function A", "Function B", "Sim"], rows, [50, 50, 5])


def cmd_coupling(args: argparse.Namespace) -> None:
    graph = build_dep_graph(Path(args.path))
    src_path = get_src_path()
    shared_prefix = f"{src_path}/shared/"
    tools_prefix = f"{src_path}/tools/"
    violations, _ = coupling_detector_mod.detect_coupling_violations(
        Path(args.path), graph, shared_prefix=shared_prefix, tools_prefix=tools_prefix
    )
    candidates, _ = coupling_detector_mod.detect_boundary_candidates(
        Path(args.path),
        graph,
        shared_prefix=shared_prefix,
        tools_prefix=tools_prefix,
        skip_basenames={"index.ts", "index.tsx"},
    )
    if getattr(args, "json", False):
        print(
            json.dumps(
                {
                    "violations": len(violations),
                    "boundary_candidates": len(candidates),
                    "coupling_violations": violations,
                    "boundary_candidates_detail": [
                        {**entry, "file": rel(entry["file"])} for entry in candidates
                    ],
                },
                indent=2,
            )
        )
        return
    if violations:
        print(colorize(f"\nCoupling violations (shared -> tools): {len(violations)}\n", "bold"))
        rows = []
        for entry in violations[: getattr(args, "top", 20)]:
            rows.append([rel(entry["file"]), entry["target"], entry["tool"]])
        print_table(["Shared File", "Imports From", "Tool"], rows, [50, 50, 20])
    else:
        print(colorize("\nNo coupling violations (shared -> tools).", "green"))

    cross_tool, _ = coupling_detector_mod.detect_cross_tool_imports(
        Path(args.path), graph, tools_prefix=tools_prefix
    )
    print()
    if cross_tool:
        print(colorize(f"Cross-tool imports (tools -> tools): {len(cross_tool)}\n", "bold"))
        rows = []
        for entry in cross_tool[: getattr(args, "top", 20)]:
            rows.append(
                [
                    rel(entry["file"]),
                    entry["target"],
                    f"{entry['source_tool']}->{entry['target_tool']}",
                ]
            )
        print_table(["Source File", "Imports From", "Direction"], rows, [50, 50, 20])
    else:
        print(colorize("No cross-tool imports.", "green"))

    print()
    if candidates:
        print(
            colorize(
                f"Boundary candidates (shared files used by 1 tool): {len(candidates)}\n",
                "bold",
            )
        )
        rows = []
        for entry in candidates[: getattr(args, "top", 20)]:
            rows.append(
                [
                    rel(entry["file"]),
                    str(entry["loc"]),
                    entry["sole_tool"],
                    str(entry["importer_count"]),
                ]
            )
        print_table(
            ["Shared File", "LOC", "Only Used By", "Importers"],
            rows,
            [50, 5, 30, 9],
        )
    else:
        print(colorize("No boundary candidates found.", "green"))
    print()


def get_detect_commands() -> dict[str, Callable[..., None]]:
    """Build the TypeScript detector command registry."""
    return compose_detect_registry(
        base_registry=build_standard_detect_registry(
            cmd_deps=cmd_deps,
            cmd_cycles=cmd_cycles,
            cmd_orphaned=cmd_orphaned,
            cmd_dupes=cmd_dupes,
            cmd_large=cmd_large,
            cmd_complexity=cmd_complexity,
        ),
        extra_registry={
            "logs": cmd_logs,
            "unused": cmd_unused,
            "exports": cmd_exports,
            "deprecated": cmd_deprecated,
            "gods": cmd_gods,
            "single_use": cmd_single_use,
            "props": cmd_props,
            "passthrough": cmd_passthrough,
            "concerns": cmd_concerns,
            "smells": cmd_smells,
            "coupling": cmd_coupling,
            "patterns": cmd_patterns,
            "naming": cmd_naming,
            "react": cmd_react,
            "facade": cmd_facade,
        },
    )


__all__ = [
    "cmd_complexity",
    "cmd_concerns",
    "cmd_coupling",
    "cmd_cycles",
    "cmd_deprecated",
    "cmd_deps",
    "cmd_dupes",
    "cmd_exports",
    "cmd_facade",
    "cmd_gods",
    "cmd_large",
    "cmd_logs",
    "cmd_naming",
    "cmd_orphaned",
    "cmd_passthrough",
    "cmd_patterns",
    "cmd_props",
    "cmd_react",
    "cmd_single_use",
    "cmd_smells",
    "cmd_unused",
    "get_detect_commands",
]
