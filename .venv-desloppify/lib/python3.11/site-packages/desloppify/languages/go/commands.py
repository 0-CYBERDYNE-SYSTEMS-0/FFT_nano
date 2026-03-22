"""Go detect-subcommand registry using canonical framework composition.

Originally contributed by tinker495 (KyuSeok Jung) in PR #128.
"""

from __future__ import annotations

from collections.abc import Callable

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
from desloppify.languages.go.detectors.deps import build_dep_graph
from desloppify.languages.go.extractors import extract_functions, find_go_files
from desloppify.languages.go.phases import GO_COMPLEXITY_SIGNALS

cmd_large = make_cmd_large(
    find_go_files,
    default_threshold=500,
    module_name=__name__,
)
cmd_complexity = make_cmd_complexity(
    find_go_files,
    GO_COMPLEXITY_SIGNALS,
    default_threshold=15,
    module_name=__name__,
)
cmd_deps = make_cmd_deps(
    build_dep_graph_fn=build_dep_graph,
    empty_message="No Go dependencies detected.",
    import_count_label="Imports",
    top_imports_label="Top imports",
    module_name=__name__,
)
cmd_cycles = make_cmd_cycles(build_dep_graph_fn=build_dep_graph, module_name=__name__)
cmd_orphaned = make_cmd_orphaned(
    build_dep_graph_fn=build_dep_graph,
    extensions=[".go"],
    extra_entry_patterns=["/main.go", "/cmd/"],
    extra_barrel_names=set(),
    module_name=__name__,
)
cmd_dupes = make_cmd_dupes(extract_functions_fn=extract_functions, module_name=__name__)


def get_detect_commands() -> dict[str, Callable[..., None]]:
    return compose_detect_registry(
        base_registry=build_standard_detect_registry(
            cmd_deps=cmd_deps,
            cmd_cycles=cmd_cycles,
            cmd_orphaned=cmd_orphaned,
            cmd_dupes=cmd_dupes,
            cmd_large=cmd_large,
            cmd_complexity=cmd_complexity,
        ),
    )
