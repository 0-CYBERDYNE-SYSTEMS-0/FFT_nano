"""Shared scoped-state primitives for language framework registries."""

from __future__ import annotations

from collections.abc import Callable
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Generic, TypeVar

from .scope import DEFAULT_SCOPE

ScopeResolver = Callable[[], str | None]
K = TypeVar("K")
V = TypeVar("V")

_active_scope_var: ContextVar[str | None] = ContextVar(
    "desloppify_registry_active_scope",
    default=None,
)


def normalize_scope(scope: str | None) -> str | None:
    """Normalize a scope value to a stable optional string."""
    value = str(scope or "").strip()
    return value or None


def scope_key(scope: str | None) -> str:
    """Convert a scope value into a concrete map key."""
    value = normalize_scope(scope)
    return value or DEFAULT_SCOPE


def set_active_scope(scope: str | None) -> None:
    """Set process-local implicit scope used by registry flows."""
    _active_scope_var.set(normalize_scope(scope))


def get_active_scope() -> str | None:
    """Return process-local implicit scope, if any."""
    value = _active_scope_var.get()
    if not isinstance(value, str):
        return None
    normalized = normalize_scope(value)
    return normalized


@contextmanager
def active_scope_context(scope: str | None):
    """Temporarily set active scope for implicit registry operations."""
    value = normalize_scope(scope)
    token = _active_scope_var.set(value)
    try:
        yield value
    finally:
        _active_scope_var.reset(token)


def resolve_effective_scope(
    scope: str | None,
    *,
    fallback_scope_fn: ScopeResolver | None = None,
) -> str | None:
    """Resolve effective scope from explicit -> active -> optional fallback."""
    explicit = normalize_scope(scope)
    if explicit is not None:
        return explicit
    active = get_active_scope()
    if active is not None:
        return active
    if callable(fallback_scope_fn):
        return normalize_scope(fallback_scope_fn())
    return None


class ScopedDictStore(Generic[K, V]):
    """Scoped dictionary buckets with a global/default scope."""

    def __init__(self) -> None:
        self._global: dict[K, V] = {}
        self._by_scope: dict[str, dict[K, V]] = {}

    def bucket(self, scope: str | None, *, create: bool = False) -> dict[K, V]:
        """Return mapping bucket for one scope."""
        key = scope_key(scope)
        if key == DEFAULT_SCOPE:
            return self._global
        if create:
            return self._by_scope.setdefault(key, {})
        return self._by_scope.get(key, {})

    def clear(self, *, scope: str | None = None) -> None:
        """Clear one scope bucket or all buckets."""
        if scope is None:
            self._global.clear()
            self._by_scope.clear()
            return
        key = scope_key(scope)
        if key == DEFAULT_SCOPE:
            self._global.clear()
            return
        self._by_scope.pop(key, None)

    def iter_scoped_buckets(self) -> list[dict[K, V]]:
        """Return all non-default scope buckets."""
        return list(self._by_scope.values())

