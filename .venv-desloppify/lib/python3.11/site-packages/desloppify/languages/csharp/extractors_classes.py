"""Class extraction helpers for C# parser module."""

from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from desloppify.engine.detectors.base import ClassInfo, FunctionInfo


@dataclass(frozen=True)
class CSharpExtractorDeps:
    """Shared parser dependencies for C# class/method extraction."""

    class_decl_re: re.Pattern[str]
    method_decl_re: re.Pattern[str]
    method_keywords: set[str]
    field_re: re.Pattern[str]
    find_matching_brace_fn: Callable[[str, int], int | None]
    find_expression_end_fn: Callable[[str, int], int | None]
    extract_params_fn: Callable[[str], list[str]]


def _extract_methods_from_block(
    block: str,
    filepath: str,
    line_offset: int,
    *,
    method_decl_re: re.Pattern[str],
    method_keywords: set[str],
    find_matching_brace_fn: Callable[[str, int], int | None],
    find_expression_end_fn: Callable[[str, int], int | None],
    extract_params_fn: Callable[[str], list[str]],
) -> list[FunctionInfo]:
    methods: list[FunctionInfo] = []
    for match in method_decl_re.finditer(block):
        name = match.group(1)
        if name in method_keywords:
            continue
        start_line = line_offset + block.count("\n", 0, match.start())
        if match.group(3) == "{":
            open_pos = match.end() - 1
            end = find_matching_brace_fn(block, open_pos)
            if end is None:
                continue
            end_line = line_offset + block.count("\n", 0, end)
        else:
            end = find_expression_end_fn(block, match.end())
            if end is None:
                continue
            end_line = line_offset + block.count("\n", 0, end)
        methods.append(
            FunctionInfo(
                name=name,
                file=filepath,
                line=max(1, start_line),
                end_line=max(1, end_line),
                loc=max(1, end_line - start_line + 1),
                body="",
                params=extract_params_fn(match.group(2)),
            )
        )
    return methods


def _extract_attributes_from_block(
    block: str, *, field_re: re.Pattern[str]
) -> list[str]:
    attrs: set[str] = set()
    for line in block.splitlines():
        stripped = line.strip()
        if "(" in stripped:
            continue
        match = field_re.match(line)
        if match:
            attrs.add(match.group(1))
    return sorted(attrs)


def _parse_base_classes(inherit: str) -> list[str]:
    if ":" not in inherit:
        return []
    right = inherit.split(":", 1)[1]
    right = right.split("where", 1)[0]
    bases = []
    for raw in right.split(","):
        token = raw.strip()
        if not token:
            continue
        token = token.split("<", 1)[0].strip()
        token = token.split(".")[-1]
        if re.match(r"^[A-Za-z_]\w*$", token):
            bases.append(token)
    return bases


def extract_classes_from_file(
    filepath: str,
    content: str,
    *,
    deps: CSharpExtractorDeps,
) -> list[ClassInfo]:
    classes: list[ClassInfo] = []
    for match in deps.class_decl_re.finditer(content):
        name = match.group(1)
        inherit = match.group(2) or ""
        open_pos = match.end() - 1
        end = deps.find_matching_brace_fn(content, open_pos)
        if end is None:
            continue

        start_line = content.count("\n", 0, match.start()) + 1
        end_line = content.count("\n", 0, end) + 1
        loc = max(1, end_line - start_line + 1)
        block = content[match.start() : end + 1]
        methods = _extract_methods_from_block(
            block,
            filepath,
            start_line,
            method_decl_re=deps.method_decl_re,
            method_keywords=deps.method_keywords,
            find_matching_brace_fn=deps.find_matching_brace_fn,
            find_expression_end_fn=deps.find_expression_end_fn,
            extract_params_fn=deps.extract_params_fn,
        )
        attributes = _extract_attributes_from_block(block, field_re=deps.field_re)
        base_classes = _parse_base_classes(inherit)
        classes.append(
            ClassInfo(
                name=name,
                file=filepath,
                line=start_line,
                loc=loc,
                methods=methods,
                attributes=attributes,
                base_classes=base_classes,
            )
        )
    return classes


def extract_csharp_classes(
    path: Path | str,
    *,
    find_files_fn: Callable[[Path | str], list[str]],
    read_file_fn: Callable[[str], str | None],
    deps: CSharpExtractorDeps,
) -> list[ClassInfo]:
    classes: list[ClassInfo] = []
    for filepath in find_files_fn(path):
        content = read_file_fn(filepath)
        if content is None:
            continue
        classes.extend(
            extract_classes_from_file(
                filepath,
                content,
                deps=deps,
            )
        )
    return classes


__all__ = ["CSharpExtractorDeps", "extract_csharp_classes", "extract_classes_from_file"]
