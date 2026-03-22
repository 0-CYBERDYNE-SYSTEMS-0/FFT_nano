"""Query output helpers for command modules."""

from __future__ import annotations

import json
import sys
from dataclasses import dataclass
from pathlib import Path

from desloppify.base.output.terminal import colorize
from desloppify.base.output.contract import OutputResult
from desloppify.base.search.query import write_query as _core_write_query
from desloppify.base.search.query_paths import query_file_path


@dataclass(frozen=True)
class QueryWriter:
    """Command-level query artifact writer with explicit failure policy."""

    query_file: Path

    def write(self, data: dict) -> OutputResult:
        return _core_write_query(data, query_file=self.query_file)

    def write_best_effort(self, data: dict, *, context: str) -> OutputResult:
        result = self.write(data)
        if not result.ok:
            detail = result.message or "unknown write failure"
            print(
                colorize(
                    f"  Warning: {context} succeeded but query artifact was not written ({detail}).",
                    "yellow",
                ),
                file=sys.stderr,
            )
        return result


@dataclass(frozen=True)
class QueryLoadResult:
    """Result contract for query payload reads."""

    ok: bool
    payload: dict | None
    message: str = ""
    error_kind: str | None = None


def query_writer() -> QueryWriter:
    """Construct a writer bound to the active runtime query path."""
    return QueryWriter(query_file=query_file_path())


def load_query_result() -> QueryLoadResult:
    """Load the active query payload with explicit error contract."""
    path = query_file_path()
    try:
        raw = path.read_text()
    except OSError as exc:
        return QueryLoadResult(
            ok=False,
            payload=None,
            message=str(exc),
            error_kind="query_read_error",
        )
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        return QueryLoadResult(
            ok=False,
            payload=None,
            message=str(exc),
            error_kind="query_parse_error",
        )
    if not isinstance(payload, dict):
        return QueryLoadResult(
            ok=False,
            payload=None,
            message="query payload is not a JSON object",
            error_kind="query_invalid_shape",
        )
    return QueryLoadResult(ok=True, payload=payload)


def write_query(data: dict) -> OutputResult:
    """Write structured query output using default best-effort policy."""
    return write_query_best_effort(data, context="query payload update")


def write_query_best_effort(data: dict, *, context: str) -> OutputResult:
    """Write query payload and emit a contextual warning on failure."""
    return query_writer().write_best_effort(data, context=context)


__all__ = [
    "QueryLoadResult",
    "QueryWriter",
    "load_query_result",
    "query_file_path",
    "query_writer",
    "write_query",
    "write_query_best_effort",
]
