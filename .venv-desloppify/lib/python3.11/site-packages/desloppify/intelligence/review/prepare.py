"""Review preparation: prepare_review, prepare_holistic_review, batches."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from desloppify.base.discovery.file_paths import rel
from desloppify.base.output.fallbacks import log_best_effort_failure

from desloppify.base.discovery.source import (

    disable_file_cache,

    enable_file_cache,

    is_file_cache_enabled,

    read_file_text,

)
from desloppify.intelligence.review._prepare.helpers import append_full_sweep_batch
from desloppify.intelligence.review.context import (
    abs_path,
    build_review_context,
    dep_graph_lookup,
    importer_count,
    serialize_context,
)
from desloppify.intelligence.review.context_holistic.orchestrator import (
    build_holistic_context,
)
from desloppify.intelligence.review.dimensions.data import load_dimensions_for_lang
from desloppify.intelligence.review.dimensions.lang import get_lang_guidance
from desloppify.intelligence.review.dimensions.selection import resolve_dimensions
from desloppify.intelligence.review.prepare_batches_builders import (
    batch_concerns as _batch_concerns,
)
from desloppify.intelligence.review.prepare_batches_builders import (
    build_investigation_batches as _build_investigation_batches,
)
from desloppify.intelligence.review.prepare_batches_builders import (
    filter_batches_to_dimensions as _filter_batches_to_dimensions,
)
from desloppify.intelligence.review.prepare_holistic_batches import (
    HolisticBatchAssemblyDependencies,
    assemble_holistic_batches,
)
from desloppify.intelligence.review.prepare_holistic_orchestration import (
    HolisticPrepareDependencies,
    prepare_holistic_review_payload,
)
from desloppify.intelligence.review.selection import (
    ReviewSelectionOptions,
    count_fresh,
    count_stale,
    get_file_issues,
    select_files_for_review,
)

logger = logging.getLogger(__name__)


@dataclass
class ReviewPrepareOptions:
    """Configuration bundle for per-file review preparation."""

    max_files: int | None = None
    max_age_days: int = 30
    force_refresh: bool = True
    dimensions: list[str] | None = None
    config_dimensions: list[str] | None = None
    files: list[str] | None = None


@dataclass
class HolisticReviewPrepareOptions:
    """Configuration bundle for holistic review preparation."""

    dimensions: list[str] | None = None
    files: list[str] | None = None
    include_full_sweep: bool = False
    max_files_per_batch: int | None = None
    include_issue_history: bool = False
    issue_history_max_issues: int = 30
    issue_history_max_batch_items: int = 20

def _rel_list(s: set[str] | list[str]) -> list[str]:
    """Normalize a set or list of paths to sorted relative paths (max 10)."""
    if isinstance(s, set):
        return sorted(rel(x) for x in s)[:10]
    return [rel(x) for x in list(s)[:10]]


def _normalize_max_files(value: Any) -> int | None:
    """Normalize max_files input: None/<=0 means unlimited."""
    if value in (None, ""):
        return None
    parsed = int(value)
    return parsed if parsed > 0 else None


def prepare_review(
    path: Path,
    lang: object,
    state: dict,
    options: ReviewPrepareOptions | None = None,
) -> dict[str, object]:
    """Prepare review data for agent consumption. Returns structured dict.

    If *files* is provided, skip file_finder (avoids redundant filesystem walks
    when the caller already has the file list, e.g. from _setup_lang).
    """
    resolved_options = options or ReviewPrepareOptions()
    resolved_options.max_files = _normalize_max_files(resolved_options.max_files)
    all_files = (
        resolved_options.files
        if resolved_options.files is not None
        else (lang.file_finder(path) if lang.file_finder else [])
    )

    # Enable file cache for entire prepare operation — context building,
    # file selection, and content extraction all read the same files.
    already_cached = is_file_cache_enabled()
    if not already_cached:
        enable_file_cache()
    try:
        context = build_review_context(path, lang, state, files=all_files)
        selected = select_files_for_review(
            lang,
            path,
            state,
            options=ReviewSelectionOptions(
                max_files=resolved_options.max_files,
                max_age_days=resolved_options.max_age_days,
                force_refresh=resolved_options.force_refresh,
                files=all_files,
            ),
        )
        file_requests = _build_file_requests(selected, lang, state)
    finally:
        if not already_cached:
            disable_file_cache()

    default_dims, dimension_prompts, system_prompt = load_dimensions_for_lang(lang.name)
    dims = resolve_dimensions(
        cli_dimensions=resolved_options.dimensions,
        config_dimensions=resolved_options.config_dimensions,
        default_dimensions=default_dims,
    )
    lang_guide = get_lang_guidance(lang.name)
    valid_dims = set(dimension_prompts)
    invalid_requested = [
        dim for dim in (resolved_options.dimensions or []) if dim not in valid_dims
    ]
    invalid_config = [
        dim
        for dim in (resolved_options.config_dimensions or [])
        if dim not in valid_dims
    ]

    return {
        "command": "review",
        "language": lang.name,
        "dimensions": dims,
        "dimension_prompts": {
            d: dimension_prompts[d] for d in dims if d in dimension_prompts
        },
        "lang_guidance": lang_guide,
        "context": serialize_context(context),
        "system_prompt": system_prompt,
        "files": file_requests,
        "total_candidates": len(file_requests),
        "cache_status": {
            "fresh": count_fresh(state, resolved_options.max_age_days),
            "stale": count_stale(state, resolved_options.max_age_days),
            "new": len(file_requests),
        },
        "invalid_dimensions": {
            "requested": invalid_requested,
            "config": invalid_config,
        },
    }


def _build_file_requests(files: list[str], lang: object, state: dict) -> list[dict]:
    """Build per-file review request dicts."""
    file_requests = []
    for filepath in files:
        content = read_file_text(abs_path(filepath))
        if content is None:
            continue

        rpath = rel(filepath)
        zone = "production"
        if lang.zone_map is not None:
            zone = lang.zone_map.get(filepath).value

        neighbors: dict
        if lang.dep_graph:
            entry = dep_graph_lookup(lang.dep_graph, filepath)
            imports_raw = entry.get("imports", set())
            importers_raw = entry.get("importers", set())
            importer_count_value = importer_count(entry)
            neighbors = {
                "imports": _rel_list(imports_raw),
                "importers": _rel_list(importers_raw),
                "importer_count": importer_count_value,
            }
        else:
            neighbors = {}

        file_requests.append(
            {
                "file": rpath,
                "content": content,
                "zone": zone,
                "loc": len(content.splitlines()),
                "neighbors": neighbors,
                "existing_issues": get_file_issues(state, filepath),
            }
        )
    return file_requests


def prepare_holistic_review(
    path: Path,
    lang: object,
    state: dict,
    options: HolisticReviewPrepareOptions | None = None,
) -> dict[str, object]:
    """Prepare holistic review data for agent consumption. Returns structured dict."""
    resolved_options = options or HolisticReviewPrepareOptions()
    deps = HolisticPrepareDependencies(
        is_file_cache_enabled_fn=is_file_cache_enabled,
        enable_file_cache_fn=enable_file_cache,
        disable_file_cache_fn=disable_file_cache,
        build_holistic_context_fn=build_holistic_context,
        build_review_context_fn=build_review_context,
        load_dimensions_for_lang_fn=load_dimensions_for_lang,
        resolve_dimensions_fn=resolve_dimensions,
        get_lang_guidance_fn=get_lang_guidance,
        assemble_holistic_batches_fn=assemble_holistic_batches,
        holistic_batch_deps=HolisticBatchAssemblyDependencies(
            build_investigation_batches_fn=_build_investigation_batches,
            batch_concerns_fn=_batch_concerns,
            filter_batches_to_dimensions_fn=_filter_batches_to_dimensions,
            append_full_sweep_batch_fn=append_full_sweep_batch,
            log_best_effort_failure_fn=log_best_effort_failure,
            logger=logger,
        ),
        serialize_context_fn=serialize_context,
    )
    return prepare_holistic_review_payload(
        path,
        lang,
        state,
        resolved_options,
        deps=deps,
    )
