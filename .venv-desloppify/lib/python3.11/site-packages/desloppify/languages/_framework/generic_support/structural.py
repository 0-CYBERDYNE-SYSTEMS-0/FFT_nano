"""Structural/coupling phase builders for generic language plugins."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import TYPE_CHECKING, Callable

from desloppify.languages._framework.base.types import DetectorPhase
from desloppify.languages._framework.treesitter import (
    PARSE_INIT_ERRORS as _TS_INIT_ERRORS,
)

if TYPE_CHECKING:
    from desloppify.languages._framework.base.types import LangRuntimeContract
    from desloppify.languages._framework.treesitter import TreeSitterLangSpec
    from desloppify.state_io import Issue

logger = logging.getLogger(__name__)


def _make_structural_phase(
    treesitter_spec: TreeSitterLangSpec | None = None,
) -> DetectorPhase:
    """Create a structural analysis phase for generic plugins."""
    from desloppify.base.output.terminal import log
    from desloppify.engine.detectors.base import ComplexitySignal

    signals = [
        ComplexitySignal(
            "TODOs",
            r"(?://|#|--|/\*)\s*(?:TODO|FIXME|HACK|XXX)",
            weight=2,
            threshold=0,
        ),
    ]

    if treesitter_spec is not None:
        from desloppify.languages._framework.treesitter import is_available

        if is_available():
            from desloppify.languages._framework.treesitter.analysis.complexity_function_metrics import (
                make_cyclomatic_complexity_compute,
                make_long_functions_compute,
                make_max_params_compute,
            )
            from desloppify.languages._framework.treesitter.analysis.complexity_nesting import (
                make_callback_depth_compute,
                make_nesting_depth_compute,
            )

            signals.append(
                ComplexitySignal(
                    "nesting_depth",
                    None,
                    weight=3,
                    threshold=4,
                    compute=make_nesting_depth_compute(treesitter_spec),
                )
            )
            signals.append(
                ComplexitySignal(
                    "long_functions",
                    None,
                    weight=3,
                    threshold=80,
                    compute=make_long_functions_compute(treesitter_spec),
                )
            )
            signals.append(
                ComplexitySignal(
                    "cyclomatic_complexity",
                    None,
                    weight=2,
                    threshold=15,
                    compute=make_cyclomatic_complexity_compute(treesitter_spec),
                )
            )
            signals.append(
                ComplexitySignal(
                    "many_params",
                    None,
                    weight=2,
                    threshold=7,
                    compute=make_max_params_compute(treesitter_spec),
                )
            )
            signals.append(
                ComplexitySignal(
                    "callback_depth",
                    None,
                    weight=2,
                    threshold=3,
                    compute=make_callback_depth_compute(treesitter_spec),
                )
            )

    god_rules = None
    has_class_query = treesitter_spec is not None and treesitter_spec.class_query
    if has_class_query:
        from desloppify.engine.detectors.base import GodRule

        god_rules = [
            GodRule("methods", "methods", lambda c: len(c.methods), 15),
            GodRule("loc", "LOC", lambda c: c.loc, 500),
            GodRule("attributes", "attributes", lambda c: len(c.attributes), 10),
        ]

    def run(
        path: Path,
        lang: LangRuntimeContract,
    ) -> tuple[list[Issue], dict[str, int]]:
        from desloppify.languages._framework.base.shared_phases import (
            run_structural_phase,
        )

        god_extractor_fn = None
        if god_rules and has_class_query:
            god_extractor_fn = _make_god_extractor(treesitter_spec, lang.file_finder)

        return run_structural_phase(
            path,
            lang,
            complexity_signals=signals,
            log_fn=log,
            min_loc=40,
            god_rules=god_rules,
            god_extractor_fn=god_extractor_fn,
        )

    return DetectorPhase("Structural analysis", run)


def _make_god_extractor(treesitter_spec, file_finder):
    """Create a god-class extractor function bound to the given spec."""

    def extractor(path: Path):
        return _extract_ts_classes(path, treesitter_spec, file_finder)

    return extractor


def _extract_ts_classes(path, treesitter_spec, file_finder):
    """Extract classes with methods populated via tree-sitter.

    Returns [] on any error (graceful degradation).
    """
    try:
        from collections import defaultdict

        from desloppify.languages._framework.treesitter.analysis.extractors import (
            ts_extract_classes,
            ts_extract_functions,
        )

        file_list = file_finder(path)
        classes = ts_extract_classes(path, treesitter_spec, file_list)
        if not classes:
            return classes

        functions = ts_extract_functions(path, treesitter_spec, file_list)
        by_file = defaultdict(list)
        for function in functions:
            by_file[function.file].append(function)
        for cls in classes:
            cls_end = cls.line + cls.loc
            for function in by_file.get(cls.file, []):
                if cls.line <= function.line <= cls_end:
                    cls.methods.append(function)

        return classes
    except _TS_INIT_ERRORS as exc:
        logger.debug("tree-sitter class extraction failed: %s", exc)
        return []


def _make_coupling_phase(
    dep_graph_fn: Callable[[Path], dict[str, dict[str, object]]],
) -> DetectorPhase:
    """Create a coupling phase for generic plugins with a dep graph."""
    from desloppify.base.output.terminal import log

    def run(
        path: Path,
        lang: LangRuntimeContract,
    ) -> tuple[list[Issue], dict[str, int]]:
        from desloppify.languages._framework.base.shared_phases import (
            run_coupling_phase,
        )

        return run_coupling_phase(
            path,
            lang,
            build_dep_graph_fn=dep_graph_fn,
            log_fn=log,
        )

    return DetectorPhase("Coupling + cycles + orphaned", run)


__all__ = ["_make_coupling_phase", "_make_structural_phase"]
