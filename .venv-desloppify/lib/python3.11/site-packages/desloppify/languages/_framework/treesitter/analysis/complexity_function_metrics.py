"""Function-oriented complexity metrics (length, cyclomatic, params)."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from ..imports.cache import get_or_parse_tree
from .complexity_shared import ComputeFn, _ensure_parser

if TYPE_CHECKING:
    from desloppify.languages._framework.treesitter import TreeSitterLangSpec


def make_long_functions_compute(spec: TreeSitterLangSpec) -> ComputeFn:
    """Build a complexity compute callback for longest function LOC."""
    from .extractors import _run_query, _unwrap_node

    _cached_parser: dict[str, Any] = {}

    def compute(content: str, lines: list[str], *, _filepath: str = "") -> tuple[int, str] | None:
        del content, lines
        if not _filepath:
            return None
        if not _ensure_parser(_cached_parser, spec, with_query=True):
            return None

        parser = _cached_parser["parser"]
        query = _cached_parser["query"]
        cached = get_or_parse_tree(_filepath, parser, spec.grammar)
        if cached is None:
            return None
        _source, tree = cached

        matches = _run_query(query, tree.root_node)
        max_loc = 0
        for _pattern_idx, captures in matches:
            func_node = _unwrap_node(captures.get("func"))
            if not func_node:
                continue
            loc = func_node.end_point[0] - func_node.start_point[0] + 1
            if loc > max_loc:
                max_loc = loc

        if max_loc <= 0:
            return None
        return max_loc, f"longest function {max_loc} LOC"

    return compute


_BRANCHING_NODE_TYPES = frozenset(
    {
        "if_statement",
        "if_expression",
        "if_let_expression",
        "elif_clause",
        "else_if",
        "for_statement",
        "for_expression",
        "for_in_statement",
        "while_statement",
        "while_expression",
        "do_statement",
        "loop_expression",
        "case_clause",
        "match_arm",
        "match_conditional_expression",
        "catch_clause",
        "rescue",
        "except_clause",
        "ternary_expression",
        "conditional_expression",
        "binary_expression",
    }
)

_LOGICAL_OPS = frozenset({"&&", "||", "and", "or"})


def _count_decisions(node) -> int:
    """Count decision points in a function subtree."""
    count = 0
    stack = [node]
    while stack:
        current = stack.pop()
        if current.type in _BRANCHING_NODE_TYPES:
            if current.type == "binary_expression":
                for child in current.children:
                    child_text = child.text
                    if child.type in _LOGICAL_OPS or (
                        child.child_count == 0
                        and child_text
                        and (
                            child_text
                            if isinstance(child_text, str)
                            else child_text.decode("utf-8", "replace")
                        )
                        in _LOGICAL_OPS
                    ):
                        count += 1
                        break
            else:
                count += 1
        for index in range(current.child_count - 1, -1, -1):
            stack.append(current.children[index])
    return count


def make_cyclomatic_complexity_compute(spec: TreeSitterLangSpec) -> ComputeFn:
    """Build a complexity compute callback for max per-function cyclomatic score."""
    from .extractors import _run_query, _unwrap_node

    _cached_parser: dict[str, Any] = {}

    def compute(content: str, lines: list[str], *, _filepath: str = "") -> tuple[int, str] | None:
        del content, lines
        if not _filepath:
            return None
        if not _ensure_parser(_cached_parser, spec, with_query=True):
            return None

        parser = _cached_parser["parser"]
        query = _cached_parser["query"]
        cached = get_or_parse_tree(_filepath, parser, spec.grammar)
        if cached is None:
            return None
        _source, tree = cached

        matches = _run_query(query, tree.root_node)
        max_cc = 0
        for _pattern_idx, captures in matches:
            func_node = _unwrap_node(captures.get("func"))
            if not func_node:
                continue
            cc = 1 + _count_decisions(func_node)
            if cc > max_cc:
                max_cc = cc

        if max_cc <= 1:
            return None
        return max_cc, f"cyclomatic complexity {max_cc}"

    return compute


def make_max_params_compute(spec: TreeSitterLangSpec) -> ComputeFn:
    """Build a complexity compute callback for max parameter count."""
    from .extractors import _extract_param_names, _run_query, _unwrap_node

    _cached_parser: dict[str, Any] = {}

    def compute(content: str, lines: list[str], *, _filepath: str = "") -> tuple[int, str] | None:
        del content, lines
        if not _filepath:
            return None
        if not _ensure_parser(_cached_parser, spec, with_query=True):
            return None

        parser = _cached_parser["parser"]
        query = _cached_parser["query"]
        cached = get_or_parse_tree(_filepath, parser, spec.grammar)
        if cached is None:
            return None
        _source, tree = cached

        matches = _run_query(query, tree.root_node)
        max_params = 0
        for _pattern_idx, captures in matches:
            func_node = _unwrap_node(captures.get("func"))
            if not func_node:
                continue
            params = _extract_param_names(func_node)
            params = [param for param in params if param not in ("self", "cls", "this")]
            if len(params) > max_params:
                max_params = len(params)

        if max_params <= 0:
            return None
        return max_params, f"{max_params} params"

    return compute
