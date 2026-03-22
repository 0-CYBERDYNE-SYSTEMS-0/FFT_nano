"""Shared parser/bootstrap helpers for tree-sitter complexity signals."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any, Callable

from .. import PARSE_INIT_ERRORS
from .extractors import _get_parser, _make_query

if TYPE_CHECKING:
    from desloppify.languages._framework.treesitter import TreeSitterLangSpec

logger = logging.getLogger(__name__)

ComputeFn = Callable[[str, list[str]], tuple[int, str] | None]
"""Signature for complexity signal compute functions.

Each factory returns a closure with this effective call shape:
``(content, lines, *, _filepath="") -> (count, label) | None``.
"""


def _ensure_parser(
    cache: dict[str, Any],
    spec: TreeSitterLangSpec,
    *,
    with_query: bool = False,
) -> bool:
    """Lazily initialise parser (and optionally function query) into *cache*."""
    if "parser" in cache:
        return True
    try:
        parser, lang = _get_parser(spec.grammar)
        cache["parser"] = parser
        cache["language"] = lang
        if with_query:
            cache["query"] = _make_query(lang, spec.function_query)
    except PARSE_INIT_ERRORS as exc:
        logger.debug("tree-sitter init failed: %s", exc)
        return False
    return True


__all__ = ["ComputeFn", "_ensure_parser"]
