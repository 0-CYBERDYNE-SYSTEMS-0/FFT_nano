"""Shared command factories for graph-backed detect commands."""

from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path
from typing import TYPE_CHECKING, Any

from desloppify.base.discovery.file_paths import rel
from desloppify.base.output.terminal import colorize, print_table
from desloppify.engine.detectors.dupes import detect_duplicates
from desloppify.engine.detectors.graph import detect_cycles
from desloppify.engine.detectors.orphaned import (
    OrphanedDetectionOptions,
    detect_orphaned_files,
)

if TYPE_CHECKING:
    import argparse


def _set_module(fn: Callable[..., Any], module_name: str | None) -> Callable[..., Any]:
    """Set ``fn.__module__`` from an explicit module name."""
    if module_name is not None:
        fn.__module__ = module_name
    return fn


def build_standard_detect_registry(
    *,
    cmd_deps: Callable[[argparse.Namespace], None],
    cmd_cycles: Callable[[argparse.Namespace], None],
    cmd_orphaned: Callable[[argparse.Namespace], None],
    cmd_dupes: Callable[[argparse.Namespace], None],
    cmd_large: Callable[[argparse.Namespace], None],
    cmd_complexity: Callable[[argparse.Namespace], None],
) -> dict[str, Callable[[argparse.Namespace], None]]:
    """Build the shared detect command mapping used by language plugins."""
    return {
        "deps": cmd_deps,
        "cycles": cmd_cycles,
        "orphaned": cmd_orphaned,
        "dupes": cmd_dupes,
        "large": cmd_large,
        "complexity": cmd_complexity,
    }


def compose_detect_registry(
    *,
    base_registry: dict[str, Callable[[argparse.Namespace], None]],
    extra_registry: dict[str, Callable[[argparse.Namespace], None]] | None = None,
) -> dict[str, Callable[[argparse.Namespace], None]]:
    """Compose a plugin detect registry from standard base + language extras."""
    registry = dict(base_registry)
    if extra_registry:
        registry.update(extra_registry)
    return registry


def build_composed_detect_registry(
    *,
    cmd_deps: Callable[[argparse.Namespace], None],
    cmd_cycles: Callable[[argparse.Namespace], None],
    cmd_orphaned: Callable[[argparse.Namespace], None],
    cmd_dupes: Callable[[argparse.Namespace], None],
    cmd_large: Callable[[argparse.Namespace], None],
    cmd_complexity: Callable[[argparse.Namespace], None],
    extra_registry: dict[str, Callable[[argparse.Namespace], None]] | None = None,
) -> dict[str, Callable[[argparse.Namespace], None]]:
    """Build the standard detect registry and apply optional extras."""
    return compose_detect_registry(
        base_registry=build_standard_detect_registry(
            cmd_deps=cmd_deps,
            cmd_cycles=cmd_cycles,
            cmd_orphaned=cmd_orphaned,
            cmd_dupes=cmd_dupes,
            cmd_large=cmd_large,
            cmd_complexity=cmd_complexity,
        ),
        extra_registry=extra_registry,
    )


def make_cmd_deps(
    *,
    build_dep_graph_fn: Callable[..., Any],
    empty_message: str,
    import_count_label: str,
    top_imports_label: str,
    module_name: str | None = None,
) -> Callable[[argparse.Namespace], None]:
    """Build a deps command for lightweight graph-backed languages."""

    def cmd_deps(args: argparse.Namespace) -> None:
        graph = build_dep_graph_fn(Path(args.path))
        rows = [
            {
                "file": rel(filepath),
                "import_count": entry.get("import_count", 0),
                "importer_count": entry.get("importer_count", 0),
                "imports": [rel(imp) for imp in sorted(entry.get("imports", set()))],
            }
            for filepath, entry in graph.items()
        ]
        rows.sort(key=lambda row: (-row["import_count"], row["file"]))

        if getattr(args, "json", False):
            print(json.dumps({"count": len(rows), "entries": rows}, indent=2))
            return

        if not rows:
            print(colorize(f"\n{empty_message}", "green"))
            return

        print(colorize(f"\nDependency graph: {len(rows)} files\n", "bold"))
        top = getattr(args, "top", 20)
        table_rows = [
            [
                row["file"],
                str(row["import_count"]),
                str(row["importer_count"]),
                ", ".join(row["imports"][:3]) + (" ..." if len(row["imports"]) > 3 else ""),
            ]
            for row in rows[:top]
        ]
        print_table(
            ["File", import_count_label, "Importers", top_imports_label],
            table_rows,
            [56, 8, 9, 45],
        )

    return _set_module(cmd_deps, module_name)


def make_cmd_cycles(
    *, build_dep_graph_fn, module_name: str | None = None
) -> Callable[[argparse.Namespace], None]:
    """Build a cycles command using a dependency graph builder."""

    def cmd_cycles(args: argparse.Namespace) -> None:
        graph = build_dep_graph_fn(Path(args.path))
        entries, _ = detect_cycles(graph)

        if getattr(args, "json", False):
            print(json.dumps({"count": len(entries), "entries": entries}, indent=2))
            return

        if not entries:
            print(colorize("\nNo dependency cycles found.", "green"))
            return

        print(colorize(f"\nCycles: {len(entries)}\n", "bold"))
        top = getattr(args, "top", 20)
        rows = [
            [str(entry["length"]), ", ".join(rel(path) for path in entry["files"][:4])]
            for entry in entries[:top]
        ]
        print_table(["Length", "Files"], rows, [8, 95])

    return _set_module(cmd_cycles, module_name)


def make_cmd_orphaned(
    *,
    build_dep_graph_fn,
    extensions: list[str],
    extra_entry_patterns: list[str],
    extra_barrel_names: set[str],
    module_name: str | None = None,
) -> Callable[[argparse.Namespace], None]:
    """Build an orphaned-file command for language-specific roots/barrels."""

    def cmd_orphaned(args: argparse.Namespace) -> None:
        graph = build_dep_graph_fn(Path(args.path))
        entries, _ = detect_orphaned_files(
            Path(args.path),
            graph,
            extensions=extensions,
            options=OrphanedDetectionOptions(
                extra_entry_patterns=extra_entry_patterns,
                extra_barrel_names=extra_barrel_names,
            ),
        )

        if getattr(args, "json", False):
            print(
                json.dumps(
                    {
                        "count": len(entries),
                        "entries": [
                            {"file": rel(entry["file"]), "loc": entry["loc"]}
                            for entry in entries
                        ],
                    },
                    indent=2,
                )
            )
            return

        if not entries:
            print(colorize("\nNo orphaned files found.", "green"))
            return

        total_loc = sum(entry["loc"] for entry in entries)
        print(colorize(f"\nOrphaned files: {len(entries)} files, {total_loc} LOC\n", "bold"))
        top = getattr(args, "top", 20)
        rows = [[rel(entry["file"]), str(entry["loc"])] for entry in entries[:top]]
        print_table(["File", "LOC"], rows, [85, 6])

    return _set_module(cmd_orphaned, module_name)


def make_cmd_dupes(
    *, extract_functions_fn, module_name: str | None = None
) -> Callable[[argparse.Namespace], None]:
    """Build a duplicate-function command from an extractor."""

    def cmd_dupes(args: argparse.Namespace) -> None:
        functions = extract_functions_fn(Path(args.path))
        entries, _ = detect_duplicates(
            functions,
            threshold=getattr(args, "threshold", None) or 0.8,
        )

        if getattr(args, "json", False):
            print(json.dumps({"count": len(entries), "entries": entries}, indent=2))
            return

        if not entries:
            print(colorize("No duplicate functions found.", "green"))
            return

        print(colorize(f"\nDuplicate functions: {len(entries)} pairs\n", "bold"))
        top = getattr(args, "top", 20)
        rows = []
        for entry in entries[:top]:
            fn_a, fn_b = entry["fn_a"], entry["fn_b"]
            rows.append(
                [
                    f"{fn_a['name']} ({rel(fn_a['file'])}:{fn_a['line']})",
                    f"{fn_b['name']} ({rel(fn_b['file'])}:{fn_b['line']})",
                    f"{entry['similarity']:.0%}",
                    entry["kind"],
                ]
            )
        print_table(["Function A", "Function B", "Sim", "Kind"], rows, [40, 40, 5, 14])

    return _set_module(cmd_dupes, module_name)


__all__ = [
    "build_composed_detect_registry",
    "build_standard_detect_registry",
    "compose_detect_registry",
    "make_cmd_cycles",
    "make_cmd_deps",
    "make_cmd_dupes",
    "make_cmd_orphaned",
]
