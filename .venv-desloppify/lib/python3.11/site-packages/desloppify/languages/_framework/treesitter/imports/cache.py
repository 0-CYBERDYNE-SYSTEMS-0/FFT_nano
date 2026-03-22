"""Scan-scoped tree-sitter parse tree cache."""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING

from desloppify.base.runtime_state import resolve_runtime_context

if TYPE_CHECKING:
    from desloppify.base.runtime_state import RuntimeContext


class ParseTreeCache:
    """Cache parsed tree-sitter trees during a scan.

    Key: (filepath, grammar_name) -> (source_bytes, parsed_tree)
    Stores source_bytes so callers can use them without re-reading.
    """

    def __init__(self) -> None:
        self._enabled: bool = False
        self._trees: dict[tuple[str, str], tuple[bytes, object]] = {}

    def enable(self) -> None:
        self._enabled = True
        self._trees = {}

    def disable(self) -> None:
        self._enabled = False
        self._trees = {}

    def get_or_parse(
        self, filepath: str, parser, grammar: str
    ) -> tuple[bytes, object] | None:
        """Read file and parse, returning (source_bytes, tree). Uses cache if enabled."""
        key = (filepath, grammar)
        if self._enabled and key in self._trees:
            return self._trees[key]

        try:
            source = Path(filepath).read_bytes()
        except (OSError, UnicodeDecodeError):
            return None

        tree = parser.parse(source)
        if self._enabled:
            self._trees[key] = (source, tree)
        return source, tree


def current_parse_tree_cache(
    *, runtime: RuntimeContext | None = None
) -> ParseTreeCache:
    """Return the parse cache owned by the active runtime context."""
    resolved_runtime = resolve_runtime_context(runtime)
    cache = resolved_runtime.treesitter_parse_cache
    if isinstance(cache, ParseTreeCache):
        return cache
    owned_cache = ParseTreeCache()
    resolved_runtime.treesitter_parse_cache = owned_cache
    return owned_cache


def get_or_parse_tree(
    filepath: str,
    parser,
    grammar: str,
    *,
    runtime: RuntimeContext | None = None,
) -> tuple[bytes, object] | None:
    """Parse a file using the runtime-owned tree cache."""
    return current_parse_tree_cache(runtime=runtime).get_or_parse(
        filepath,
        parser,
        grammar,
    )


def enable_parse_cache(*, runtime: RuntimeContext | None = None) -> None:
    """Enable scan-scoped parse tree cache."""
    current_parse_tree_cache(runtime=runtime).enable()


def disable_parse_cache(*, runtime: RuntimeContext | None = None) -> None:
    """Disable parse tree cache and free memory."""
    current_parse_tree_cache(runtime=runtime).disable()


def is_parse_cache_enabled(*, runtime: RuntimeContext | None = None) -> bool:
    """Check if parse cache is currently enabled."""
    return current_parse_tree_cache(runtime=runtime)._enabled


__all__ = [
    "ParseTreeCache",
    "current_parse_tree_cache",
    "disable_parse_cache",
    "enable_parse_cache",
    "get_or_parse_tree",
    "is_parse_cache_enabled",
]
