"""Rust runtime-safety and unsafe-API policy detectors."""

from __future__ import annotations

from pathlib import Path

from desloppify.base.discovery.file_paths import resolve_path
from desloppify.languages.rust.support import describe_rust_file, find_rust_files, read_text_or_none, strip_rust_comments

from ._shared import (
    _ASYNC_GUARD_ACQUIRE_RE,
    _BLOCKING_LOCK_CALL_RE,
    _DROP_PANIC_RE,
    _STD_GUARD_ACQUIRE_RE,
    _UNSAFE_API_PATTERNS,
    _entry,
    _has_fallible_drop_unwrap,
    _holds_lock_guard_across_await,
    _is_runtime_source_file,
    _iter_async_functions,
    _iter_drop_methods,
    _line_number,
    _should_skip_unsafe_api_match,
    _uses_std_sync_locks,
)


def detect_async_locking(path: Path) -> tuple[list[dict], int]:
    """Flag high-signal async locking hazards in runtime Rust code."""
    entries: list[dict] = []
    files = find_rust_files(path)
    for filepath in files:
        absolute = Path(resolve_path(filepath))
        content = read_text_or_none(absolute)
        if content is None:
            continue
        context = describe_rust_file(absolute)
        if not _is_runtime_source_file(context):
            continue

        file_uses_std_sync_locks = _uses_std_sync_locks(content)
        for block in _iter_async_functions(content):
            body = strip_rust_comments(block.body)
            if _holds_lock_guard_across_await(body, _STD_GUARD_ACQUIRE_RE):
                entries.append(
                    _entry(
                        absolute,
                        line=block.line,
                        name=f"std_guard::{block.name}",
                        summary=(
                            f"Async function `{block.name}` appears to hold a std::sync lock guard across an await point"
                        ),
                        tier=3,
                        confidence="high",
                    )
                )
                continue

            if _holds_lock_guard_across_await(body, _ASYNC_GUARD_ACQUIRE_RE):
                entries.append(
                    _entry(
                        absolute,
                        line=block.line,
                        name=f"async_guard::{block.name}",
                        summary=(
                            f"Async function `{block.name}` appears to hold an async lock guard across another await point"
                        ),
                        tier=3,
                        confidence="medium",
                    )
                )
                continue

            if file_uses_std_sync_locks and _BLOCKING_LOCK_CALL_RE.search(body):
                entries.append(
                    _entry(
                        absolute,
                        line=block.line,
                        name=f"blocking_lock::{block.name}",
                        summary=(
                            f"Async function `{block.name}` uses std::sync lock operations that can block executor threads"
                        ),
                        tier=3,
                        confidence="medium",
                    )
                )
    return entries, len(files)


def detect_drop_safety(path: Path) -> tuple[list[dict], int]:
    """Flag panic-style cleanup inside `Drop` implementations."""
    entries: list[dict] = []
    files = find_rust_files(path)
    for filepath in files:
        absolute = Path(resolve_path(filepath))
        content = read_text_or_none(absolute)
        if content is None:
            continue
        context = describe_rust_file(absolute)
        if not _is_runtime_source_file(context):
            continue

        for type_name, line, body in _iter_drop_methods(content):
            stripped = strip_rust_comments(body)
            if _DROP_PANIC_RE.search(stripped):
                entries.append(
                    _entry(
                        absolute,
                        line=line,
                        name=f"drop_panic::{type_name}",
                        summary=(
                            f"`Drop` impl for `{type_name}` contains `panic!`; panicking destructors can abort during unwinding"
                        ),
                        tier=3,
                        confidence="high",
                    )
                )
            if _has_fallible_drop_unwrap(stripped):
                entries.append(
                    _entry(
                        absolute,
                        line=line,
                        name=f"drop_unwrap::{type_name}",
                        summary=(
                            f"`Drop` impl for `{type_name}` uses `unwrap`/`expect`; destructor cleanup should stay infallible"
                        ),
                        tier=3,
                        confidence="high",
                    )
                )
    return entries, len(files)


def detect_unsafe_api_usage(path: Path) -> tuple[list[dict], int]:
    """Flag UB-adjacent unchecked APIs in runtime Rust code."""
    entries: list[dict] = []
    files = find_rust_files(path)
    for filepath in files:
        absolute = Path(resolve_path(filepath))
        content = read_text_or_none(absolute)
        if content is None:
            continue
        context = describe_rust_file(absolute)
        if not _is_runtime_source_file(context):
            continue

        stripped = strip_rust_comments(content, preserve_lines=True)
        for detector_name, pattern, summary, tier, confidence in _UNSAFE_API_PATTERNS:
            for match in pattern.finditer(stripped):
                if _should_skip_unsafe_api_match(detector_name, content, match.start()):
                    continue
                line = _line_number(stripped, match.start())
                entries.append(
                    _entry(
                        absolute,
                        line=line,
                        name=f"{detector_name}::{line}",
                        summary=summary,
                        tier=tier,
                        confidence=confidence,
                    )
                )
    return entries, len(files)


__all__ = [
    "detect_async_locking",
    "detect_drop_safety",
    "detect_unsafe_api_usage",
]
