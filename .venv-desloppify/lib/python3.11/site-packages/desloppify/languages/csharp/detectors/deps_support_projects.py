"""Project-file discovery and reference parsing helpers for C# deps graph."""

from __future__ import annotations

import json
import logging

try:
    import defusedxml.ElementTree as _element_tree
except ModuleNotFoundError:  # pragma: no cover
    import xml.etree.ElementTree as _element_tree  # nosec B405
from pathlib import Path

from desloppify.base.discovery.file_paths import resolve_path
from desloppify.languages.csharp.extractors import CSHARP_FILE_EXCLUSIONS

logger = logging.getLogger(__name__)
ET = _element_tree

_PROJECT_EXCLUSIONS = set(CSHARP_FILE_EXCLUSIONS) | {".git"}


def is_excluded_path(path: Path) -> bool:
    """True when path is under a known excluded directory."""
    return any(part in _PROJECT_EXCLUSIONS for part in path.parts)


def find_csproj_files(path: Path) -> list[Path]:
    """Find .csproj files under path, excluding build artifact directories."""
    found: list[Path] = []
    for candidate in path.rglob("*.csproj"):
        if is_excluded_path(candidate):
            continue
        found.append(candidate.resolve())
    return sorted(found)


def parse_csproj_references(csproj_file: Path) -> tuple[set[Path], str | None]:
    """Parse ProjectReference includes and optional RootNamespace."""
    refs: set[Path] = set()
    root_ns: str | None = None
    try:
        root = ET.parse(csproj_file).getroot()
    except (ET.ParseError, OSError):
        return refs, root_ns

    for elem in root.iter():
        tag = elem.tag.split("}", 1)[-1]
        if tag == "ProjectReference":
            include = elem.attrib.get("Include")
            if include:
                include_path = include.replace("\\", "/")
                refs.add((csproj_file.parent / include_path).resolve())
        elif tag == "RootNamespace" and elem.text and elem.text.strip():
            root_ns = elem.text.strip()
    return refs, root_ns


def resolve_project_ref_path(raw_ref: str, base_dirs: tuple[Path, ...]) -> Path | None:
    """Resolve a .csproj path against a list of base directories."""
    ref = (raw_ref or "").strip().strip('"').replace("\\", "/")
    if not ref or not ref.lower().endswith(".csproj"):
        return None

    ref_path = Path(ref)
    if ref_path.is_absolute():
        try:
            return ref_path.resolve()
        except OSError as exc:
            logger.debug(
                "Skipping unresolved absolute project reference %s: %s",
                ref_path,
                exc,
            )
            return None

    fallback: Path | None = None
    for base_dir in base_dirs:
        try:
            candidate = (base_dir / ref_path).resolve()
        except OSError as exc:
            logger.debug(
                "Skipping unresolved project reference %s under %s: %s",
                ref_path,
                base_dir,
                exc,
            )
            continue
        if candidate.exists():
            return candidate
        if fallback is None:
            fallback = candidate
    return fallback


def parse_project_assets_references(csproj_file: Path) -> set[Path]:
    """Parse project refs from obj/project.assets.json, if available."""
    assets_file = csproj_file.parent / "obj" / "project.assets.json"
    if not assets_file.exists():
        return set()
    try:
        payload = json.loads(assets_file.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return set()
    if not isinstance(payload, dict):
        return set()

    refs: set[Path] = set()
    base_dirs = (csproj_file.parent, assets_file.parent)

    libraries = payload.get("libraries")
    if isinstance(libraries, dict):
        for lib_meta in libraries.values():
            if not isinstance(lib_meta, dict):
                continue
            if str(lib_meta.get("type", "")).lower() != "project":
                continue
            for key in ("path", "msbuildProject"):
                raw_ref = lib_meta.get(key)
                if not isinstance(raw_ref, str):
                    continue
                resolved = resolve_project_ref_path(raw_ref, base_dirs)
                if resolved is not None:
                    refs.add(resolved)

    dep_groups = payload.get("projectFileDependencyGroups")
    if isinstance(dep_groups, dict):
        for deps in dep_groups.values():
            if not isinstance(deps, list):
                continue
            for dep in deps:
                if not isinstance(dep, str):
                    continue
                dep_token = dep.split(maxsplit=1)[0]
                resolved = resolve_project_ref_path(dep_token, base_dirs)
                if resolved is not None:
                    refs.add(resolved)

    refs.discard(csproj_file.resolve())
    return refs


def map_file_to_project(cs_files: list[str], projects: list[Path]) -> dict[str, Path]:
    """Assign each source file to the nearest containing .csproj directory."""
    project_dirs = sorted(
        (project.parent for project in projects),
        key=lambda directory: len(directory.parts),
        reverse=True,
    )
    mapping: dict[str, Path] = {}
    for filepath in cs_files:
        abs_file = Path(resolve_path(filepath))
        for proj_dir in project_dirs:
            try:
                abs_file.relative_to(proj_dir)
            except ValueError as exc:
                logger.debug(
                    "File %s is not under project directory %s: %s",
                    abs_file,
                    proj_dir,
                    exc,
                )
                continue
            match = next(
                (project for project in projects if project.parent == proj_dir),
                None,
            )
            if match is not None:
                mapping[str(abs_file)] = match
                break
    return mapping
