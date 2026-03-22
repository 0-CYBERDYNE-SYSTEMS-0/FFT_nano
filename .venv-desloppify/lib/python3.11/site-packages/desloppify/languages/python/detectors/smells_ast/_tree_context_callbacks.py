"""Tree-level smell detector for callback-style logging parameters."""

from __future__ import annotations

import ast

from desloppify.languages.python.detectors.smells_ast._helpers import _iter_nodes

_CALLBACK_LOG_NAMES = {
    "dprint",
    "debug_print",
    "debug_func",
    "log_func",
    "print_fn",
    "logger_func",
    "log_callback",
    "print_func",
    "debug_log",
    "verbose_print",
    "trace_func",
}


def _count_callback_invocations(node: ast.AST, *, callback_name: str) -> int:
    """Count direct calls of ``callback_name(...)`` in a function body."""
    return sum(
        1
        for child in ast.walk(node)
        if (
            isinstance(child, ast.Call)
            and isinstance(child.func, ast.Name)
            and child.func.id == callback_name
        )
    )


def _detect_callback_logging(
    filepath: str,
    tree: ast.Module,
    all_nodes: tuple[ast.AST, ...] | None = None,
) -> list[dict]:
    """Flag functions that accept + invoke logging callback parameters."""
    results: list[dict] = []
    for node in _iter_nodes(tree, all_nodes, (ast.FunctionDef, ast.AsyncFunctionDef)):
        for arg in node.args.args + node.args.kwonlyargs:
            name = arg.arg
            if name not in _CALLBACK_LOG_NAMES:
                continue
            call_count = _count_callback_invocations(node, callback_name=name)
            if call_count < 1:
                continue
            results.append(
                {
                    "file": filepath,
                    "line": node.lineno,
                    "content": f"{node.name}({name}=...) — called {call_count} time(s)",
                }
            )
    return results


__all__ = ["_detect_callback_logging"]
