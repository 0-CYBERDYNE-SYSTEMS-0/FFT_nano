"""Abstraction-economy scoring and context assembly helpers."""

from __future__ import annotations

from .analysis import _score_clamped


def _compute_sub_axes(
    *,
    wrapper_rate: float,
    util_files: list,
    indirection_hotspots: list,
    wide_param_bags: list,
    one_impl_interfaces: list,
    delegation_classes: list,
    facade_modules: list,
    typed_dict_violation_files: set,
    total_typed_dict_violations: int,
    dict_any_count: int = 0,
    enum_bypass_count: int = 0,
) -> dict[str, float]:
    """Compute all 6 sub-axis scores for the abstractions dimension."""
    abstraction_leverage = _score_clamped(
        100 - (wrapper_rate * 120) - (len(util_files) * 1.5)
    )
    indirection_cost = _score_clamped(
        100
        - (sum(item["max_chain_depth"] for item in indirection_hotspots[:20]) * 2.5)
        - (sum(item["wide_functions"] for item in wide_param_bags[:20]) * 2.0)
    )
    interface_honesty = _score_clamped(100 - (len(one_impl_interfaces) * 8))

    top10_delegation = delegation_classes[:10]
    avg_delegation_ratio = (
        sum(d["delegation_ratio"] for d in top10_delegation) / len(top10_delegation)
        if top10_delegation
        else 0.0
    )
    delegation_density = _score_clamped(
        100 - (avg_delegation_ratio * 80) - (len(delegation_classes) * 5)
    )
    avg_facade_ratio = (
        sum(f["re_export_ratio"] for f in facade_modules[:10]) / len(facade_modules[:10])
        if facade_modules
        else 0.0
    )
    definition_directness = _score_clamped(
        100 - (len(facade_modules) * 8) - (avg_facade_ratio * 50)
    )
    type_discipline = _score_clamped(
        100
        - (len(typed_dict_violation_files) * 6)
        - (total_typed_dict_violations * 1.5)
        - (dict_any_count * 1.0)
        - (enum_bypass_count * 2.0)
    )
    return {
        "abstraction_leverage": abstraction_leverage,
        "indirection_cost": indirection_cost,
        "interface_honesty": interface_honesty,
        "delegation_density": delegation_density,
        "definition_directness": definition_directness,
        "type_discipline": type_discipline,
    }


def _build_abstraction_leverage_context(
    *,
    util_files: list[dict],
    wrappers_by_file: list[dict[str, object]],
) -> dict[str, object]:
    context: dict[str, object] = {}
    if util_files:
        context["util_files"] = sorted(util_files, key=lambda item: -item["loc"])[:20]
    if wrappers_by_file:
        context["pass_through_wrappers"] = wrappers_by_file[:20]
    return context


def _build_indirection_cost_context(
    *,
    indirection_hotspots: list[dict[str, object]],
    wide_param_bags: list[dict[str, object]],
) -> dict[str, object]:
    context: dict[str, object] = {}
    if indirection_hotspots:
        context["indirection_hotspots"] = indirection_hotspots[:20]
    if wide_param_bags:
        context["wide_param_bags"] = wide_param_bags[:20]
    return context


def _build_interface_honesty_context(
    *,
    one_impl_interfaces: list[dict[str, object]],
) -> dict[str, object]:
    if one_impl_interfaces:
        return {"one_impl_interfaces": one_impl_interfaces[:20]}
    return {}


def _build_delegation_density_context(
    *,
    delegation_classes: list[dict],
) -> dict[str, object]:
    if delegation_classes:
        return {"delegation_heavy_classes": delegation_classes}
    return {}


def _build_definition_directness_context(
    *,
    facade_modules: list[dict],
) -> dict[str, object]:
    if facade_modules:
        return {"facade_modules": facade_modules}
    return {}


def _build_type_discipline_context(
    *,
    typed_dict_violations: list[dict],
    dict_any_annotations: list[dict] | None = None,
    enum_bypass_patterns: list[dict] | None = None,
    type_strategy_census: dict[str, list[dict]] | None = None,
) -> dict[str, object]:
    context: dict[str, object] = {}
    if typed_dict_violations:
        context["typed_dict_violations"] = typed_dict_violations
    if dict_any_annotations:
        context["dict_any_annotations"] = dict_any_annotations
    if enum_bypass_patterns:
        context["enum_bypass_patterns"] = enum_bypass_patterns
    if type_strategy_census:
        context["type_strategy_census"] = {
            strategy: len(items)
            for strategy, items in type_strategy_census.items()
        }
    return context


def _assemble_context(
    *,
    util_files: list,
    wrapper_rate: float,
    total_wrappers: int,
    total_function_signatures: int,
    wrappers_by_file: list,
    one_impl_interfaces: list,
    indirection_hotspots: list,
    wide_param_bags: list,
    delegation_classes: list,
    facade_modules: list,
    typed_dict_violations: list,
    total_typed_dict_violations: int,
    sub_axes: dict[str, float],
    dict_any_annotations: list | None = None,
    enum_bypass_patterns: list | None = None,
    type_strategy_census: dict | None = None,
) -> dict:
    """Build the final context dict from collected data and sub-axis scores."""
    util_list = sorted(util_files, key=lambda item: -item["loc"])[:20]
    context: dict[str, object] = {
        "util_files": util_list,
        "summary": {
            "wrapper_rate": round(wrapper_rate, 3),
            "total_wrappers": total_wrappers,
            "total_function_signatures": total_function_signatures,
            "one_impl_interface_count": len(one_impl_interfaces),
            "indirection_hotspot_count": len(indirection_hotspots),
            "wide_param_bag_count": len(wide_param_bags),
            "delegation_heavy_class_count": len(delegation_classes),
            "facade_module_count": len(facade_modules),
            "typed_dict_violation_count": total_typed_dict_violations,
            "dict_any_annotation_count": len(dict_any_annotations or []),
            "enum_bypass_count": len(enum_bypass_patterns or []),
        },
        "sub_axes": sub_axes,
    }

    context.update(
        _build_abstraction_leverage_context(
            util_files=util_files,
            wrappers_by_file=wrappers_by_file,
        )
    )
    context.update(
        _build_indirection_cost_context(
            indirection_hotspots=indirection_hotspots,
            wide_param_bags=wide_param_bags,
        )
    )
    context.update(
        _build_interface_honesty_context(one_impl_interfaces=one_impl_interfaces)
    )
    context.update(
        _build_delegation_density_context(delegation_classes=delegation_classes)
    )
    context.update(
        _build_definition_directness_context(facade_modules=facade_modules)
    )
    context.update(
        _build_type_discipline_context(
            typed_dict_violations=typed_dict_violations,
            dict_any_annotations=dict_any_annotations,
            enum_bypass_patterns=enum_bypass_patterns,
            type_strategy_census=type_strategy_census,
        )
    )

    return context


__all__ = [
    "_assemble_context",
    "_build_abstraction_leverage_context",
    "_build_definition_directness_context",
    "_build_delegation_density_context",
    "_build_indirection_cost_context",
    "_build_interface_honesty_context",
    "_build_type_discipline_context",
    "_compute_sub_axes",
]
