"""Enum bypass and type-strategy census scanners."""

from __future__ import annotations

import ast

from desloppify.base.discovery.file_paths import rel

_GENERIC_INT_VALUES: frozenset[object] = frozenset({0, 1, 2, 3, -1})


def _collect_enum_defs(
    parsed_trees: dict[str, ast.Module],
) -> dict[tuple[str, str], dict]:
    """Find StrEnum/IntEnum/Enum class defs."""
    enum_bases = {"StrEnum", "IntEnum", "Enum"}
    result: dict[tuple[str, str], dict] = {}
    for filepath, tree in parsed_trees.items():
        rpath = rel(filepath)
        for node in ast.walk(tree):
            if not isinstance(node, ast.ClassDef):
                continue
            is_enum = any(
                (isinstance(base, ast.Name) and base.id in enum_bases)
                or (isinstance(base, ast.Attribute) and base.attr in enum_bases)
                for base in node.bases
            )
            if not is_enum:
                continue
            members: dict[str, object] = {}
            for child in node.body:
                if isinstance(child, ast.Assign):
                    for target in child.targets:
                        if isinstance(target, ast.Name) and isinstance(
                            child.value, ast.Constant
                        ):
                            members[target.id] = child.value.value
            if members:
                result[(rpath, node.name)] = {"file": rpath, "members": members}
    return result


def _find_enum_bypass(
    parsed_trees: dict[str, ast.Module],
    enum_defs: dict[tuple[str, str], dict],
) -> list[dict]:
    """Find raw string/int comparisons that match enum member values."""
    if not enum_defs:
        return []

    enum_def_files: set[str] = {info["file"] for info in enum_defs.values()}

    value_to_enums: dict[object, list[tuple[str, str]]] = {}
    for (_file, enum_name), info in enum_defs.items():
        for member_name, value in info["members"].items():
            if isinstance(value, str):
                value_to_enums.setdefault(value, []).append((enum_name, member_name))
            elif isinstance(value, int) and value not in _GENERIC_INT_VALUES:
                value_to_enums.setdefault(value, []).append((enum_name, member_name))

    if not value_to_enums:
        return []

    results: list[dict] = []
    for filepath, tree in parsed_trees.items():
        rpath = rel(filepath)
        if rpath in enum_def_files:
            continue
        for node in ast.walk(tree):
            if not isinstance(node, ast.Compare):
                continue
            if not all(isinstance(op, ast.Eq | ast.NotEq) for op in node.ops):
                continue
            for const_node in [node.left, *node.comparators]:
                if not isinstance(const_node, ast.Constant):
                    continue
                key = const_node.value
                if key in value_to_enums:
                    for enum_name, member in value_to_enums[key]:
                        results.append(
                            {
                                "file": rpath,
                                "line": node.lineno,
                                "enum_name": enum_name,
                                "member": member,
                                "raw_value": repr(key),
                            }
                        )
    return results


def _census_type_strategies(
    parsed_trees: dict[str, ast.Module],
) -> dict[str, list[dict]]:
    """Count domain object definitions by strategy."""
    strategies: dict[str, list[dict]] = {
        "TypedDict": [],
        "dataclass": [],
        "frozen_dataclass": [],
        "NamedTuple": [],
    }
    for filepath, tree in parsed_trees.items():
        rpath = rel(filepath)
        for node in ast.walk(tree):
            if not isinstance(node, ast.ClassDef):
                continue
            field_count = sum(1 for child in node.body if isinstance(child, ast.AnnAssign))
            entry = {"name": node.name, "file": rpath, "field_count": field_count}

            if any(
                (isinstance(base, ast.Name) and base.id == "TypedDict")
                or (isinstance(base, ast.Attribute) and base.attr == "TypedDict")
                for base in node.bases
            ):
                strategies["TypedDict"].append(entry)
                continue

            if any(
                (isinstance(base, ast.Name) and base.id == "NamedTuple")
                or (isinstance(base, ast.Attribute) and base.attr == "NamedTuple")
                for base in node.bases
            ):
                strategies["NamedTuple"].append(entry)
                continue

            for decorator in node.decorator_list:
                is_dataclass = False
                is_frozen = False
                if isinstance(decorator, ast.Name) and decorator.id == "dataclass":
                    is_dataclass = True
                elif isinstance(decorator, ast.Attribute) and decorator.attr == "dataclass":
                    is_dataclass = True
                elif isinstance(decorator, ast.Call):
                    func = decorator.func
                    if (isinstance(func, ast.Name) and func.id == "dataclass") or (
                        isinstance(func, ast.Attribute) and func.attr == "dataclass"
                    ):
                        is_dataclass = True
                        for kw in decorator.keywords:
                            if (
                                kw.arg == "frozen"
                                and isinstance(kw.value, ast.Constant)
                                and kw.value.value is True
                            ):
                                is_frozen = True
                if is_dataclass:
                    key = "frozen_dataclass" if is_frozen else "dataclass"
                    strategies[key].append(entry)
                    break

    return {name: items for name, items in strategies.items() if items}


__all__ = [
    "_census_type_strategies",
    "_collect_enum_defs",
    "_find_enum_bypass",
]
