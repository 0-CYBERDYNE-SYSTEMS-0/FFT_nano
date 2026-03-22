"""Nesting-depth complexity metrics for tree-sitter languages."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from ..imports.cache import get_or_parse_tree
from .complexity_callbacks import make_callback_depth_compute
from .complexity_shared import ComputeFn, _ensure_parser

if TYPE_CHECKING:
    from desloppify.languages._framework.treesitter import TreeSitterLangSpec

# ---------------------------------------------------------------------------
# Nesting depth
# ---------------------------------------------------------------------------

_NESTING_NODE_TYPES = frozenset(
    {
        "if_statement",
        "if_expression",
        "if_let_expression",
        "else_clause",
        "elif_clause",
        "for_statement",
        "for_expression",
        "for_in_statement",
        "while_statement",
        "while_expression",
        "do_statement",
        "loop_expression",
        "try_statement",
        "try_expression",
        "catch_clause",
        "rescue",
        "except_clause",
        "switch_statement",
        "switch_expression",
        "match_expression",
        "case_clause",
        "match_arm",
        "with_statement",
        "with_clause",
        "lambda_expression",
        "closure_expression",
    }
)


def compute_nesting_depth_ts(
    filepath: str, spec: TreeSitterLangSpec, parser, language
) -> int | None:
    """Compute max control-flow nesting depth via iterative AST walk."""
    del language
    cached = get_or_parse_tree(filepath, parser, spec.grammar)
    if cached is None:
        return None
    _source, tree = cached

    max_depth = 0
    stack: list[tuple[object, int]] = [(tree.root_node, 0)]
    while stack:
        node, depth = stack.pop()
        if node.type in _NESTING_NODE_TYPES:
            depth += 1
            if depth > max_depth:
                max_depth = depth
        for index in range(node.child_count - 1, -1, -1):
            stack.append((node.children[index], depth))
    return max_depth


def make_nesting_depth_compute(spec: TreeSitterLangSpec) -> ComputeFn:
    """Build a complexity compute callback for max nesting depth."""
    _cached_parser: dict[str, Any] = {}

    def compute(content: str, lines: list[str], *, _filepath: str = "") -> tuple[int, str] | None:
        del content, lines
        if not _filepath:
            return None
        if not _ensure_parser(_cached_parser, spec):
            return None

        depth = compute_nesting_depth_ts(
            _filepath,
            spec,
            _cached_parser["parser"],
            _cached_parser["language"],
        )
        if depth is None or depth <= 0:
            return None
        return depth, f"nesting depth {depth}"

    return compute


__all__ = ["compute_nesting_depth_ts", "make_callback_depth_compute", "make_nesting_depth_compute"]
