"""Callback/closure nesting metric for tree-sitter complexity."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from ..imports.cache import get_or_parse_tree
from .complexity_shared import ComputeFn, _ensure_parser

if TYPE_CHECKING:
    from desloppify.languages._framework.treesitter import TreeSitterLangSpec


_CLOSURE_NODE_TYPES = frozenset(
    {
        "arrow_function",
        "function_expression",
        "function",
        "lambda_expression",
        "closure_expression",
        "lambda",
        "anonymous_function",
        "block_argument",
        "func_literal",
        # PHP anonymous functions (``function() { ... }``)
        "anonymous_function_creation_expression",
    }
)


def make_callback_depth_compute(spec: TreeSitterLangSpec) -> ComputeFn:
    """Build a complexity compute callback for callback/closure nesting depth."""
    _cached_parser: dict[str, Any] = {}

    def compute(content: str, lines: list[str], *, _filepath: str = "") -> tuple[int, str] | None:
        del content, lines
        if not _filepath:
            return None
        if not _ensure_parser(_cached_parser, spec):
            return None

        parser = _cached_parser["parser"]
        cached = get_or_parse_tree(_filepath, parser, spec.grammar)
        if cached is None:
            return None
        _source, tree = cached

        max_depth = 0
        stack: list[tuple[object, int]] = [(tree.root_node, 0)]
        while stack:
            node, depth = stack.pop()
            if node.type in _CLOSURE_NODE_TYPES:
                depth += 1
                if depth > max_depth:
                    max_depth = depth
            for index in range(node.child_count - 1, -1, -1):
                stack.append((node.children[index], depth))

        if max_depth <= 1:
            return None
        return max_depth, f"callback depth {max_depth}"

    return compute


__all__ = ["make_callback_depth_compute"]
