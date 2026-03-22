"""Execution constraints — shared anti-patterns enforced at review and triage sense-check."""

from __future__ import annotations

EXECUTION_CONSTRAINTS: tuple[str, ...] = (
    "Do not extract code into new files or functions that would have exactly 1 consumer",
    "Do not use __internal or _test export hacks — test through the public API or export properly",
    "Do not rename for convention alone when no ambiguity exists",
    "Do not delete tests without equivalent replacement coverage",
    "Do not strip rationale comments — preserve comments explaining why, not what",
    "Refactors must preserve behavior — do not change test expectations in cleanup steps",
    "Net line count must decrease or stay flat in cleanup commits",
)


def render_constraints(*, header: str = "", bullet: str = "- ") -> str:
    """Render the constraint list with an optional header."""
    lines: list[str] = []
    if header:
        lines.append(header)
    for constraint in EXECUTION_CONSTRAINTS:
        lines.append(f"{bullet}{constraint}")
    return "\n".join(lines)


__all__ = ["EXECUTION_CONSTRAINTS", "render_constraints"]
