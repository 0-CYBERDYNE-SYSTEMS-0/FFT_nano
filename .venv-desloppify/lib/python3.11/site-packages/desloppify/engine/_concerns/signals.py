"""Signal extraction helpers for concern generation."""

from __future__ import annotations

import re
from typing import Any

from .constants import ELEVATED_LOC, ELEVATED_MAX_NESTING, ELEVATED_MAX_PARAMS
from .types import ConcernSignals
from .utils import _update_max_signal


def _parse_complexity_signals(detail: dict[str, Any]) -> dict[str, float]:
    """Parse params/nesting labels from structural complexity signals."""
    result: dict[str, float] = {}
    raw_signals = detail.get("complexity_signals", [])
    if not isinstance(raw_signals, list):
        return result

    for signal in raw_signals:
        if not isinstance(signal, str):
            continue
        params = re.search(r"(\d+)\s*params", signal)
        if params:
            result["max_params"] = max(
                result.get("max_params", 0),
                float(params.group(1)),
            )
        nesting = re.search(r"nesting depth\s*(\d+)", signal)
        if nesting:
            result["max_nesting"] = max(
                result.get("max_nesting", 0),
                float(nesting.group(1)),
            )
    return result


def _extract_signals(issues: list[dict[str, Any]]) -> ConcernSignals:
    """Extract key quantitative signals from a file's issues."""
    signals: ConcernSignals = {}
    monster_funcs: list[str] = []

    for finding in issues:
        detector = finding.get("detector", "")
        detail_raw = finding.get("detail", {})
        detail = detail_raw if isinstance(detail_raw, dict) else {}

        if detector == "structural":
            _update_max_signal(signals, "loc", detail.get("loc", 0))
            parsed = _parse_complexity_signals(detail)
            for key in ("max_params", "max_nesting"):
                if key in parsed:
                    _update_max_signal(signals, key, parsed[key])

        if detector == "smells" and detail.get("smell_id") == "monster_function":
            _update_max_signal(signals, "monster_loc", detail.get("loc", 0))
            function_name = detail.get("function", "")
            if isinstance(function_name, str) and function_name:
                monster_funcs.append(function_name)

    if monster_funcs:
        signals["monster_funcs"] = monster_funcs
    return signals


def _has_elevated_signals(issues: list[dict[str, Any]]) -> bool:
    """Return whether any issue has strong enough signals to flag on its own."""
    for finding in issues:
        detector = finding.get("detector", "")
        detail_raw = finding.get("detail", {})
        detail = detail_raw if isinstance(detail_raw, dict) else {}

        if detector == "structural":
            if detail.get("loc", 0) >= ELEVATED_LOC:
                return True
            parsed = _parse_complexity_signals(detail)
            if parsed.get("max_params", 0) >= ELEVATED_MAX_PARAMS:
                return True
            if parsed.get("max_nesting", 0) >= ELEVATED_MAX_NESTING:
                return True

        if detector == "smells" and detail.get("smell_id") == "monster_function":
            return True

        if detector in (
            "dupes",
            "boilerplate_duplication",
            "coupling",
            "responsibility_cohesion",
        ):
            return True

    return False


__all__ = ["_extract_signals", "_has_elevated_signals", "_parse_complexity_signals"]
