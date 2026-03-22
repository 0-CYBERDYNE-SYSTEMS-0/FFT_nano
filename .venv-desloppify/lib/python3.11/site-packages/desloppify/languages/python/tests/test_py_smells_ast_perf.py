"""Performance guardrails for AST smell dispatch."""

from __future__ import annotations

import time

from desloppify.languages.python.detectors.smells_ast._dispatch import (
    detect_ast_smells,
)


def _synth_module(functions: int = 220) -> str:
    chunks: list[str] = []
    for idx in range(functions):
        chunks.append(f"def f_{idx}(a=None, b=None, c=None, d=None):")
        chunks.append("    if a:")
        chunks.append("        return 1")
        chunks.append("    return 1")
        chunks.append("")
    return "\n".join(chunks)


def test_ast_smell_dispatch_runtime_budget():
    source = _synth_module()
    smell_counts: dict[str, list[dict]] = {}

    start = time.perf_counter()
    detect_ast_smells("perf_sample.py", source, smell_counts)
    elapsed = time.perf_counter() - start

    # Coarse guard against accidental super-linear regressions.
    assert elapsed < 5.0
