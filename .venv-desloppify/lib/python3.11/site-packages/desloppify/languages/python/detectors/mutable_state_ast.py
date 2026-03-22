"""AST-level helpers for mutable-state detection."""

from __future__ import annotations

import ast
import re

# Mutable initializer values
_MUTABLE_INIT = (ast.List, ast.Dict, ast.Set)
_MUTABLE_CALL_NAMES = {"set", "list", "dict", "defaultdict", "OrderedDict", "Counter"}

# Mutating method names
_MUTATING_METHODS = {
    "append",
    "extend",
    "insert",
    "pop",
    "remove",
    "clear",
    "update",
    "setdefault",
    "add",
    "discard",
}


def _is_mutable_init(value: ast.AST) -> bool:
    """Check if an AST value is a mutable initializer ([], {}, set(), etc.)."""
    if isinstance(value, _MUTABLE_INIT):
        return True
    if isinstance(value, ast.Call):
        func = value.func
        if isinstance(func, ast.Name) and func.id in _MUTABLE_CALL_NAMES:
            return True
        if isinstance(func, ast.Attribute) and func.attr in _MUTABLE_CALL_NAMES:
            return True
    if isinstance(value, ast.Constant) and value.value is None:
        return True
    return False


def _is_upper_case(name: str) -> bool:
    """Check if a name is UPPER_CASE (constant convention)."""
    return bool(re.match(r"^_?[A-Z][A-Z0-9_]+$", name))


def _is_optional_annotation(ann: ast.AST) -> bool:
    """Check if an annotation looks like Optional[...]."""
    is_optional_subscript = isinstance(ann, ast.Subscript) and (
        (isinstance(ann.value, ast.Name) and ann.value.id == "Optional")
        or (isinstance(ann.value, ast.Attribute) and ann.value.attr == "Optional")
    )
    is_optional_union = (
        isinstance(ann, ast.BinOp)
        and isinstance(ann.op, ast.BitOr)
        and (
            (isinstance(ann.right, ast.Constant) and ann.right.value is None)
            or (isinstance(ann.left, ast.Constant) and ann.left.value is None)
        )
    )
    return is_optional_subscript or is_optional_union


def _collect_module_level_mutables(tree: ast.Module) -> dict[str, int]:
    """Collect module-level names initialized to mutable values.

    UPPER_CASE names with truly immutable values (strings, ints, tuples,
    frozensets) are already filtered out by ``_is_mutable_init()``.
    UPPER_CASE mutable containers (``REGISTRY = {}``, ``ITEMS = []``) are
    included - they represent runtime-mutated registries, not constants.
    """
    mutables: dict[str, int] = {}
    for stmt in tree.body:
        if isinstance(stmt, ast.Assign):
            for target in stmt.targets:
                if isinstance(target, ast.Name) and _is_mutable_init(stmt.value):
                    if _is_upper_case(target.id) and isinstance(stmt.value, ast.Constant):
                        continue
                    mutables[target.id] = stmt.lineno
        elif (
            isinstance(stmt, ast.AnnAssign)
            and stmt.target
            and isinstance(stmt.target, ast.Name)
        ):
            name = stmt.target.id
            # Mutable initializer -> always include regardless of case.
            if stmt.value is not None and _is_mutable_init(stmt.value):
                if _is_upper_case(name) and isinstance(stmt.value, ast.Constant):
                    continue
                mutables[name] = stmt.lineno
            elif _is_optional_annotation(stmt.annotation):
                # Optional without mutable init - exempt UPPER_CASE
                # (likely a sentinel, not a mutable registry).
                if not _is_upper_case(name):
                    mutables[name] = stmt.lineno
    return mutables


def _find_mutations_in_functions(
    tree: ast.Module, mutables: dict[str, int]
) -> dict[str, list[int]]:
    """Find functions that reassign or mutate module-level mutable names.

    Returns {name: [line numbers where mutation occurs]}.

    Bare assignments (name = x) and augmented assignments (name += x) only count
    as mutations when the function has an explicit `global name` declaration -
    without it, Python creates a local variable. Subscript assignments (name[k] = v)
    and method calls (name.append(x)) don't need `global` because they operate on
    the object reference, not rebind the name.
    """
    mutations: dict[str, list[int]] = {}

    for node in ast.walk(tree):
        if not isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef):
            continue
        param_names = {
            a.arg for a in node.args.args + node.args.posonlyargs + node.args.kwonlyargs
        }
        global_names: set[str] = set()
        for child in ast.walk(node):
            if isinstance(child, ast.Global):
                global_names.update(child.names)

        for child in ast.walk(node):
            if isinstance(child, ast.Assign):
                for target in child.targets:
                    if (
                        isinstance(target, ast.Name)
                        and target.id in mutables
                        and target.id not in param_names
                    ):
                        if target.id in global_names:
                            mutations.setdefault(target.id, []).append(child.lineno)
                    elif isinstance(target, ast.Subscript) and isinstance(
                        target.value, ast.Name
                    ):
                        if (
                            target.value.id in mutables
                            and target.value.id not in param_names
                        ):
                            mutations.setdefault(target.value.id, []).append(child.lineno)
            elif isinstance(child, ast.AugAssign):
                if (
                    isinstance(child.target, ast.Name)
                    and child.target.id in mutables
                    and child.target.id not in param_names
                    and child.target.id in global_names
                ):
                    mutations.setdefault(child.target.id, []).append(child.lineno)
            elif isinstance(child, ast.Call) and isinstance(child.func, ast.Attribute):
                if (
                    child.func.attr in _MUTATING_METHODS
                    and isinstance(child.func.value, ast.Name)
                    and child.func.value.id in mutables
                    and child.func.value.id not in param_names
                ):
                    mutations.setdefault(child.func.value.id, []).append(child.lineno)

    return mutations


def _detect_in_module(filepath: str, tree: ast.Module, entries: list[dict]) -> None:
    """Detect global mutable config patterns in a single module."""
    mutables = _collect_module_level_mutables(tree)
    if not mutables:
        return

    mutations = _find_mutations_in_functions(tree, mutables)
    if not mutations:
        return

    for name, mutation_lines in mutations.items():
        defn_line = mutables[name]
        entries.append(
            {
                "file": filepath,
                "name": name,
                "line": defn_line,
                "mutation_lines": mutation_lines[:5],
                "mutation_count": len(mutation_lines),
                "confidence": "medium",
                "summary": (
                    f"Module-level mutable '{name}' (line {defn_line}) "
                    f"modified from {len(mutation_lines)} site(s)"
                ),
            }
        )


__all__ = [
    "_collect_module_level_mutables",
    "_detect_in_module",
    "_find_mutations_in_functions",
    "_is_mutable_init",
    "_is_optional_annotation",
    "_is_upper_case",
]
