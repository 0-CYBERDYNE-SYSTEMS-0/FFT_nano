"""Tree-level smell detector for hardcoded path separator usage."""

from __future__ import annotations

import ast

from desloppify.languages.python.detectors.smells_ast._helpers import (
    _iter_nodes,
    _looks_like_path_var,
)


def _path_like_name(obj: ast.AST) -> str:
    """Extract a variable-like name from Name/Attribute nodes."""
    if isinstance(obj, ast.Name):
        return obj.id
    if isinstance(obj, ast.Attribute):
        return obj.attr
    return ""


def _match_split_slash(filepath: str, node: ast.Call) -> dict | None:
    """Match ``path_var.split('/')`` style hardcoded separator usage."""
    if not (
        isinstance(node.func, ast.Attribute)
        and node.func.attr == "split"
        and len(node.args) == 1
        and isinstance(node.args[0], ast.Constant)
        and node.args[0].value == "/"
    ):
        return None

    obj = node.func.value
    if (
        isinstance(obj, ast.Call)
        and isinstance(obj.func, ast.Attribute)
        and obj.func.attr in ("relpath", "relative_to")
    ):
        return {
            "file": filepath,
            "line": node.lineno,
            "content": f'{ast.dump(obj.func)[:40]}.split("/")',
        }

    var_name = _path_like_name(obj)
    if var_name and _looks_like_path_var(var_name):
        return {
            "file": filepath,
            "line": node.lineno,
            "content": f'{var_name}.split("/")',
        }
    return None


def _match_startswith_slash(filepath: str, node: ast.Call) -> dict | None:
    """Match ``path_var.startswith('x/y')`` patterns with hardcoded slashes."""
    if not (
        isinstance(node.func, ast.Attribute)
        and node.func.attr == "startswith"
        and len(node.args) == 1
        and isinstance(node.args[0], ast.Constant)
        and isinstance(node.args[0].value, str)
        and "/" in node.args[0].value
        and not node.args[0].value.startswith(("@", "http", "//"))
    ):
        return None

    var_name = _path_like_name(node.func.value)
    if var_name and _looks_like_path_var(var_name):
        return {
            "file": filepath,
            "line": node.lineno,
            "content": f'{var_name}.startswith("{node.args[0].value}")',
        }
    return None


def _detect_hardcoded_path_sep(
    filepath: str,
    tree: ast.Module,
    all_nodes: tuple[ast.AST, ...] | None = None,
) -> list[dict]:
    """Flag path-string checks that hardcode '/' separators."""
    results: list[dict] = []
    for node in _iter_nodes(tree, all_nodes, ast.Call):
        split_match = _match_split_slash(filepath, node)
        if split_match is not None:
            results.append(split_match)

        startswith_match = _match_startswith_slash(filepath, node)
        if startswith_match is not None:
            results.append(startswith_match)
    return results


__all__ = ["_detect_hardcoded_path_sep"]
