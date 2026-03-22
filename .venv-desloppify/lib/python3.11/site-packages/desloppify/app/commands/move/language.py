"""Language detection and move-module loading for the move command."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from types import ModuleType

from desloppify.app.commands.helpers.dynamic_loaders import (
    load_language_move_module as load_dynamic_language_move_module,
)
from desloppify.languages import framework as lang_mod
from desloppify.app.commands.helpers.lang import load_lang_config_metadata, resolve_lang


def _build_ext_to_lang_map() -> dict[str, str]:
    """Build extension→language map from registered language configs."""
    ext_map: dict[str, str] = {}
    for lang_name in lang_mod.available_langs():
        cfg = load_lang_config_metadata(lang_name)
        if cfg is None:
            continue
        for ext in cfg.extensions:
            ext_map.setdefault(ext, lang_name)
    return ext_map


@lru_cache(maxsize=1)
def _ext_to_lang_map() -> dict[str, str]:
    return _build_ext_to_lang_map()


def detect_lang_from_ext(source: str) -> str | None:
    """Detect language from file extension."""
    ext = Path(source).suffix
    return _ext_to_lang_map().get(ext)


def detect_lang_from_dir(source_dir: str) -> str | None:
    """Detect language from files in a directory."""
    source_path = Path(source_dir)
    for filepath in source_path.rglob("*"):
        if filepath.is_file():
            lang = detect_lang_from_ext(str(filepath))
            if lang:
                return lang
    return None


def resolve_lang_for_file_move(source_abs: str, args: object) -> str | None:
    """Resolve language for a single-file move operation.

    Explicit ``--lang`` takes priority. Otherwise, infer from file extension and
    finally fall back to generic language resolution.
    """
    explicit_lang = getattr(args, "lang", None)
    if explicit_lang:
        lang = resolve_lang(args)
        if lang:
            return lang.name

    lang_name = detect_lang_from_ext(source_abs)
    if not lang_name:
        lang = resolve_lang(args)
        if lang:
            lang_name = lang.name
    return lang_name


def supported_ext_hint() -> str:
    """Return a display string for known source extensions."""
    exts = ", ".join(sorted(_ext_to_lang_map()))
    return exts or "<none>"


def load_lang_move_module(lang_name: str) -> ModuleType:
    """Load language-specific move helpers from ``lang/<name>/move.py``.

    Falls back to the shared scaffold move module when a language does not
    provide its own ``move.py``.
    """
    return load_dynamic_language_move_module(lang_name)


def resolve_move_verify_hint(move_mod: ModuleType) -> str:
    """Return a move-module verification hint."""
    get_verify_hint = getattr(move_mod, "get_verify_hint", None)
    if callable(get_verify_hint):
        hint = get_verify_hint()
        if isinstance(hint, str):
            return hint.strip()
    return ""


__all__ = [
    "detect_lang_from_dir",
    "detect_lang_from_ext",
    "load_lang_move_module",
    "resolve_move_verify_hint",
    "resolve_lang_for_file_move",
    "supported_ext_hint",
]
