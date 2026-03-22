"""Dart detect-subcommand registry using canonical framework composition."""

from __future__ import annotations

from collections.abc import Callable

from desloppify.languages._framework.commands.base import (
    make_cmd_complexity,
    make_cmd_large,
)
from desloppify.languages._framework.commands.registry import (
    build_composed_detect_registry,
    make_cmd_cycles,
    make_cmd_deps,
    make_cmd_dupes,
    make_cmd_orphaned,
)
from desloppify.languages.dart.detectors.deps import build_dep_graph
from desloppify.languages.dart.extractors import extract_functions, find_dart_files
from desloppify.languages.dart.phases import DART_COMPLEXITY_SIGNALS

cmd_large = make_cmd_large(
    find_dart_files,
    default_threshold=500,
    module_name=__name__,
)
cmd_complexity = make_cmd_complexity(
    find_dart_files,
    DART_COMPLEXITY_SIGNALS,
    default_threshold=16,
    module_name=__name__,
)
cmd_deps = make_cmd_deps(
    build_dep_graph_fn=build_dep_graph,
    empty_message="No Dart dependencies detected.",
    import_count_label="Imports",
    top_imports_label="Top imports",
    module_name=__name__,
)
cmd_cycles = make_cmd_cycles(build_dep_graph_fn=build_dep_graph, module_name=__name__)
cmd_orphaned = make_cmd_orphaned(
    build_dep_graph_fn=build_dep_graph,
    extensions=[".dart"],
    extra_entry_patterns=[
        "/main.dart",
        "/bin/",
        "/tool/",
        "/web/",
        "/test/",
        "/integration_test/",
    ],
    extra_barrel_names={"index.dart"},
    module_name=__name__,
)
cmd_dupes = make_cmd_dupes(extract_functions_fn=extract_functions, module_name=__name__)


def get_detect_commands() -> dict[str, Callable[..., None]]:
    return build_composed_detect_registry(
        cmd_deps=cmd_deps,
        cmd_cycles=cmd_cycles,
        cmd_orphaned=cmd_orphaned,
        cmd_dupes=cmd_dupes,
        cmd_large=cmd_large,
        cmd_complexity=cmd_complexity,
    )
