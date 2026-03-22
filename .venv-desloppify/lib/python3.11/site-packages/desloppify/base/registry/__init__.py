"""Canonical detector registry — single source of truth.

All detector metadata lives here. Other modules derive their views
(display order, CLI names, narrative tools, scoring validation) from this registry
instead of maintaining their own lists.
"""

from __future__ import annotations

from collections.abc import Callable, Iterator, Sequence, Set
from dataclasses import dataclass, field
from types import MappingProxyType
from typing import Any

from .catalog_entries import DETECTORS as _CATALOG_DETECTORS
from .catalog_models import (
    DISPLAY_ORDER as _CATALOG_DISPLAY_ORDER,
    DetectorMeta,
)

_BASE_DETECTORS: dict[str, DetectorMeta] = dict(_CATALOG_DETECTORS)
_BASE_DISPLAY_ORDER: list[str] = list(_CATALOG_DISPLAY_ORDER)
_BASE_JUDGMENT_DETECTORS: frozenset[str] = frozenset(
    name for name, meta in _BASE_DETECTORS.items() if meta.needs_judgment
)

@dataclass
class _DetectorRegistryState:
    detectors: dict[str, DetectorMeta] = field(default_factory=dict)
    display_order: list[str] = field(default_factory=list)
    callbacks: list[Callable[[], None]] = field(default_factory=list)
    judgment_detectors: set[str] = field(default_factory=set)


class _DisplayOrderView(Sequence[str]):
    """Read-only compatibility view for legacy `_DISPLAY_ORDER` users."""

    def __getitem__(self, index: int | slice) -> str | tuple[str, ...]:
        if isinstance(index, slice):
            return tuple(_REGISTRY.display_order[index])
        return _REGISTRY.display_order[index]

    def __len__(self) -> int:
        return len(_REGISTRY.display_order)

    def __iter__(self) -> Iterator[str]:
        return iter(tuple(_REGISTRY.display_order))


class _JudgmentDetectorsView(Set[str]):
    """Read-only dynamic view for judgment detector membership checks."""

    def __contains__(self, item: object) -> bool:
        if not isinstance(item, str):
            return False
        return item in _REGISTRY.judgment_detectors

    def __iter__(self) -> Iterator[str]:
        return iter(frozenset(_REGISTRY.judgment_detectors))

    def __len__(self) -> int:
        return len(_REGISTRY.judgment_detectors)


_REGISTRY = _DetectorRegistryState(
    detectors=dict(_CATALOG_DETECTORS),
    display_order=list(_BASE_DISPLAY_ORDER),
    judgment_detectors=set(_BASE_JUDGMENT_DETECTORS),
)

# Backwards-compatible read-only views for legacy imports.
DETECTORS = MappingProxyType(_REGISTRY.detectors)
_DISPLAY_ORDER: Sequence[str] = _DisplayOrderView()
JUDGMENT_DETECTORS: Set[str] = _JudgmentDetectorsView()


def _rebuild_judgment_detectors() -> None:
    _REGISTRY.judgment_detectors.clear()
    _REGISTRY.judgment_detectors.update(
        name
        for name, meta in _REGISTRY.detectors.items()
        if meta.needs_judgment
    )


def _notify_callbacks() -> None:
    for callback in tuple(_REGISTRY.callbacks):
        callback()


def on_detector_registered(callback: Callable[[], None]) -> None:
    """Register a callback invoked after register_detector(). No-arg."""
    _REGISTRY.callbacks.append(callback)


def register_detector(meta: DetectorMeta) -> None:
    """Register a detector at runtime (used by generic plugins)."""
    _REGISTRY.detectors[meta.name] = meta
    if meta.name not in _REGISTRY.display_order:
        _REGISTRY.display_order.append(meta.name)
    _rebuild_judgment_detectors()
    _notify_callbacks()


def unregister_detector(name: str) -> bool:
    """Remove one runtime detector registration. Returns True when changed."""
    changed = False
    if name in _REGISTRY.detectors:
        del _REGISTRY.detectors[name]
        changed = True
    if name in _REGISTRY.display_order:
        _REGISTRY.display_order.remove(name)
        changed = True
    if changed:
        _rebuild_judgment_detectors()
        _notify_callbacks()
    return changed


def reset_registered_detectors() -> None:
    """Reset runtime-added detector registrations to built-in defaults."""
    _REGISTRY.detectors.clear()
    _REGISTRY.detectors.update(_BASE_DETECTORS)
    _REGISTRY.display_order.clear()
    _REGISTRY.display_order.extend(_BASE_DISPLAY_ORDER)
    _REGISTRY.judgment_detectors.clear()
    _REGISTRY.judgment_detectors.update(_BASE_JUDGMENT_DETECTORS)
    _notify_callbacks()


def detector_names() -> list[str]:
    """All registered detector names, sorted."""
    return sorted(_REGISTRY.detectors.keys())


def get_detector_meta(name: str) -> DetectorMeta | None:
    """Lookup one detector metadata entry by name."""
    return _REGISTRY.detectors.get(name)


def display_order() -> list[str]:
    """Canonical display order for terminal output."""
    return list(_REGISTRY.display_order)


_ACTION_PRIORITY = {"auto_fix": 0, "reorganize": 1, "refactor": 2, "manual_fix": 3}
_ACTION_LABELS = {
    "auto_fix": "autofix",
    "reorganize": "move",
    "refactor": "refactor",
    "manual_fix": "manual",
}


def dimension_action_type(dim_name: str) -> str:
    """Return a compact action type label for a dimension based on its detectors."""
    best = "manual"
    best_priority = 99
    for detector_meta in _REGISTRY.detectors.values():
        if detector_meta.dimension == dim_name:
            priority = _ACTION_PRIORITY.get(detector_meta.action_type, 99)
            if priority < best_priority:
                best_priority = priority
                best = detector_meta.action_type
    return _ACTION_LABELS.get(best, "manual")


def detector_tools() -> dict[str, dict[str, Any]]:
    """Build detector tool metadata keyed by detector name."""
    result = {}
    for detector_name, detector_meta in _REGISTRY.detectors.items():
        entry: dict[str, Any] = {
            "fixers": list(detector_meta.fixers),
            "action_type": detector_meta.action_type,
        }
        if detector_meta.tool:
            entry["tool"] = detector_meta.tool
        if detector_meta.guidance:
            entry["guidance"] = detector_meta.guidance
        result[detector_name] = entry
    return result


def dimension_to_detectors() -> dict[str, set[str]]:
    """Subjective dimension -> set of detector names that provide evidence."""
    result: dict[str, set[str]] = {}
    for name, meta in _REGISTRY.detectors.items():
        for dim in meta.subjective_dimensions:
            result.setdefault(dim, set()).add(name)
    return result


__all__ = [
    "DETECTORS",
    "DetectorMeta",
    "JUDGMENT_DETECTORS",
    "_DISPLAY_ORDER",
    "dimension_to_detectors",
    "detector_names",
    "get_detector_meta",
    "detector_tools",
    "dimension_action_type",
    "display_order",
    "on_detector_registered",
    "register_detector",
    "reset_registered_detectors",
    "unregister_detector",
]
