"""C/C++ detect command registry."""

from __future__ import annotations

import json
import shlex
from collections.abc import Callable
from pathlib import Path

from desloppify.base.discovery.file_paths import rel
from desloppify.base.output.terminal import colorize, print_table
from desloppify.languages._framework.commands.base import (
    make_cmd_complexity,
    make_cmd_large,
)
from desloppify.languages._framework.commands.registry import (
    build_standard_detect_registry,
    compose_detect_registry,
    make_cmd_cycles,
    make_cmd_deps,
    make_cmd_dupes,
    make_cmd_orphaned,
)
from desloppify.languages._framework.generic_parts.parsers import PARSERS
from desloppify.languages._framework.generic_parts.tool_runner import run_tool_result
from desloppify.languages.cxx._helpers import build_cxx_dep_graph
from desloppify.languages.cxx.extractors import CXX_EXTENSIONS, CXX_SOURCE_EXTENSIONS, extract_all_cxx_functions, find_cxx_files
from desloppify.languages.cxx.phases import CXX_COMPLEXITY_SIGNALS

cmd_large = make_cmd_large(
    find_cxx_files,
    default_threshold=500,
    module_name=__name__,
)
cmd_complexity = make_cmd_complexity(
    find_cxx_files,
    CXX_COMPLEXITY_SIGNALS,
    default_threshold=15,
    module_name=__name__,
)
cmd_deps = make_cmd_deps(
    build_dep_graph_fn=build_cxx_dep_graph,
    empty_message="No C/C++ dependencies detected.",
    import_count_label="Includes",
    top_imports_label="Top includes",
    module_name=__name__,
)
cmd_cycles = make_cmd_cycles(build_dep_graph_fn=build_cxx_dep_graph, module_name=__name__)
cmd_orphaned = make_cmd_orphaned(
    build_dep_graph_fn=build_cxx_dep_graph,
    extensions=CXX_EXTENSIONS,
    extra_entry_patterns=["/main.c", "/main.cc", "/main.cpp", "/main.cxx"],
    extra_barrel_names=set(),
    module_name=__name__,
)
cmd_dupes = make_cmd_dupes(
    extract_functions_fn=extract_all_cxx_functions,
    module_name=__name__,
)


def _emit_tool_entries(args, *, label: str, result) -> None:
    if getattr(args, "json", False):
        print(
            json.dumps(
                {
                    "count": len(result.entries),
                    "entries": result.entries,
                    "status": result.status,
                    "error_kind": result.error_kind,
                },
                indent=2,
            )
        )
        return

    if result.status == "error":
        message = result.message or f"{label} failed"
        print(colorize(f"\n{label}: {message}", "yellow"))
        return

    if not result.entries:
        print(colorize(f"\nNo {label} findings.", "green"))
        return

    print(colorize(f"\n{label}: {len(result.entries)} findings\n", "bold"))
    top = getattr(args, "top", 20)
    rows = [
        [rel(entry["file"]), str(entry["line"]), entry["message"]]
        for entry in result.entries[:top]
    ]
    print_table(["File", "Line", "Message"], rows, [60, 6, 70])


def cmd_cppcheck(args) -> None:
    result = run_tool_result(
        "cppcheck --template='{file}:{line}: {severity}: {message}' --enable=all --quiet .",
        Path(args.path),
        PARSERS["gnu"],
    )
    _emit_tool_entries(args, label="cppcheck", result=result)


def cmd_clang_tidy(args) -> None:
    scan_root = Path(args.path)
    files = [
        filepath
        for filepath in find_cxx_files(scan_root)
        if Path(filepath).suffix.lower() in set(CXX_SOURCE_EXTENSIONS)
    ]
    if not files:
        _emit_tool_entries(
            args,
            label="clang-tidy",
            result=type(
                "_EmptyToolResult",
                (),
                {"entries": [], "status": "empty", "error_kind": None, "message": None},
            )(),
        )
        return

    file_args = " ".join(
        shlex.quote(str(Path(filepath).resolve().relative_to(scan_root.resolve())).replace("\\", "/"))
        for filepath in files
    )
    result = run_tool_result(
        f"clang-tidy -p . --quiet {file_args}",
        scan_root,
        PARSERS["gnu"],
    )
    _emit_tool_entries(args, label="clang-tidy", result=result)


def get_detect_commands() -> dict[str, Callable[..., None]]:
    """Return the canonical detect command registry for C/C++."""
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
            "cppcheck": cmd_cppcheck,
            "clang_tidy": cmd_clang_tidy,
        },
    )
