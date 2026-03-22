"""Shared file-read contract helpers for test-coverage detection."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from desloppify.base.output.fallbacks import log_best_effort_failure, warn_best_effort

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class CoverageFileReadResult:
    """Typed file-read outcome for test-coverage heuristics/metrics."""

    ok: bool
    content: str
    error_kind: str | None = None
    error_message: str | None = None


@lru_cache(maxsize=None)
def _warn_read_failure_once(context: str, filepath: str, error_kind: str) -> None:
    """Emit one best-effort warning per unique context/path/error tuple."""
    warn_best_effort(
        f"Could not read file for test coverage ({context}): {filepath} [{error_kind}]"
    )


def read_coverage_file(
    filepath: str,
    *,
    context: str,
) -> CoverageFileReadResult:
    """Read a source file and emit one best-effort warning per context/path."""
    try:
        return CoverageFileReadResult(ok=True, content=Path(filepath).read_text())
    except (OSError, UnicodeDecodeError) as exc:
        log_best_effort_failure(logger, f"{context} read {filepath}", exc)
        _warn_read_failure_once(context, filepath, exc.__class__.__name__)
        return CoverageFileReadResult(
            ok=False,
            content="",
            error_kind=exc.__class__.__name__,
            error_message=str(exc),
        )


def clear_coverage_read_warning_cache_for_tests() -> None:
    """Test helper to reset warning de-duplication state."""
    _warn_read_failure_once.cache_clear()


__all__ = [
    "CoverageFileReadResult",
    "clear_coverage_read_warning_cache_for_tests",
    "read_coverage_file",
]
