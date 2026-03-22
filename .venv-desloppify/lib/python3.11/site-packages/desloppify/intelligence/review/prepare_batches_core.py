"""Shared helpers for review investigation batch construction."""

from __future__ import annotations

from pathlib import Path

from desloppify.intelligence.review._context.models import HolisticContext

_EXTENSIONLESS_FILENAMES = {
    "makefile",
    "dockerfile",
    "readme",
    "license",
    "build",
    "workspace",
}


def _normalize_file_path(value: object) -> str | None:
    """Normalize/validate candidate file paths for batch payloads."""
    if not isinstance(value, str):
        return None
    text = value.strip().strip(",\'\"")
    if not text or text in {".", ".."}:
        return None
    if text.endswith("/"):
        return None

    basename = Path(text).name
    if not basename:
        return None
    if "." not in basename and basename.lower() not in _EXTENSIONLESS_FILENAMES:
        return None
    return text


def _collect_unique_files(
    sources: list[list[dict]],
    key: str = "file",
    *,
    max_files: int | None = None,
) -> list[str]:
    """Collect unique file paths from multiple source lists."""
    seen: set[str] = set()
    out: list[str] = []
    for src in sources:
        for item in src:
            fpath = _normalize_file_path(item.get(key, ""))
            if fpath and fpath not in seen:
                seen.add(fpath)
                out.append(fpath)
                if max_files is not None and len(out) >= max_files:
                    return out
    return out


def _collect_files_from_batches(
    batches: list[dict],
    *,
    max_files: int | None = None,
) -> list[str]:
    """Collect unique file paths across batch payloads (preserving order)."""
    seen: set[str] = set()
    out: list[str] = []
    for batch in batches:
        for filepath in batch.get("files_to_read", []):
            normalized = _normalize_file_path(filepath)
            if not normalized or normalized in seen:
                continue
            seen.add(normalized)
            out.append(normalized)
            if max_files is not None and len(out) >= max_files:
                return out
    return out


def _representative_files_for_directory(
    ctx: HolisticContext,
    directory: str,
    *,
    max_files: int = 3,
) -> list[str]:
    """Map a directory-level signal to representative file paths."""
    if not isinstance(directory, str) or not directory.strip():
        return []

    dir_key = directory.strip()
    if dir_key in {".", "./"}:
        normalized_dir = "."
    else:
        normalized_dir = f"{dir_key.rstrip('/')}/"

    profiles = ctx.structure.get("directory_profiles", {})
    profile = profiles.get(normalized_dir)
    if not isinstance(profile, dict):
        return []

    out: list[str] = []
    for filename in profile.get("files", []):
        if not isinstance(filename, str) or not filename:
            continue
        filepath = (
            filename
            if normalized_dir == "."
            else f"{normalized_dir.rstrip('/')}/{filename}"
        )
        normalized = _normalize_file_path(filepath)
        if not normalized or normalized in out:
            continue
        out.append(normalized)
        if len(out) >= max_files:
            break
    return out


def _ensure_holistic_context(holistic_ctx: HolisticContext | dict) -> HolisticContext:
    """Coerce raw dict payloads into a ``HolisticContext`` model."""
    if isinstance(holistic_ctx, HolisticContext):
        return holistic_ctx
    return HolisticContext.from_raw(holistic_ctx)


__all__ = [
    "_collect_files_from_batches",
    "_collect_unique_files",
    "_ensure_holistic_context",
    "_normalize_file_path",
    "_representative_files_for_directory",
]
