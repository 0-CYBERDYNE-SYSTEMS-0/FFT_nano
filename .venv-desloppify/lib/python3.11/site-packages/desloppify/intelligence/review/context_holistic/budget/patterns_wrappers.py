"""Wrapper, delegation, and facade pattern scanners."""

from __future__ import annotations

import ast

from .analysis import _strip_docstring


def _python_passthrough_target(stmt: ast.stmt) -> str | None:
    """Return passthrough call target when stmt is `return target(...)`."""
    if not isinstance(stmt, ast.Return):
        return None
    value = stmt.value
    if not isinstance(value, ast.Call):
        return None
    target = value.func
    if isinstance(target, ast.Name):
        return target.id
    return None


def _find_python_passthrough_wrappers(tree: ast.Module) -> list[tuple[str, str]]:
    """Find Python wrapper pairs via AST traversal."""
    wrappers: list[tuple[str, str]] = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef):
            continue

        body = _strip_docstring(list(node.body))
        if len(body) != 1:
            continue

        target_name = _python_passthrough_target(body[0])
        if target_name and node.name != target_name:
            wrappers.append((node.name, target_name))
    return wrappers


def _is_delegation_stmt(stmt: ast.stmt) -> str | None:
    """Return delegate attribute when *stmt* is a pure delegation call/access."""
    if isinstance(stmt, ast.Expr):
        value = stmt.value
    elif isinstance(stmt, ast.Return) and stmt.value is not None:
        value = stmt.value
    else:
        return None

    if isinstance(value, ast.Call):
        value = value.func

    node = value
    depth = 0
    while isinstance(node, ast.Attribute):
        node = node.value
        depth += 1
    if depth < 1 or not isinstance(node, ast.Name) or node.id != "self":
        return None

    first = value
    while isinstance(first, ast.Attribute) and isinstance(first.value, ast.Attribute):
        first = first.value
    if isinstance(first, ast.Attribute) and isinstance(first.value, ast.Name):
        return first.attr
    return None


def _find_delegation_heavy_classes(tree: ast.Module) -> list[dict]:
    """Find classes where most methods delegate to a single inner object."""
    results: list[dict] = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.ClassDef):
            continue

        methods: list[ast.FunctionDef | ast.AsyncFunctionDef] = [
            child
            for child in node.body
            if isinstance(child, ast.FunctionDef | ast.AsyncFunctionDef)
            and child.name != "__init__"
        ]
        if len(methods) <= 3:
            continue

        delegating_methods: dict[str, list[str]] = {}
        for method in methods:
            body = _strip_docstring(list(method.body))
            if len(body) != 1:
                continue
            attr = _is_delegation_stmt(body[0])
            if attr:
                delegating_methods.setdefault(attr, []).append(method.name)

        if not delegating_methods:
            continue

        top_attr = max(delegating_methods, key=lambda a: len(delegating_methods[a]))
        delegate_count = len(delegating_methods[top_attr])
        ratio = delegate_count / len(methods)
        if ratio > 0.5:
            results.append(
                {
                    "class_name": node.name,
                    "line": node.lineno,
                    "delegation_ratio": round(ratio, 2),
                    "method_count": len(methods),
                    "delegate_count": delegate_count,
                    "delegate_target": top_attr,
                    "sample_methods": delegating_methods[top_attr][:5],
                }
            )
    return results


def _find_facade_modules(tree: ast.Module, *, loc: int) -> dict | None:
    """Detect modules where >70% of public names come from imports."""
    import_names: set[str] = set()
    defined_names: set[str] = set()

    for node in ast.iter_child_nodes(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                name = alias.asname or alias.name.split(".")[-1]
                import_names.add(name)
        elif isinstance(node, ast.ImportFrom):
            for alias in node.names:
                if alias.name == "*":
                    continue
                name = alias.asname or alias.name
                import_names.add(name)
        elif isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef):
            defined_names.add(node.name)
        elif isinstance(node, ast.ClassDef):
            defined_names.add(node.name)
        elif isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id == "__all__":
                    continue
                if isinstance(target, ast.Name):
                    defined_names.add(target.id)

    public_imports = {n for n in import_names if not n.startswith("_")}
    public_defs = {n for n in defined_names if not n.startswith("_")}

    total_public = len(public_imports | public_defs)
    if total_public < 3:
        return None

    re_exported = public_imports - public_defs
    re_export_ratio = len(re_exported) / total_public

    if re_export_ratio < 0.7 or len(public_defs) > 3:
        return None

    return {
        "re_export_ratio": round(re_export_ratio, 2),
        "defined_symbols": len(public_defs),
        "re_exported_symbols": len(re_exported),
        "samples": sorted(re_exported)[:5],
        "loc": loc,
    }


__all__ = [
    "_find_delegation_heavy_classes",
    "_find_facade_modules",
    "_find_python_passthrough_wrappers",
    "_is_delegation_stmt",
    "_python_passthrough_target",
]
