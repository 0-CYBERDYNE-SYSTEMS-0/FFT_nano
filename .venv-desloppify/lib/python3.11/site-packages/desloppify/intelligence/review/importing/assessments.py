"""Assessment storage helpers for review imports."""

from __future__ import annotations

from typing import Any

from desloppify.base.text_utils import is_numeric
from desloppify.engine._state.schema import StateModel, utc_now
from desloppify.engine._state.schema_types_review import (
    ContextInsight,
    DimensionContext,
)
from desloppify.intelligence.review.dimensions import normalize_dimension_name


def _clean_judgment(raw: dict[str, Any]) -> dict[str, Any] | None:
    """Validate and clean a dimension judgment payload. Returns None if empty."""
    strengths_raw = raw.get("strengths")
    strengths: list[str] = []
    if isinstance(strengths_raw, list):
        strengths = [
            str(s).strip()
            for s in strengths_raw[:5]
            if isinstance(s, str) and str(s).strip()
        ]

    dimension_character = ""
    dc = raw.get("dimension_character")
    if isinstance(dc, str) and dc.strip():
        dimension_character = dc.strip()

    score_rationale = ""
    sr = raw.get("score_rationale")
    if isinstance(sr, str) and sr.strip():
        score_rationale = sr.strip()

    if not strengths and not dimension_character and not score_rationale:
        return None

    result: dict[str, Any] = {}
    if strengths:
        result["strengths"] = strengths
    if dimension_character:
        result["dimension_character"] = dimension_character
    if score_rationale:
        result["score_rationale"] = score_rationale
    return result


def store_assessments(
    state: StateModel,
    assessments: dict[str, Any],
    source: str,
    *,
    utc_now_fn=utc_now,
    dimension_judgment: dict[str, dict[str, Any]] | None = None,
) -> None:
    """Store dimension assessments in state.

    *assessments*: ``{dim_name: score}`` or ``{dim_name: {score, ...}}``.
    *source*: ``"per_file"`` or ``"holistic"``.
    *dimension_judgment*: optional ``{dim_name: {strengths, dimension_character, score_rationale}}``.

    Holistic assessments overwrite per-file for the same dimension.
    Per-file assessments don't overwrite holistic.
    """
    store = state.setdefault("subjective_assessments", {})
    now = utc_now_fn()
    judgments = dimension_judgment or {}

    for dimension_name, value in assessments.items():
        value_obj = value if isinstance(value, dict) else {}
        score = value if is_numeric(value) else value_obj.get("score", 0)
        score = max(0, min(100, score))
        dimension_key = normalize_dimension_name(str(dimension_name))
        if not dimension_key:
            continue

        existing = store.get(dimension_key)
        if existing and existing.get("source") == "holistic" and source == "per_file":
            continue

        cleaned_components: list[str] = []
        components = value_obj.get("components")
        if isinstance(components, list):
            cleaned_components = [
                str(item).strip()
                for item in components
                if isinstance(item, str) and item.strip()
            ]

        component_scores = value_obj.get("component_scores")
        cleaned_scores: dict[str, float] = {}
        if isinstance(component_scores, dict):
            for key, raw in component_scores.items():
                if not isinstance(key, str) or not key.strip():
                    continue
                if not is_numeric(raw):
                    continue
                cleaned_scores[key.strip()] = round(max(0.0, min(100.0, float(raw))), 1)

        # Clean and attach judgment if available
        judgment_raw = judgments.get(dimension_name) or judgments.get(dimension_key)
        cleaned_judgment: dict[str, Any] | None = None
        if isinstance(judgment_raw, dict):
            cleaned_judgment = _clean_judgment(judgment_raw)

        store[dimension_key] = {
            "score": score,
            "source": source,
            "assessed_at": now,
            **({"components": cleaned_components} if cleaned_components else {}),
            **({"component_scores": cleaned_scores} if cleaned_scores else {}),
            **({"judgment": cleaned_judgment} if cleaned_judgment else {}),
        }


def store_context_updates(
    state: StateModel,
    context_updates: dict[str, dict[str, Any]] | None,
    *,
    valid_dimensions: set[str] | None = None,
    utc_now_fn=utc_now,
    source: str = "holistic",
) -> None:
    """Apply per-dimension context updates (add/remove/settle/unsettle) to state."""
    if not context_updates:
        return

    all_contexts: dict[str, DimensionContext] = state.setdefault("dimension_contexts", {})
    now = utc_now_fn()

    for dim_name, updates in context_updates.items():
        if not isinstance(updates, dict):
            continue
        dim_key = normalize_dimension_name(str(dim_name))
        if not dim_key:
            continue
        if valid_dimensions is not None and dim_key not in valid_dimensions:
            continue

        ctx: DimensionContext = all_contexts.get(dim_key, {})
        is_new = dim_key not in all_contexts
        insights: list[ContextInsight] = list(ctx.get("insights", []))
        changed = False

        # Build header lookup (case-insensitive)
        header_index = {
            str(ins.get("header", "")).strip().lower(): i
            for i, ins in enumerate(insights)
        }

        # Remove
        for header in updates.get("remove", []):
            if not isinstance(header, str):
                continue
            key = header.strip().lower()
            if key in header_index:
                idx = header_index[key]
                insights.pop(idx)
                # Rebuild index after removal
                header_index = {
                    str(ins.get("header", "")).strip().lower(): i
                    for i, ins in enumerate(insights)
                }
                changed = True

        # Add (dedup by header)
        for item in updates.get("add", []):
            if not isinstance(item, dict):
                continue
            header = str(item.get("header", "")).strip()
            if not header:
                continue
            key = header.lower()
            if key in header_index:
                # Update existing insight's description
                idx = header_index[key]
                desc = str(item.get("description", "")).strip()
                if desc and desc != str(insights[idx].get("description", "")).strip():
                    insights[idx]["description"] = desc
                    changed = True
                if item.get("settled") is not None:
                    insights[idx]["settled"] = bool(item["settled"])
                    changed = True
                if item.get("positive") is not None:
                    insights[idx]["positive"] = bool(item["positive"])
                    changed = True
                continue
            new_insight: ContextInsight = {
                "header": header,
                "description": str(item.get("description", "")).strip(),
                "settled": bool(item.get("settled", False)),
                "positive": bool(item.get("positive", False)),
                "added_at": now,
                "source": source,
            }
            insights.append(new_insight)
            header_index[key] = len(insights) - 1
            changed = True

        # Settle
        for header in updates.get("settle", []):
            if not isinstance(header, str):
                continue
            key = header.strip().lower()
            if key in header_index:
                idx = header_index[key]
                if not insights[idx].get("settled"):
                    insights[idx]["settled"] = True
                    changed = True

        # Unsettle
        for header in updates.get("unsettle", []):
            if not isinstance(header, str):
                continue
            key = header.strip().lower()
            if key in header_index:
                idx = header_index[key]
                if insights[idx].get("settled"):
                    insights[idx]["settled"] = False
                    changed = True

        ctx["insights"] = insights
        if changed:
            ctx["stable_rounds"] = 0
            ctx["updated_at"] = now
        else:
            ctx["stable_rounds"] = ctx.get("stable_rounds", 0) + 1

        if is_new:
            ctx["created_at"] = now
            if "updated_at" not in ctx:
                ctx["updated_at"] = now

        all_contexts[dim_key] = ctx


def backfill_judgment_strengths(
    state: StateModel,
    context_updates: dict[str, dict[str, Any]],
) -> None:
    """Derive judgment.strengths from positive context insights."""
    assessments_store = state.get("subjective_assessments", {})
    contexts_store = state.get("dimension_contexts", {})
    for dim_name in context_updates:
        dim_key = normalize_dimension_name(str(dim_name))
        if not dim_key:
            continue
        assessment = assessments_store.get(dim_key)
        if not isinstance(assessment, dict):
            continue
        ctx = contexts_store.get(dim_key, {})
        positive_headers = [
            str(ins.get("header", "")).strip()
            for ins in ctx.get("insights", [])
            if isinstance(ins, dict) and ins.get("positive")
        ]
        judgment = assessment.get("judgment")
        if not isinstance(judgment, dict):
            judgment = {}
            assessment["judgment"] = judgment
        if positive_headers:
            judgment["strengths"] = positive_headers[:5]
