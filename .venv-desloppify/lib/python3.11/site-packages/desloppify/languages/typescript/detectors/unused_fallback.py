"""Fallback scanner helpers for TypeScript unused detection."""

from __future__ import annotations

import logging
import re
from pathlib import Path

from desloppify.base.discovery.paths import get_project_root
from desloppify.base.discovery.source import find_ts_and_tsx_files, read_file_text
from desloppify.base.text_utils import strip_c_style_comments

_IDENT_RE = re.compile(r"^[A-Za-z_$][A-Za-z0-9_$]*$")
_DENO_IMPORT_RE = re.compile(
    r"""(?:from\s+['\"](?:https://(?:deno\.land|esm\.sh)|npm:|jsr:)|^\s*import\s+['\"](?:https://(?:deno\.land|esm\.sh)|npm:|jsr:))"""
)
_DECL_RE = re.compile(
    r"^\s*(export\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][A-Za-z0-9_$]*)\b"
)

logger = logging.getLogger(__name__)


def _identifier_occurrences(content: str, name: str) -> int:
    pat = re.compile(rf"(?<![A-Za-z0-9_$]){re.escape(name)}(?![A-Za-z0-9_$])")
    return len(pat.findall(content))


def _extract_import_names(line: str) -> list[str]:
    """Return local identifier names declared by an import line."""
    if " from " not in line:
        return []

    left = line.split(" from ", 1)[0].strip()
    if not left.startswith("import "):
        return []

    clause = left[len("import ") :].strip()
    if clause.startswith("type "):
        clause = clause[len("type ") :].strip()
    if not clause:
        return []

    names: list[str] = []
    star_match = re.search(r"\*\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*)", clause)
    if star_match:
        names.append(star_match.group(1))

    default_part = clause.split(",", 1)[0].strip()
    if default_part and not default_part.startswith("{") and not default_part.startswith("*"):
        if _IDENT_RE.match(default_part):
            names.append(default_part)

    for block in re.findall(r"\{([^}]*)\}", clause):
        for item in block.split(","):
            token = item.strip()
            if not token:
                continue
            if token.startswith("type "):
                token = token[len("type ") :].strip()
            alias = re.split(r"\s+as\s+", token)
            local_name = alias[-1].strip()
            if _IDENT_RE.match(local_name):
                names.append(local_name)

    deduped: list[str] = []
    seen: set[str] = set()
    for name in names:
        if name in seen:
            continue
        seen.add(name)
        deduped.append(name)
    return deduped


def detect_unused_fallback(path: Path, category: str) -> tuple[list[dict], int]:
    """Conservative source-based fallback for Deno/edge TS projects."""
    files = find_ts_and_tsx_files(path)
    entries: list[dict] = []

    for filepath in files:
        full = Path(filepath) if Path(filepath).is_absolute() else get_project_root() / filepath
        raw = read_file_text(str(full))
        if raw is None:
            continue
        code = strip_c_style_comments(raw)
        lines = raw.splitlines()

        if category in {"all", "imports"}:
            for lineno, line in enumerate(lines, 1):
                if line.lstrip() != line:
                    continue
                if not line.strip().startswith("import "):
                    continue
                for name in _extract_import_names(line):
                    if name.startswith("_"):
                        continue
                    if _identifier_occurrences(code, name) <= 1:
                        entries.append(
                            {
                                "file": filepath,
                                "line": lineno,
                                "col": max(1, line.find(name) + 1),
                                "name": name,
                                "category": "imports",
                            }
                        )

        if category in {"all", "vars"}:
            for lineno, line in enumerate(lines, 1):
                if line.lstrip() != line:
                    continue
                m = _DECL_RE.match(line)
                if not m:
                    continue
                exported, name = m.group(1), m.group(2)
                if exported or name.startswith("_"):
                    continue
                if _identifier_occurrences(code, name) <= 1:
                    entries.append(
                        {
                            "file": filepath,
                            "line": lineno,
                            "col": max(1, line.find(name) + 1),
                            "name": name,
                            "category": "vars",
                        }
                    )

    return entries, len(files)


def _contains_deno_markers(path: Path) -> bool:
    """Return True when scan path is inside a Deno project boundary."""
    markers = ("deno.json", "deno.jsonc", "import_map.json")
    current = path.resolve()
    root = get_project_root().resolve()
    for parent in (current, *current.parents):
        for marker in markers:
            if (parent / marker).is_file():
                return True
        if parent == root:
            break
    return False


def _has_deno_import_syntax(ts_files: list[str]) -> bool:
    for filepath in ts_files:
        full = Path(filepath) if Path(filepath).is_absolute() else get_project_root() / filepath
        content = read_file_text(str(full))
        if content and _DENO_IMPORT_RE.search(content):
            return True
    return False


def should_use_deno_fallback(path: Path, ts_files: list[str]) -> bool:
    normalized = path.resolve().as_posix().lower()
    if normalized.endswith("/supabase/functions") or "/supabase/functions/" in normalized:
        return True
    if _contains_deno_markers(path):
        return True
    return _has_deno_import_syntax(ts_files)


__all__ = [
    "_contains_deno_markers",
    "_extract_import_names",
    "_has_deno_import_syntax",
    "_identifier_occurrences",
    "detect_unused_fallback",
    "should_use_deno_fallback",
]
