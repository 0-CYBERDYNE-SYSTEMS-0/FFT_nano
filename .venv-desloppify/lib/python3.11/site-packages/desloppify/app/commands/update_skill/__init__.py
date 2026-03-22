"""`update-skill` command package with backward-compatible exports."""

from __future__ import annotations

import argparse

from . import cmd as _cmd

SKILL_BEGIN = _cmd.SKILL_BEGIN
SKILL_END = _cmd.SKILL_END
SKILL_TARGETS = _cmd.SKILL_TARGETS
SKILL_VERSION = _cmd.SKILL_VERSION
SKILL_VERSION_RE = _cmd.SKILL_VERSION_RE
SkillInstall = _cmd.SkillInstall

_RAW_BASE = _cmd._RAW_BASE
_FRONTMATTER_FIRST_INTERFACES = _cmd._FRONTMATTER_FIRST_INTERFACES
_download = _cmd._download
_build_section = _cmd._build_section
_ensure_frontmatter_first = _cmd._ensure_frontmatter_first
_replace_section = _cmd._replace_section

find_installed_skill = _cmd.find_installed_skill
get_project_root = _cmd.get_project_root
safe_write_text = _cmd.safe_write_text
colorize = _cmd.colorize


def resolve_interface(
    explicit: str | None = None,
    install: SkillInstall | None = None,
) -> str | None:
    """Resolve which interface to update."""
    if explicit:
        return explicit.lower()
    resolved_install = install if install is not None else find_installed_skill()
    if resolved_install is None:
        return None
    return _cmd.resolve_interface(explicit=None, install=resolved_install)


def update_installed_skill(interface: str) -> bool:
    """Download and install the skill document for the given interface."""
    return _cmd._update_installed_skill_with_deps(
        interface,
        download_fn=_download,
        get_project_root_fn=get_project_root,
        safe_write_text_fn=safe_write_text,
        colorize_fn=colorize,
    )


def cmd_update_skill(args: argparse.Namespace) -> None:
    """Install or update the desloppify skill document."""
    _cmd._run_cmd_update_skill(
        args,
        resolve_interface_fn=resolve_interface,
        update_installed_skill_fn=update_installed_skill,
        colorize_fn=colorize,
    )


__all__ = [
    "SKILL_BEGIN",
    "SKILL_END",
    "SKILL_TARGETS",
    "SKILL_VERSION",
    "SKILL_VERSION_RE",
    "SkillInstall",
    "_FRONTMATTER_FIRST_INTERFACES",
    "_RAW_BASE",
    "_build_section",
    "_download",
    "_ensure_frontmatter_first",
    "_replace_section",
    "cmd_update_skill",
    "colorize",
    "find_installed_skill",
    "get_project_root",
    "resolve_interface",
    "update_installed_skill",
]
