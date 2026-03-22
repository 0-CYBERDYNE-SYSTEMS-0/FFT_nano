"""Graph rendering and normalization helpers for C# dependency detection."""

from __future__ import annotations

import argparse
import json
from collections import defaultdict

from desloppify.base.discovery.file_paths import rel, resolve_path
from desloppify.base.output.terminal import colorize, print_table
from desloppify.engine.detectors.graph import (
    detect_cycles,
    finalize_graph,
    get_coupling_score,
)


def safe_resolve_graph_path(raw_path: str) -> str:
    """Resolve a path for graph keys; keep original when resolution fails."""
    try:
        return resolve_path(raw_path)
    except OSError:
        return raw_path


def build_graph_from_edge_map(edge_map: dict[str, set[str]]) -> dict[str, dict]:
    """Build finalized graph payload from adjacency edge map."""
    graph: dict[str, dict] = defaultdict(lambda: {"imports": set(), "importers": set()})
    for source, imports in edge_map.items():
        graph[source]
        for target in imports:
            if target == source:
                continue
            graph[source]["imports"].add(target)
            graph[target]["importers"].add(source)
    return finalize_graph(dict(graph))


def render_deps_for_graph(args: argparse.Namespace, *, graph: dict[str, dict]) -> None:
    """Show dependency info for one C# file or top coupled files."""
    if getattr(args, "file", None):
        coupling = get_coupling_score(args.file, graph)
        if getattr(args, "json", False):
            print(json.dumps({"file": rel(args.file), **coupling}, indent=2))
            return
        print(colorize(f"\nDependency info: {rel(args.file)}\n", "bold"))
        print(f"  Fan-in (importers):  {coupling['fan_in']}")
        print(f"  Fan-out (imports):   {coupling['fan_out']}")
        print(f"  Instability:         {coupling['instability']}")
        return

    by_importers = sorted(
        graph.items(),
        key=lambda item: (-item[1].get("importer_count", 0), rel(item[0])),
    )
    if getattr(args, "json", False):
        top = by_importers[: getattr(args, "top", 20)]
        print(
            json.dumps(
                {
                    "files": len(graph),
                    "entries": [
                        {
                            "file": rel(filepath),
                            "importers": entry.get("importer_count", 0),
                            "imports": entry.get("import_count", 0),
                        }
                        for filepath, entry in top
                    ],
                },
                indent=2,
            )
        )
        return

    print(colorize(f"\nC# dependency graph: {len(graph)} files\n", "bold"))
    rows = [
        [rel(filepath), str(entry.get("importer_count", 0)), str(entry.get("import_count", 0))]
        for filepath, entry in by_importers[: getattr(args, "top", 20)]
    ]
    if rows:
        print_table(["File", "Importers", "Imports"], rows, [70, 9, 7])


def render_cycles_for_graph(args: argparse.Namespace, *, graph: dict[str, dict]) -> None:
    """Show import cycles in C# source files."""
    cycles, _ = detect_cycles(graph)
    if getattr(args, "json", False):
        print(
            json.dumps(
                {
                    "count": len(cycles),
                    "cycles": [
                        {"length": cycle["length"], "files": [rel(path) for path in cycle["files"]]}
                        for cycle in cycles
                    ],
                },
                indent=2,
            )
        )
        return

    if not cycles:
        print(colorize("No import cycles found.", "green"))
        return

    print(colorize(f"\nImport cycles: {len(cycles)}\n", "bold"))
    for cycle in cycles[: getattr(args, "top", 20)]:
        files = [rel(path) for path in cycle["files"]]
        print(
            f"  [{cycle['length']} files] {' -> '.join(files[:6])}"
            + (f" -> +{len(files) - 6}" if len(files) > 6 else "")
        )
