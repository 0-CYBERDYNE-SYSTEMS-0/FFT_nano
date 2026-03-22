"""Single-scope dict key flow analysis for Python source."""

from __future__ import annotations

import ast
import importlib
import logging
from pathlib import Path

from desloppify.base.discovery.paths import get_project_root
from desloppify.base.discovery.source import find_py_files

logger = logging.getLogger(__name__)


def _load_dict_key_visitor():
    module = importlib.import_module(".visitor", package=__package__)
    return module.DictKeyVisitor


def detect_dict_key_flow(path: Path) -> tuple[list[dict], int]:
    """Walk all .py files and run DictKeyVisitor. Returns (issues, files_checked)."""
    dict_key_visitor = _load_dict_key_visitor()
    files = find_py_files(path)
    all_issues: list[dict] = []

    for filepath in files:
        try:
            file_path = (
                Path(filepath) if Path(filepath).is_absolute() else get_project_root() / filepath
            )
            source = file_path.read_text()
        except (OSError, UnicodeDecodeError) as exc:
            logger.debug(
                "Skipping unreadable python file %s in dict-key pass: %s",
                filepath,
                exc,
            )
            continue

        try:
            tree = ast.parse(source, filename=filepath)
        except SyntaxError as exc:
            logger.debug(
                "Skipping unparseable python file %s in dict-key pass: %s",
                filepath,
                exc,
            )
            continue

        visitor = dict_key_visitor(filepath)
        visitor.visit(tree)
        all_issues.extend(visitor._issues)

    return all_issues, len(files)
