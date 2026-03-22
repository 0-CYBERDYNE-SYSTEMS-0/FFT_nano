"""Score-impact and explain rendering helpers for next terminal output."""

from __future__ import annotations

from desloppify.engine._state.issue_semantics import is_review_finding


def _normalized_dimension_key(value: str | None) -> str:
    return str(value or "").lower().replace(" ", "_")


def _dimension_for_detector(detector: str, dim_scores: dict, *, get_dimension_for_detector_fn):
    dimension = get_dimension_for_detector_fn(detector)
    if not dimension or dimension.name not in dim_scores:
        return None, None
    return dimension, dim_scores[dimension.name]


def _review_dimension_entry(item: dict, breakdown: dict) -> dict | None:
    dim_key = item.get("detail", {}).get("dimension", "")
    if not dim_key:
        return None
    target_key = _normalized_dimension_key(dim_key)
    for entry in breakdown.get("entries", []):
        if isinstance(entry, dict) and _normalized_dimension_key(entry.get("name", "")) == target_key:
            return entry
    return None


def _review_dimension_score_entry(item: dict, dim_scores: dict) -> tuple[str, dict] | None:
    dim_key = _normalized_dimension_key(item.get("detail", {}).get("dimension", ""))
    if not dim_key:
        return None
    for ds_name, ds_data in dim_scores.items():
        if _normalized_dimension_key(ds_name) == dim_key:
            return ds_name, ds_data
    return None


def render_dimension_context(
    detector: str,
    dim_scores: dict,
    *,
    colorize_fn,
    get_dimension_for_detector_fn,
) -> None:
    if not dim_scores:
        return
    dimension, dimension_score = _dimension_for_detector(
        detector,
        dim_scores,
        get_dimension_for_detector_fn=get_dimension_for_detector_fn,
    )
    if dimension is None or dimension_score is None:
        return
    strict_val = dimension_score.get("strict", dimension_score["score"])
    print(
        colorize_fn(
            f"\n  Dimension: {dimension.name} — {dimension_score['score']:.1f}% "
            f"(strict: {strict_val:.1f}%) "
            f"({dimension_score.get('failing', 0)} of {dimension_score['checks']:,} checks failing)",
            "dim",
        )
    )


def render_detector_impact_estimate(
    detector: str,
    dim_scores: dict,
    potentials: dict,
    *,
    colorize_fn,
    log_fn,
    compute_score_impact_fn,
    get_dimension_for_detector_fn,
) -> None:
    try:
        impact = compute_score_impact_fn(dim_scores, potentials, detector, issues_to_fix=1)
        if impact > 0:
            print(
                colorize_fn(
                    f"  Impact: fixing this is worth ~+{impact:.1f} pts on overall score",
                    "cyan",
                )
            )
            return

        dimension, dimension_score = _dimension_for_detector(
            detector,
            dim_scores,
            get_dimension_for_detector_fn=get_dimension_for_detector_fn,
        )
        if dimension is None or dimension_score is None:
            return
        issues = dimension_score.get("failing", 0)
        if issues <= 1:
            return
        bulk = compute_score_impact_fn(dim_scores, potentials, detector, issues_to_fix=issues)
        if bulk > 0:
            print(
                colorize_fn(
                    f"  Impact: fixing all {issues} {detector} issues → ~+{bulk:.1f} pts",
                    "cyan",
                )
            )
    except (ImportError, TypeError, ValueError, KeyError) as exc:
        log_fn(f"  score impact estimate skipped: {exc}")


def render_review_dimension_drag(
    item: dict,
    dim_scores: dict,
    *,
    colorize_fn,
    log_fn,
    compute_health_breakdown_fn,
) -> None:
    try:
        breakdown = compute_health_breakdown_fn(dim_scores)
        entry = _review_dimension_entry(item, breakdown)
        if not entry:
            return
        drag = float(entry.get("overall_drag", 0) or 0)
        if drag > 0.01:
            print(
                colorize_fn(
                    f"  Dimension drag: {entry['name']} costs -{drag:.2f} pts on overall score",
                    "cyan",
                )
            )
    except (ImportError, TypeError, ValueError, KeyError) as exc:
        log_fn(f"  dimension drag estimate skipped: {exc}")


def render_score_impact(
    item: dict,
    dim_scores: dict,
    potentials: dict | None,
    *,
    colorize_fn,
    log_fn,
    compute_health_breakdown_fn,
    compute_score_impact_fn,
    get_dimension_for_detector_fn,
) -> None:
    detector = item.get("detector", "")
    has_detector_context = bool(detector and dim_scores)
    if has_detector_context:
        render_dimension_context(
            detector,
            dim_scores,
            colorize_fn=colorize_fn,
            get_dimension_for_detector_fn=get_dimension_for_detector_fn,
        )
    if has_detector_context and potentials:
        render_detector_impact_estimate(
            detector,
            dim_scores,
            potentials,
            colorize_fn=colorize_fn,
            log_fn=log_fn,
            compute_score_impact_fn=compute_score_impact_fn,
            get_dimension_for_detector_fn=get_dimension_for_detector_fn,
        )
        return
    if is_review_finding(item) and dim_scores:
        render_review_dimension_drag(
            item,
            dim_scores,
            colorize_fn=colorize_fn,
            log_fn=log_fn,
            compute_health_breakdown_fn=compute_health_breakdown_fn,
        )


def render_item_explain(
    item: dict,
    detail: dict,
    confidence: str,
    dim_scores: dict,
    *,
    colorize_fn,
    get_dimension_for_detector_fn,
) -> None:
    explanation = item.get("explain", {})
    count_weight = explanation.get("count", int(detail.get("count", 0) or 0))
    detector = item.get("detector", "")
    parts = [
        f"ranked by confidence={confidence}, "
        f"count={count_weight}, id={item.get('id', '')}"
    ]
    if dim_scores and detector:
        dimension, ds = _dimension_for_detector(
            detector,
            dim_scores,
            get_dimension_for_detector_fn=get_dimension_for_detector_fn,
        )
        if dimension is not None and ds is not None:
            parts.append(
                f"Dimension: {dimension.name} at {ds['score']:.1f}% "
                f"({ds.get('failing', 0)} open issues)"
            )
    if is_review_finding(item) and dim_scores:
        entry = _review_dimension_score_entry(item, dim_scores)
        if entry is not None:
            ds_name, ds_data = entry
            score_val = ds_data.get("score", "?")
            score_str = (
                f"{score_val:.1f}" if isinstance(score_val, int | float) else str(score_val)
            )
            parts.append(f"Subjective dimension: {ds_name} at {score_str}%")
    policy = explanation.get("policy")
    if policy:
        parts.append(str(policy))
    print(colorize_fn(f"  explain: {'. '.join(parts)}", "dim"))


__all__ = ["render_item_explain", "render_score_impact"]
