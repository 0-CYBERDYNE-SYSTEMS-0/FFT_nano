"""Shared helpers and constants for Python AST smell detectors."""

from __future__ import annotations

import ast


def _is_return_none(stmt: ast.AST) -> bool:
    """Check if a statement is `return` or `return None`."""
    if not isinstance(stmt, ast.Return):
        return False
    return stmt.value is None or (
        isinstance(stmt.value, ast.Constant) and stmt.value.value is None
    )


def _is_docstring(stmt: ast.AST) -> bool:
    """Check whether a statement is a docstring expression."""
    return isinstance(stmt, ast.Expr) and isinstance(
        stmt.value, ast.Constant | ast.JoinedStr
    )


# Variable names that strongly suggest filesystem paths (not module specifiers)
_PATH_VAR_NAMES = {
    "filepath",
    "file_path",
    "filename",
    "file_name",
    "dirpath",
    "dir_path",
    "dirname",
    "dir_name",
    "directory",
    "rel_path",
    "abs_path",
    "rel_file",
    "rel_dir",
    "full_path",
    "base_path",
    "parent_path",
    "scan_path",
}

# Substrings that suggest a variable holds a path
_PATH_NAME_PARTS = {"filepath", "dirpath", "file_path", "dir_path"}


def _looks_like_path_var(name: str) -> bool:
    """Check if a variable name suggests it holds a filesystem path."""
    lower = name.lower()
    if lower in _PATH_VAR_NAMES:
        return True
    # Check for path-related substrings: e.g., old_filepath, scan_path
    return any(part in lower for part in _PATH_NAME_PARTS)


def _is_log_or_print(node: ast.AST) -> bool:
    """Check if a statement is a logging/print call."""
    if not isinstance(node, ast.Expr) or not isinstance(node.value, ast.Call):
        return False
    func = node.value.func
    if isinstance(func, ast.Name) and func.id == "print":
        return True
    if isinstance(func, ast.Attribute):
        if isinstance(func.value, ast.Name) and func.value.id in (
            "logger",
            "log",
            "logging",
        ):
            return True
    return False


def _is_trivial_if(node: ast.AST) -> bool:
    """Check if an If statement has only trivially-empty body.

    For noop classification, only `pass` and `return None` should count as
    trivial. Returning concrete values is meaningful logic and should not be
    treated as a no-op.
    """
    if not isinstance(node, ast.If):
        return False
    for stmt in node.body + node.orelse:
        if isinstance(stmt, ast.Pass):
            continue
        if _is_return_none(stmt):
            continue
        if _is_log_or_print(stmt):
            continue
        if isinstance(stmt, ast.If):
            if not _is_trivial_if(stmt):
                return False
            continue
        return False
    return True


def _iter_nodes(
    tree: ast.AST,
    all_nodes: tuple[ast.AST, ...] | None,
    node_types,
):
    """Yield nodes of requested types from precomputed or walked AST nodes."""
    if all_nodes is not None:
        return (node for node in all_nodes if isinstance(node, node_types))
    return (node for node in ast.walk(tree) if isinstance(node, node_types))
