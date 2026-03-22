"""TypedDict and dict[Any] usage scanners."""

from __future__ import annotations

import ast

from desloppify.base.discovery.file_paths import rel

_VIOLATION_METHODS = frozenset({"get", "setdefault", "pop"})


def _collect_typed_dict_defs(
    tree: ast.Module, accumulator: dict[str, set[str]]
) -> None:
    """Collect TypedDict class definitions from a single file's AST."""
    for node in ast.walk(tree):
        if not isinstance(node, ast.ClassDef):
            continue
        is_typed_dict = any(
            (isinstance(base, ast.Name) and base.id == "TypedDict")
            or (isinstance(base, ast.Attribute) and base.attr == "TypedDict")
            for base in node.bases
        )
        if not is_typed_dict:
            continue
        fields: set[str] = set()
        for child in node.body:
            if isinstance(child, ast.AnnAssign) and isinstance(child.target, ast.Name):
                fields.add(child.target.id)
        if fields:
            accumulator[node.name] = fields


def _find_typed_dict_usage_violations(
    parsed_trees: dict[str, ast.Module],
    typed_dicts: dict[str, set[str]],
) -> list[dict]:
    """Find .get/.setdefault/.pop calls on TypedDict-annotated variables."""
    if not typed_dicts:
        return []

    violations: list[dict] = []
    for filepath, tree in parsed_trees.items():
        rpath = rel(filepath)

        typed_vars: dict[str, str] = {}
        for node in ast.walk(tree):
            if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
                ann_name = _annotation_name(node.annotation)
                if ann_name in typed_dicts:
                    typed_vars[node.target.id] = ann_name
            if isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef):
                for arg in node.args.args + node.args.kwonlyargs:
                    if arg.annotation is None:
                        continue
                    ann_name = _annotation_name(arg.annotation)
                    if ann_name in typed_dicts:
                        typed_vars[arg.arg] = ann_name

        if not typed_vars:
            continue

        hits: list[tuple[str, str, str | None, int]] = []
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            func = node.func
            if not isinstance(func, ast.Attribute):
                continue
            if func.attr not in _VIOLATION_METHODS:
                continue
            if not isinstance(func.value, ast.Name) or func.value.id not in typed_vars:
                continue
            td_name = typed_vars[func.value.id]
            field = _first_string_arg(node)
            hits.append((td_name, func.attr, field, node.lineno))

        groups: dict[tuple[str, str, str | None], list[int]] = {}
        for td_name, method, field, lineno in hits:
            groups.setdefault((td_name, method, field), []).append(lineno)

        for (td_name, method, field), lines in groups.items():
            entry: dict[str, object] = {
                "file": rpath,
                "typed_dict_name": td_name,
                "violation_type": method,
                "line": lines[0],
                "count": len(lines),
            }
            if field is not None:
                entry["field"] = field
            violations.append(entry)

    return violations


def _find_dict_any_annotations(
    parsed_trees: dict[str, ast.Module],
    typed_dict_names: set[str],
) -> list[dict]:
    """Find parameters/returns annotated as dict[str, Any]."""
    results: list[dict] = []
    for filepath, tree in parsed_trees.items():
        rpath = rel(filepath)
        for node in ast.walk(tree):
            if not isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef):
                continue

            all_args = node.args.posonlyargs + node.args.args + node.args.kwonlyargs
            if node.args.vararg:
                all_args.append(node.args.vararg)
            if node.args.kwarg:
                all_args.append(node.args.kwarg)

            for arg in all_args:
                if arg.annotation and _is_dict_str_any(arg.annotation):
                    alt = _guess_alternative(arg.arg, typed_dict_names)
                    results.append(
                        {
                            "file": rpath,
                            "function": node.name,
                            "param": arg.arg,
                            "line": arg.lineno,
                            "known_alternative": alt,
                        }
                    )

            if node.returns and _is_dict_str_any(node.returns):
                results.append(
                    {
                        "file": rpath,
                        "function": node.name,
                        "param": "(return)",
                        "line": node.lineno,
                        "known_alternative": None,
                    }
                )
    return results


def _annotation_name(annotation: ast.expr) -> str | None:
    if isinstance(annotation, ast.Name):
        return annotation.id
    if isinstance(annotation, ast.Attribute):
        return annotation.attr
    return None


def _first_string_arg(node: ast.Call) -> str | None:
    if not node.args:
        return None
    first = node.args[0]
    if isinstance(first, ast.Constant) and isinstance(first.value, str):
        return first.value
    return None


def _is_dict_str_any(annotation: ast.expr) -> bool:
    """Check if annotation is ``dict[str, Any]``."""
    if not isinstance(annotation, ast.Subscript):
        return False
    if not (isinstance(annotation.value, ast.Name) and annotation.value.id == "dict"):
        return False
    sl = annotation.slice
    if isinstance(sl, ast.Tuple) and len(sl.elts) == 2:
        first, second = sl.elts
        if isinstance(first, ast.Name) and first.id == "str":
            if isinstance(second, ast.Name) and second.id == "Any":
                return True
    return False


def _guess_alternative(param_name: str, typed_dict_names: set[str]) -> str | None:
    """Guess a TypedDict alternative by matching param name fragments."""
    if len(param_name) < 4:
        return None
    lower = param_name.lower()
    matches: list[str] = []
    for td_name in sorted(typed_dict_names):
        if td_name.lower() in lower or lower in td_name.lower():
            matches.append(td_name)
    if len(matches) == 1:
        return matches[0]
    return None


__all__ = [
    "_collect_typed_dict_defs",
    "_find_dict_any_annotations",
    "_find_typed_dict_usage_violations",
    "_guess_alternative",
    "_is_dict_str_any",
]
