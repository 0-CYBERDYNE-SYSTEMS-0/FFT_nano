"""Shared internals for building per-file review context payloads."""

from __future__ import annotations

import re
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from desloppify.engine._state.schema import StateModel
from desloppify.intelligence.review._context.models import ReviewContext


@dataclass(frozen=True)
class ReviewContextBuildServices:
    """Typed dependency bundle for review-context assembly."""

    read_file_text: Callable[[str], str | None]
    abs_path: Callable[[str], str]
    rel_path: Callable[[str], str]
    importer_count: Callable[[dict[str, object]], int]
    default_review_module_patterns: Callable[[str], list[str] | tuple[str, ...] | set[str]]
    gather_ai_debt_signals: Callable[..., dict[str, object]]
    gather_auth_context: Callable[..., dict[str, object]]
    classify_error_strategy: Callable[[str], str]
    func_name_re: re.Pattern[str]
    class_name_re: re.Pattern[str]
    name_prefix_re: re.Pattern[str]
    error_patterns: dict[str, re.Pattern[str]]


def build_review_context_inner(
    files: list[str],
    lang: object,
    state: StateModel,
    ctx: ReviewContext,
    services: ReviewContextBuildServices,
) -> ReviewContext:
    """Inner context builder (runs with file cache enabled)."""
    file_contents: dict[str, str] = {}
    for filepath in files:
        content = services.read_file_text(services.abs_path(filepath))
        if content is not None:
            file_contents[filepath] = content

    prefix_counter: Counter = Counter()
    total_names = 0
    for content in file_contents.values():
        for name in services.func_name_re.findall(content) + services.class_name_re.findall(
            content
        ):
            total_names += 1
            match = services.name_prefix_re.match(name)
            if match:
                prefix_counter[match.group(1)] += 1
    ctx.naming_vocabulary = {
        "prefixes": dict(prefix_counter.most_common(20)),
        "total_names": total_names,
    }

    error_counts: Counter = Counter()
    for content in file_contents.values():
        for pattern_name, pattern in services.error_patterns.items():
            if pattern.search(content):
                error_counts[pattern_name] += 1
    ctx.error_conventions = dict(error_counts)

    dir_patterns: dict[str, Counter] = {}
    module_pattern_fn = getattr(lang, "review_module_patterns_fn", None)
    if not callable(module_pattern_fn):
        module_pattern_fn = services.default_review_module_patterns
    for filepath, content in file_contents.items():
        parts = Path(filepath).parts
        if len(parts) < 2:
            continue
        dir_name = parts[-2] + "/"
        counter = dir_patterns.setdefault(dir_name, Counter())
        pattern_names = module_pattern_fn(content)
        if not isinstance(pattern_names, list | tuple | set):
            pattern_names = services.default_review_module_patterns(content)
        for pattern_name in pattern_names:
            counter[pattern_name] += 1
        if re.search(r"\bclass\s+\w+", content):
            counter["class_based"] += 1
    ctx.module_patterns = {
        d: dict(c.most_common(3))
        for d, c in dir_patterns.items()
        if sum(c.values()) >= 3
    }

    if lang.dep_graph:
        graph = lang.dep_graph
        importer_counts = {}
        for filepath, entry in graph.items():
            count = services.importer_count(entry)
            if count > 0:
                importer_counts[services.rel_path(filepath)] = count
        top = sorted(importer_counts.items(), key=lambda item: -item[1])[:20]
        ctx.import_graph_summary = {"top_imported": dict(top)}

    if lang.zone_map is not None:
        ctx.zone_distribution = lang.zone_map.counts()

    allowed_review_files = {
        services.rel_path(filepath)
        for filepath in file_contents
        if isinstance(filepath, str) and filepath
    }
    issues = (state.get("work_items") or state.get("issues", {}))
    by_file: dict[str, list[str]] = {}
    for issue in issues.values():
        if issue.get("status") != "open":
            continue
        issue_file_raw = issue.get("file", "")
        if not isinstance(issue_file_raw, str) or not issue_file_raw:
            continue
        issue_file = services.rel_path(issue_file_raw)
        if issue_file not in allowed_review_files:
            continue
        by_file.setdefault(issue_file, []).append(
            f"{issue['detector']}: {issue['summary'][:80]}"
        )
    ctx.existing_issues = by_file

    total_files = len(file_contents)
    total_loc = sum(len(content.splitlines()) for content in file_contents.values())
    ctx.codebase_stats = {
        "total_files": total_files,
        "total_loc": total_loc,
        "avg_file_loc": total_loc // total_files if total_files else 0,
    }
    _ = (
        ctx.codebase_stats["total_files"],
        ctx.codebase_stats["total_loc"],
        ctx.codebase_stats["avg_file_loc"],
    )

    dir_functions: dict[str, Counter] = {}
    for filepath, content in file_contents.items():
        parts = Path(filepath).parts
        if len(parts) < 2:
            continue
        dir_name = parts[-2] + "/"
        counter = dir_functions.setdefault(dir_name, Counter())
        for name in services.func_name_re.findall(content):
            match = services.name_prefix_re.match(name)
            if match:
                counter[match.group(1)] += 1
    ctx.sibling_conventions = {
        d: dict(c.most_common(5))
        for d, c in dir_functions.items()
        if sum(c.values()) >= 3
    }

    ctx.ai_debt_signals = services.gather_ai_debt_signals(
        file_contents,
        rel_fn=services.rel_path,
    )
    ctx.auth_patterns = services.gather_auth_context(
        file_contents,
        rel_fn=services.rel_path,
    )

    strategies: dict[str, str] = {}
    for filepath, content in file_contents.items():
        strategy = services.classify_error_strategy(content)
        if strategy:
            strategies[services.rel_path(filepath)] = strategy
    ctx.error_strategies = strategies

    ctx.normalize_sections(strict=True)
    return ctx


__all__ = [
    "ReviewContextBuildServices",
    "build_review_context_inner",
]
