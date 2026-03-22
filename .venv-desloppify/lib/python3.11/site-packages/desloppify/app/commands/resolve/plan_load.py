"""Shared degraded-plan warning helpers for resolve flows."""

from __future__ import annotations

import sys
from dataclasses import dataclass

from desloppify.base.output.terminal import colorize
from desloppify.engine._work_queue.context import resolve_plan_load_status


@dataclass(frozen=True)
class DegradedPlanWarning:
    """Structured degraded-mode warning payload for resolve flows."""

    command_label: str
    error_kind: str | None
    message: str
    behavior: str


@dataclass
class DegradedPlanWarningState:
    """Mutable per-call-chain dedupe state for degraded resolve warnings."""

    warned: bool = False


@dataclass(frozen=True)
class ResolvePlanAccess:
    """Resolved living-plan access contract for one resolve attempt."""

    plan: dict | None
    degraded: bool
    error_kind: str | None
    warning_state: DegradedPlanWarningState
    recovery: str | None = None

    def usable_plan(self, *, behavior: str, command_label: str = "resolve") -> dict | None:
        """Return the loaded plan, warning once when resolve falls back."""
        if self.degraded:
            warn_plan_load_degraded_once(
                command_label=command_label,
                error_kind=self.error_kind,
                behavior=behavior,
                warning_state=self.warning_state,
            )
            if self.recovery == "backup":
                return self.plan if isinstance(self.plan, dict) else None
            return None
        return self.plan if isinstance(self.plan, dict) else None


def load_resolve_plan_access(
    *,
    warning_state: DegradedPlanWarningState | None = None,
) -> ResolvePlanAccess:
    """Resolve plan access once so all degraded behavior shares one warning state."""
    resolved_warning_state = warning_state or DegradedPlanWarningState()
    status = resolve_plan_load_status()
    return ResolvePlanAccess(
        plan=status.plan,
        degraded=status.degraded,
        error_kind=status.error_kind,
        recovery=getattr(status, "recovery", None),
        warning_state=resolved_warning_state,
    )


def warn_plan_load_degraded_once(
    *,
    command_label: str = "resolve",
    error_kind: str | None,
    behavior: str,
    warning_state: DegradedPlanWarningState | None = None,
) -> DegradedPlanWarning | None:
    """Print one consistent warning when resolve behavior degrades.

    Returns a structured warning payload on first emission, else ``None``.
    Dedupe is scoped to the provided ``warning_state``; unrelated resolve
    attempts should pass separate state objects and will warn independently.
    """
    if warning_state is not None:
        if warning_state.warned:
            return None
        warning_state.warned = True

    detail = f" ({error_kind})" if error_kind else ""
    message = (
        f"Warning: {command_label} is running in degraded mode because the living "
        f"plan could not be loaded{detail}."
    )
    warning = DegradedPlanWarning(
        command_label=command_label,
        error_kind=error_kind,
        message=message,
        behavior=behavior,
    )
    print(
        colorize(f"  {warning.message}", "yellow"),
        file=sys.stderr,
    )
    print(
        colorize(f"  {warning.behavior}", "dim"),
        file=sys.stderr,
    )
    return warning


def _reset_degraded_plan_warning_for_tests() -> None:
    """Backward-compatible no-op kept for existing tests."""
    return None


__all__ = [
    "DegradedPlanWarning",
    "DegradedPlanWarningState",
    "ResolvePlanAccess",
    "load_resolve_plan_access",
    "warn_plan_load_degraded_once",
]
