"""TypeScript extraction entrypoints required by plugin structure validation."""

from __future__ import annotations

from pathlib import Path

from desloppify.engine.detectors.base import ClassInfo, FunctionInfo

from . import extractors_components as components_mod
from . import extractors_functions as functions_mod


def extract_ts_functions(filepath: str) -> list[FunctionInfo]:
    return functions_mod.extract_ts_functions(filepath)


def normalize_ts_body(body: str) -> str:
    return functions_mod.normalize_ts_body(body)


def _extract_ts_params(sig: str) -> list[str]:
    return functions_mod._extract_ts_params(sig)


def _parse_param_names(param_str: str) -> list[str]:
    return functions_mod._parse_param_names(param_str)


def extract_ts_components(path: Path) -> list[ClassInfo]:
    return components_mod.extract_ts_components(path)


def extract_props(destructured: str) -> list[str]:
    return components_mod.extract_props(destructured)


def tsx_passthrough_pattern(name: str) -> str:
    return components_mod.tsx_passthrough_pattern(name)


def detect_passthrough_components(path: Path) -> list[dict]:
    return components_mod.detect_passthrough_components(path)


__all__ = [
    "_extract_ts_params",
    "_parse_param_names",
    "detect_passthrough_components",
    "extract_props",
    "extract_ts_components",
    "extract_ts_functions",
    "normalize_ts_body",
    "tsx_passthrough_pattern",
]
