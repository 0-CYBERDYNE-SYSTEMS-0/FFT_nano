"""Runtime helpers for TypeScript dependency command paths."""

from __future__ import annotations

import re
from collections.abc import Callable
from pathlib import Path


def build_dynamic_import_targets(
    path: Path,
    extensions: list[str],
    *,
    framework_extensions: tuple[str, ...],
    grep_files_fn: Callable[[str, list[str]], list[tuple[str, int, str]]],
    find_source_files_fn: Callable[[Path, list[str]], list[str]],
) -> set[str]:
    """Find targets referenced by dynamic imports and side-effect imports."""
    targets: set[str] = set()
    all_extensions = extensions + [
        ext for ext in framework_extensions if ext not in extensions
    ]
    files = find_source_files_fn(path, all_extensions)

    hits = grep_files_fn(r"import\s*\(\s*['\"]", files)
    module_re = re.compile(r"""import\s*\(\s*['"]([^'"]+)['"]""")
    for _filepath, _line, content in hits:
        match = module_re.search(content)
        if match:
            targets.add(match.group(1))

    hits = grep_files_fn(r"^import\s+['\"]", files)
    side_re = re.compile(r"""import\s+['"]([^'"]+)['"]""")
    for _filepath, _line, content in hits:
        match = side_re.search(content)
        if match:
            targets.add(match.group(1))

    return targets


def ts_alias_resolver(
    target: str,
    *,
    load_paths_fn: Callable[[Path], dict[str, str]],
    project_root: Path,
) -> str:
    """Resolve TS path aliases using tsconfig.json paths."""
    paths = load_paths_fn(project_root)
    for prefix, target_dir in paths.items():
        if target.startswith(prefix):
            return target_dir + target[len(prefix) :]
    return target


__all__ = ["build_dynamic_import_targets", "ts_alias_resolver"]
