"""Remediation plan generation helpers."""

from __future__ import annotations

from pathlib import Path

from desloppify.engine._state.schema import StateModel


def render_empty_remediation_plan(state: StateModel, lang_name: str) -> str:
    """Build the empty remediation plan output."""
    from desloppify.intelligence.review._prepare.remediation_engine import (
        render_empty_remediation_plan as _render_empty_remediation_plan,
    )

    return _render_empty_remediation_plan(state, lang_name)


def generate_remediation_plan(
    state: StateModel,
    lang_name: str,
    *,
    output_path: Path | None = None,
) -> str:
    """Generate remediation markdown for open holistic issues."""
    from desloppify.intelligence.review._prepare.remediation_engine import (
        generate_remediation_plan as _generate_remediation_plan,
    )

    return _generate_remediation_plan(
        state,
        lang_name,
        output_path=output_path,
    )


__all__ = ["generate_remediation_plan", "render_empty_remediation_plan"]
